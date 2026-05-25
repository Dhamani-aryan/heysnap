import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { watch, type FSWatcher } from "chokidar";

import { FilesystemError, toFilesystemError } from "./errors.js";
import { FilesystemService, type TrashFunction } from "./service.js";
import { resolveClientPath, toClientPath } from "./paths.js";
import { attachWebSocketUpgradeRoute } from "../websocket/upgrade-router.js";
import type {
  FilesystemClientMessage,
  FilesystemEntry,
  FilesystemListing,
  FilesystemServerMessage,
  FilesystemRoot,
  FilesystemViewState,
  SnapshotReason,
} from "./types.js";

export interface FilesystemWebSocketOptions {
  readonly root: FilesystemRoot;
  readonly trashFunction?: TrashFunction;
  readonly debounceMs?: number;
  readonly onActivity?: () => void;
}

export const attachFilesystemWebSocketServer = (
  server: Server,
  options: FilesystemWebSocketOptions,
): WebSocketServer => {
  const socketServer = new WebSocketServer({ noServer: true });
  const viewState: MutableFilesystemViewState = {
    currentPath: null,
    openFilePaths: [],
  };
  attachWebSocketUpgradeRoute(server, "/filesystem", socketServer);

  socketServer.on("connection", (webSocket, request) => {
    options.onActivity?.();
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const initialPath = requestUrl.searchParams.get("path") ?? undefined;
    const showHidden = parseBoolean(requestUrl.searchParams.get("showHidden"));

    void new FilesystemSocketSession(webSocket, {
      ...options,
      initialPath,
      showHidden,
      viewState,
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
  readonly viewState: MutableFilesystemViewState;
}

interface MutableFilesystemViewState {
  currentPath: string | null;
  openFilePaths: string[];
}

class FilesystemSocketSession {
  private readonly service: FilesystemService;
  private readonly debounceMs: number;
  private activePath = "";
  private showHidden: boolean;
  private watcher: FSWatcher | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
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
    const initialViewState = await this.readViewState();
    this.send({
      type: "hello",
      root: { name: this.options.root.name, path: "" },
      serverTime: new Date().toISOString(),
      viewState: initialViewState,
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

    const initialPath = await this.resolveInitialPath();
    await this.subscribe(initialPath, undefined, this.showHidden, "subscribe");
  }

  private async handleRawMessage(data: WebSocket.RawData): Promise<void> {
    this.options.onActivity?.();
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
        case "setOpenFiles": {
          const paths = this.normalizeOpenFilePaths(message.paths);
          this.options.viewState.openFilePaths = paths;
          this.send({ type: "ack", requestId: message.requestId, action: "setOpenFiles", result: { paths } });
          break;
        }
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
    this.options.viewState.currentPath = listing.path;
    this.showHidden = showHidden;
    await this.replaceWatcher(this.activePath);
    this.send({ type: "snapshot", requestId, reason, listing });
  }

  private async resolveInitialPath(): Promise<string | undefined> {
    const rememberedPath = this.options.viewState.currentPath;

    if (rememberedPath !== null) {
      try {
        await this.service.listDirectory(rememberedPath, this.showHidden);
        return rememberedPath;
      } catch {
        this.options.viewState.currentPath = null;
      }
    }

    return this.options.initialPath;
  }

  private normalizeOpenFilePaths(paths: readonly string[]): string[] {
    return [...new Set(
      paths.map((path) => toClientPath(
        this.options.root.absolutePath,
        resolveClientPath(this.options.root.absolutePath, path),
      )),
    )].sort((left, right) => left.localeCompare(right));
  }

  private async publishSnapshot(reason: SnapshotReason, requestId?: string): Promise<void> {
    const listing = await this.service.listDirectory(this.activePath, this.showHidden);
    this.options.viewState.currentPath = listing.path;
    this.send({ type: "snapshot", requestId, reason, listing });
  }

  private async readViewState(): Promise<FilesystemViewState> {
    const openFiles = (
      await Promise.all(this.options.viewState.openFilePaths.map(async (path) => {
        try {
          const entry = await this.service.getEntry(path);
          return entry.type === "file" ? entry : undefined;
        } catch {
          return undefined;
        }
      }))
    ).filter((entry): entry is FilesystemEntry => entry !== undefined);

    this.options.viewState.openFilePaths = openFiles.map((entry) => entry.path);

    return {
      currentPath: this.options.viewState.currentPath,
      openFiles,
    };
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
    case "setOpenFiles":
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
