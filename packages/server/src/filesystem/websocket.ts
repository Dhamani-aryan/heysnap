import { createServer, type Server } from "node:http";
import { dirname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { watch, type FSWatcher } from "chokidar";

import { FilesystemError, toFilesystemError } from "./errors.js";
import { FilesystemService, type TrashFunction } from "./service.js";
import { resolveClientPath } from "./paths.js";
import { attachWebSocketUpgradeRoute } from "../websocket/upgrade-router.js";
import type {
  FilesystemClientMessage,
  FilesystemEntry,
  FilesystemListing,
  FilesystemServerMessage,
  FilesystemRoot,
  SnapshotReason,
} from "./types.js";

export interface FilesystemWebSocketOptions {
  readonly root: FilesystemRoot;
  readonly trashFunction?: TrashFunction;
  readonly debounceMs?: number;
}

export const attachFilesystemWebSocketServer = (
  server: Server,
  options: FilesystemWebSocketOptions,
): WebSocketServer => {
  const socketServer = new WebSocketServer({ noServer: true });
  attachWebSocketUpgradeRoute(server, "/filesystem", socketServer);

  socketServer.on("connection", (webSocket, request) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const initialPath = requestUrl.searchParams.get("path") ?? undefined;
    const showHidden = parseBoolean(requestUrl.searchParams.get("showHidden"));

    void new FilesystemSocketSession(webSocket, {
      ...options,
      initialPath,
      showHidden,
    }).start();
  });

  return socketServer;
};

export const createFilesystemServer = (
  options: FilesystemWebSocketOptions,
): { readonly server: Server; readonly socketServer: WebSocketServer } => {
  const server = createServer();
  const socketServer = attachFilesystemWebSocketServer(server, options);

  return { server, socketServer };
};

interface FilesystemSocketSessionOptions extends FilesystemWebSocketOptions {
  readonly initialPath?: string;
  readonly showHidden: boolean;
}

class FilesystemSocketSession {
  private readonly service: FilesystemService;
  private readonly debounceMs: number;
  private activePath = "";
  private showHidden: boolean;
  private watcher: FSWatcher | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
  private openFilePaths: string[] = [];
  private fileWatcher: FSWatcher | null = null;
  private fileWatchTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly webSocket: WebSocket,
    private readonly options: FilesystemSocketSessionOptions,
  ) {
    this.service = new FilesystemService({
      rootPath: options.root.absolutePath,
      trashFunction: options.trashFunction,
    });
    this.showHidden = options.showHidden;
    this.debounceMs = options.debounceMs ?? 100;
  }

  async start(): Promise<void> {
    this.send({
      type: "hello",
      root: { name: this.options.root.name, path: "" },
      serverTime: new Date().toISOString(),
    });

    this.webSocket.on("message", (data) => {
      void this.handleRawMessage(data);
    });
    this.webSocket.on("close", () => {
      void this.close();
    });
    this.webSocket.on("error", () => {
      void this.close();
    });

    await this.subscribe(this.options.initialPath, undefined, this.showHidden, "subscribe");
  }

  private async handleRawMessage(data: WebSocket.RawData): Promise<void> {
    let message: FilesystemClientMessage;

    try {
      message = parseClientMessage(data);
    } catch (error) {
      const filesystemError = toFilesystemError(error);
      this.sendError(undefined, filesystemError.code, filesystemError.message);
      return;
    }

    try {
      switch (message.type) {
        case "subscribe":
          await this.subscribe(message.path, message.requestId, message.showHidden ?? false, "subscribe");
          break;
        case "refresh":
          await this.publishSnapshot("refresh", message.requestId);
          break;
        case "watchFiles":
          await this.replaceFileWatcher(message.paths);
          this.send({ type: "ack", requestId: message.requestId, action: "watchFiles", result: { paths: this.openFilePaths } });
          await this.publishFileUpdates("subscription");
          break;
        case "createFolder": {
          const entry = await this.service.createFolder(message.path ?? this.activePath, message.name);
          this.send({ type: "ack", requestId: message.requestId, action: "createFolder", result: entry });
          await this.publishSnapshot("mutation", message.requestId);
          break;
        }
        case "upload": {
          const result = await this.service.uploadFiles(message.path ?? this.activePath, message.files);
          this.send({ type: "ack", requestId: message.requestId, action: "upload", result });
          await this.publishSnapshot("mutation", message.requestId);
          break;
        }
        case "rename": {
          const entry = await this.service.renameEntry(message.path, message.newName);
          this.send({ type: "ack", requestId: message.requestId, action: "rename", result: entry });
          await this.publishSnapshot("mutation", message.requestId);
          break;
        }
        case "trash": {
          const result = await this.service.trashEntries(message.paths);
          this.send({ type: "ack", requestId: message.requestId, action: "trash", result });
          await this.publishSnapshot("mutation", message.requestId);
          break;
        }
        case "ping":
          this.send({ type: "pong", requestId: message.requestId, serverTime: new Date().toISOString() });
          break;
      }
    } catch (error) {
      const filesystemError = toFilesystemError(error);
      this.sendError(message.requestId, filesystemError.code, filesystemError.message);
    }
  }

  private async subscribe(
    rawPath: string | undefined,
    requestId: string | undefined,
    showHidden: boolean,
    reason: SnapshotReason,
  ): Promise<void> {
    const listing = await this.service.listDirectory(rawPath, showHidden);
    this.activePath = listing.path;
    this.showHidden = showHidden;
    await this.replaceWatcher(this.activePath);
    this.send({ type: "snapshot", requestId, reason, listing });
  }

  private async replaceFileWatcher(paths: readonly string[]): Promise<void> {
    const nextOpenFilePaths = [...new Set(paths)].sort((left, right) => left.localeCompare(right));
    const parentDirectories = [...new Set(
      nextOpenFilePaths.map((path) => dirname(resolveClientPath(this.options.root.absolutePath, path))),
    )];

    await this.closeFileWatcher();
    this.openFilePaths = nextOpenFilePaths;

    if (this.openFilePaths.length === 0) {
      return;
    }

    const watcher = watch(parentDirectories, {
      depth: 0,
      ignoreInitial: true,
      persistent: true,
    });

    watcher.on("all", () => {
      this.scheduleFileUpdates();
    });

    await new Promise<void>((resolve, reject) => {
      watcher.once("ready", resolve);
      watcher.once("error", reject);
    });

    this.fileWatcher = watcher;
  }

  private scheduleFileUpdates(): void {
    if (this.fileWatchTimer !== null) {
      clearTimeout(this.fileWatchTimer);
    }

    this.fileWatchTimer = setTimeout(() => {
      this.fileWatchTimer = null;
      void this.publishFileUpdates("watch").catch((error) => {
        const filesystemError = toFilesystemError(error);
        this.sendError(undefined, filesystemError.code, filesystemError.message);
      });
    }, this.debounceMs);
  }

  private async publishFileUpdates(reason: "watch" | "subscription"): Promise<void> {
    if (this.openFilePaths.length === 0) {
      return;
    }

    const entries: FilesystemEntry[] = [];
    const missingPaths: string[] = [];

    await Promise.all(this.openFilePaths.map(async (path) => {
      try {
        const entry = await this.service.getEntry(path);

        if (entry.type === "file") {
          entries.push(entry);
        } else {
          missingPaths.push(path);
        }
      } catch {
        missingPaths.push(path);
      }
    }));

    entries.sort((left, right) => left.path.localeCompare(right.path));
    missingPaths.sort((left, right) => left.localeCompare(right));
    this.send({ type: "fileUpdates", reason, entries, missingPaths });
  }

  private async publishSnapshot(reason: SnapshotReason, requestId?: string): Promise<void> {
    const listing = await this.service.listDirectory(this.activePath, this.showHidden);
    this.send({ type: "snapshot", requestId, reason, listing });
  }

  private async replaceWatcher(clientPath: string): Promise<void> {
    await this.closeWatcher();

    const absolutePath = resolveClientPath(this.options.root.absolutePath, clientPath);
    const watcher = watch(absolutePath, {
      depth: 0,
      ignoreInitial: true,
      persistent: true,
    });

    watcher.on("all", () => {
      this.scheduleWatchSnapshot();
    });

    await new Promise<void>((resolve, reject) => {
      watcher.once("ready", resolve);
      watcher.once("error", reject);
    });

    this.watcher = watcher;
  }

  private scheduleWatchSnapshot(): void {
    if (this.watchTimer !== null) {
      clearTimeout(this.watchTimer);
    }

    this.watchTimer = setTimeout(() => {
      this.watchTimer = null;
      void this.publishSnapshot("watch").catch((error) => {
        const filesystemError = toFilesystemError(error);
        this.sendError(undefined, filesystemError.code, filesystemError.message);
      });
    }, this.debounceMs);
  }

  private async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await this.closeWatcher();
    await this.closeFileWatcher();
  }

  private async closeWatcher(): Promise<void> {
    if (this.watchTimer !== null) {
      clearTimeout(this.watchTimer);
      this.watchTimer = null;
    }

    const watcher = this.watcher;
    this.watcher = null;

    if (watcher !== null) {
      await watcher.close();
    }
  }

  private async closeFileWatcher(): Promise<void> {
    if (this.fileWatchTimer !== null) {
      clearTimeout(this.fileWatchTimer);
      this.fileWatchTimer = null;
    }

    const watcher = this.fileWatcher;
    this.fileWatcher = null;

    if (watcher !== null) {
      await watcher.close();
    }
  }

  private send(message: FilesystemServerMessage): void {
    if (this.webSocket.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify(message));
    }
  }

  private sendError(requestId: string | undefined, code: string, message: string): void {
    this.send({ type: "error", requestId, code, message });
  }
}

const parseClientMessage = (data: WebSocket.RawData): FilesystemClientMessage => {
  const rawText = dataToText(data);
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    throw new FilesystemError("INVALID_MESSAGE", "Message must be valid JSON");
  }

  if (!isClientMessage(parsed)) {
    throw new FilesystemError("INVALID_MESSAGE", "Invalid filesystem message");
  }

  return parsed;
};

const isClientMessage = (value: unknown): value is FilesystemClientMessage => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (typeof record["type"] !== "string" || typeof record["requestId"] !== "string") {
    return false;
  }

  switch (record["type"]) {
    case "subscribe":
      return optionalString(record["path"]) && optionalBoolean(record["showHidden"]);
    case "refresh":
    case "ping":
      return true;
    case "watchFiles":
      return Array.isArray(record["paths"]) && record["paths"].every((path) => typeof path === "string");
    case "createFolder":
      return optionalString(record["path"]) && optionalString(record["name"]);
    case "upload":
      return optionalString(record["path"]) && isUploadFiles(record["files"]);
    case "rename":
      return typeof record["path"] === "string" && typeof record["newName"] === "string";
    case "trash":
      return Array.isArray(record["paths"]) && record["paths"].every((path) => typeof path === "string");
    default:
      return false;
  }
};

const optionalString = (value: unknown): boolean =>
  value === undefined || typeof value === "string";

const optionalBoolean = (value: unknown): boolean =>
  value === undefined || typeof value === "boolean";

const isUploadFiles = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every((file) => {
    if (typeof file !== "object" || file === null) {
      return false;
    }

    const record = file as Record<string, unknown>;

    return (
      typeof record["relativePath"] === "string" &&
      (record["type"] === undefined || record["type"] === "file" || record["type"] === "directory") &&
      (record["contentBase64"] === undefined || typeof record["contentBase64"] === "string") &&
      optionalString(record["updatedAt"])
    );
  });

const parseBoolean = (rawValue: string | null): boolean => {
  if (rawValue === null) {
    return false;
  }

  return rawValue === "true" || rawValue === "1";
};

const dataToText = (data: WebSocket.RawData): string => {
  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return data.toString("utf8");
};
