import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocket, type WebSocketServer } from "ws";
import { watch, type FSWatcher } from "chokidar";

import type { PreviewClientMessage, PreviewServerMessage } from "../protocol.js";
import { mimeForPath } from "./mime.js";
import {
  createDefaultPreviewPathResolver,
  ensurePathInside,
  normalizeBasePath,
  PreviewPathError,
  stripBasePath,
  type PreviewPathResolver,
} from "./paths.js";
import {
  attachWorkbookAssetUrls,
  createWorkbookPreview,
  type PreviewXlsxOptions,
} from "./xlsx.js";

const PUBLIC_BASE_PATH_HEADER = "x-heysnap-preview-public-base-path";

export interface PreviewServiceOptions extends PreviewXlsxOptions {
  readonly basePath?: string;
  readonly clientRoot?: string | URL;
  readonly rootPath?: string;
  readonly allowAbsolutePaths?: boolean;
  readonly resolvePath?: PreviewPathResolver;
  readonly debounceMs?: number;
}

interface HtmlPreviewRoot {
  readonly rootPath: string;
  readonly entryPath: string;
}

interface FileAssetRoot {
  readonly rootPath: string;
}

export class PreviewService {
  readonly basePath: string;
  readonly websocketPath: string;
  private readonly clientRoot: string;
  private readonly resolvePath: PreviewPathResolver;
  private readonly debounceMs: number;
  private readonly htmlRoots = new Map<string, HtmlPreviewRoot>();
  private readonly fileAssetRoots = new Map<string, FileAssetRoot>();
  private readonly xlsxAssetDirs = new Map<string, string>();

  constructor(private readonly options: PreviewServiceOptions = {}) {
    this.basePath = normalizeBasePath(options.basePath);
    this.websocketPath = joinUrlPath(this.basePath, "ws");
    this.clientRoot = resolveClientRoot(options.clientRoot);
    this.resolvePath = options.resolvePath ?? createDefaultPreviewPathResolver({
      rootPath: options.rootPath,
      allowAbsolutePaths: options.allowAbsolutePaths,
    });
    this.debounceMs = options.debounceMs ?? 20;
  }

  async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const subpath = stripBasePath(requestUrl.pathname, this.basePath);
    const publicBasePath = readPublicBasePath(request, this.basePath);

    if (subpath === null) {
      return false;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, previewCorsHeaders);
      response.end();
      return true;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "method not allowed" });
      return true;
    }

    if (subpath === "/api/health") {
      sendJson(response, 200, { ok: true });
      return true;
    }

    if (subpath.startsWith("/api/html-preview/")) {
      await this.handleHtmlPreviewAsset(subpath, response);
      return true;
    }

    if (subpath.startsWith("/api/file-assets/")) {
      await this.handleFileAsset(subpath, response);
      return true;
    }

    if (subpath.startsWith("/api/xlsx-assets/")) {
      await this.handleXlsxAsset(subpath, response);
      return true;
    }

    await this.handleClientAsset(subpath, requestUrl, response, publicBasePath);
    return true;
  }

  handleWebSocketConnection(webSocket: WebSocket): void {
    const session = new PreviewSocketSession(webSocket, this);
    session.start();
  }

  async cleanupConnection(connectionId: string): Promise<void> {
    this.htmlRoots.delete(connectionId);
    this.fileAssetRoots.delete(connectionId);
    const xlsxAssetDirectory = this.xlsxAssetDirs.get(connectionId);

    if (xlsxAssetDirectory !== undefined) {
      this.xlsxAssetDirs.delete(connectionId);
      await rm(xlsxAssetDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async resolveWatchPath(input: { readonly path: string; readonly root?: string }) {
    return this.resolvePath(input);
  }

  getDebounceMs(): number {
    return this.debounceMs;
  }

  getXlsxOptions(): PreviewXlsxOptions {
    return this.options;
  }

  registerHtmlRoot(connectionId: string, root: HtmlPreviewRoot): void {
    this.htmlRoots.set(connectionId, root);
  }

  registerFileAssetRoot(connectionId: string, root: FileAssetRoot): void {
    this.fileAssetRoots.set(connectionId, root);
  }

  registerXlsxAssetDirectory(connectionId: string, directory: string): void {
    const previousDirectory = this.xlsxAssetDirs.get(connectionId);
    this.xlsxAssetDirs.set(connectionId, directory);

    if (previousDirectory !== undefined && previousDirectory !== directory) {
      void rm(previousDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  buildHtmlPreviewUrl(connectionId: string, entryPath: string, publicBasePath = this.basePath): string {
    return joinUrlPath(
      publicBasePath,
      "api",
      "html-preview",
      encodeURIComponent(connectionId),
      encodePathSegments(entryPath),
    );
  }

  buildFileAssetBaseUrl(connectionId: string, publicBasePath = this.basePath): string {
    return `${joinUrlPath(
      publicBasePath,
      "api",
      "file-assets",
      encodeURIComponent(connectionId),
    )}/`;
  }

  buildXlsxAssetUrl(connectionId: string, assetPath: string, publicBasePath = this.basePath): string {
    return joinUrlPath(
      publicBasePath,
      "api",
      "xlsx-assets",
      encodeURIComponent(connectionId),
      encodePathSegments(assetPath),
    );
  }

  private async handleHtmlPreviewAsset(subpath: string, response: ServerResponse): Promise<void> {
    const match = /^\/api\/html-preview\/([^/]+)\/?(.*)$/u.exec(subpath);

    if (match === null) {
      sendJson(response, 400, { error: "bad html-preview path" });
      return;
    }

    const connectionId = decodeURIComponent(match[1] ?? "");
    const root = this.htmlRoots.get(connectionId);

    if (root === undefined) {
      sendJson(response, 404, { error: "unknown connection id" });
      return;
    }

    const rawRelativePath = decodePath(match[2] ?? "") || root.entryPath;
    const assetPath = resolve(root.rootPath, rawRelativePath);

    try {
      ensurePathInside(root.rootPath, assetPath, "invalid html-preview path");
      const assetStats = await stat(assetPath);

      if (!assetStats.isFile()) {
        sendJson(response, 404, { error: "not found" });
        return;
      }

      response.writeHead(200, {
        ...previewCorsHeaders,
        "cache-control": "no-store",
        "content-length": String(assetStats.size),
        "content-type": mimeForPath(assetPath),
      });
      createReadStream(assetPath).pipe(response);
    } catch (error) {
      sendJson(response, error instanceof PreviewPathError ? 400 : 404, {
        error: error instanceof Error ? error.message : "not found",
      });
    }
  }

  private async handleFileAsset(subpath: string, response: ServerResponse): Promise<void> {
    const match = /^\/api\/file-assets\/([^/]+)\/(.+)$/u.exec(subpath);

    if (match === null) {
      sendJson(response, 400, { error: "bad file-asset path" });
      return;
    }

    const connectionId = decodeURIComponent(match[1] ?? "");
    const root = this.fileAssetRoots.get(connectionId);

    if (root === undefined) {
      sendJson(response, 404, { error: "unknown connection id" });
      return;
    }

    const relativePath = decodePath(match[2] ?? "");
    const assetPath = resolve(root.rootPath, relativePath);

    try {
      ensurePathInside(root.rootPath, assetPath, "invalid file-asset path");
      const assetStats = await stat(assetPath);

      if (!assetStats.isFile()) {
        sendJson(response, 404, { error: "not found" });
        return;
      }

      response.writeHead(200, {
        ...previewCorsHeaders,
        "cache-control": "no-store",
        "content-length": String(assetStats.size),
        "content-type": mimeForPath(assetPath),
      });
      createReadStream(assetPath).pipe(response);
    } catch (error) {
      sendJson(response, error instanceof PreviewPathError ? 400 : 404, {
        error: error instanceof Error ? error.message : "not found",
      });
    }
  }

  private async handleXlsxAsset(subpath: string, response: ServerResponse): Promise<void> {
    const match = /^\/api\/xlsx-assets\/([^/]+)\/(.+)$/u.exec(subpath);

    if (match === null) {
      sendJson(response, 400, { error: "bad asset path" });
      return;
    }

    const connectionId = decodeURIComponent(match[1] ?? "");
    const assetDirectory = this.xlsxAssetDirs.get(connectionId);

    if (assetDirectory === undefined) {
      sendJson(response, 404, { error: "unknown connection id" });
      return;
    }

    const relativePath = decodePath(match[2] ?? "");
    const assetPath = resolve(assetDirectory, relativePath);

    try {
      ensurePathInside(assetDirectory, assetPath, "invalid asset path");
      const assetStats = await stat(assetPath);

      if (!assetStats.isFile()) {
        sendJson(response, 404, { error: "asset not found" });
        return;
      }

      response.writeHead(200, {
        ...previewCorsHeaders,
        "cache-control": "no-store",
        "content-length": String(assetStats.size),
        "content-type": mimeForPath(assetPath),
      });
      createReadStream(assetPath).pipe(response);
    } catch (error) {
      sendJson(response, error instanceof PreviewPathError ? 400 : 404, {
        error: error instanceof Error ? error.message : "asset not found",
      });
    }
  }

  private async handleClientAsset(
    subpath: string,
    requestUrl: URL,
    response: ServerResponse,
    publicBasePath: string,
  ): Promise<void> {
    const requestedPath = subpath === "/" ? "/index.html" : subpath;
    const relativeAssetPath = decodePath(requestedPath.replace(/^\/+/u, ""));
    const assetPath = resolve(this.clientRoot, relativeAssetPath);

    try {
      ensurePathInside(this.clientRoot, assetPath, "invalid client asset path");
      const assetStats = await stat(assetPath);

      if (assetStats.isFile()) {
        if (basename(assetPath) === "index.html") {
          await this.sendIndex(response, publicBasePath);
          return;
        }

        response.writeHead(200, {
          "cache-control": requestUrl.pathname.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-store",
          "content-length": String(assetStats.size),
          "content-type": mimeForPath(assetPath),
        });
        createReadStream(assetPath).pipe(response);
        return;
      }
    } catch {
      // Fall through to the SPA shell below.
    }

    await this.sendIndex(response, publicBasePath);
  }

  private async sendIndex(response: ServerResponse, publicBasePath: string): Promise<void> {
    try {
      const indexHtml = await readFile(resolve(this.clientRoot, "index.html"), "utf8");
      const body = injectBasePath(indexHtml, publicBasePath);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": String(Buffer.byteLength(body)),
        "content-type": "text/html; charset=utf-8",
      });
      response.end(body);
    } catch {
      sendJson(response, 503, {
        error: "Preview client is not built. Run pnpm --filter @ank1015-app/previewer build.",
      });
    }
  }
}

class PreviewSocketSession {
  private readonly connectionId = cryptoRandomId();
  private watcher: FSWatcher | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private currentPath: string | null = null;
  private currentPublicPath: string | null = null;
  private currentHtmlRoot: string | null = null;
  private currentPublicBasePath: string | null = null;
  private closed = false;

  constructor(
    private readonly webSocket: WebSocket,
    private readonly service: PreviewService,
  ) {}

  start(): void {
    this.webSocket.on("message", (data) => {
      void this.handleRawMessage(data);
    });
    this.webSocket.on("close", () => {
      void this.close();
    });
    this.webSocket.on("error", () => {
      void this.close();
    });
  }

  private async handleRawMessage(data: WebSocket.RawData): Promise<void> {
    let message: PreviewClientMessage;

    try {
      message = parseClientMessage(data);
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : "Invalid preview message.");
      return;
    }

    if (message.type === "ping") {
      this.send({ type: "pong", requestId: message.requestId, serverTime: new Date().toISOString() });
      return;
    }

    try {
      const resolved = await this.service.resolveWatchPath({
        path: message.path,
        root: message.root,
      });

      await this.replaceWatch({
        filePath: resolved.filePath,
        publicPath: resolved.publicPath,
        htmlRootPath: resolved.htmlRootPath,
        publicBasePath: message.publicBasePath,
      });
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : "Failed to watch preview path.");
    }
  }

  private async replaceWatch(input: {
    readonly filePath: string;
    readonly publicPath: string;
    readonly htmlRootPath: string | null;
    readonly publicBasePath: string | undefined;
  }): Promise<void> {
    await this.closeWatcher();
    await this.service.cleanupConnection(this.connectionId);

    this.currentPath = input.filePath;
    this.currentPublicPath = input.publicPath;
    this.currentHtmlRoot = input.htmlRootPath;
    this.currentPublicBasePath = input.publicBasePath ?? null;

    await this.sendUpdate(input.filePath, input.publicPath, input.htmlRootPath, input.publicBasePath);

    const watchTarget = isHtmlPath(input.filePath)
      ? input.htmlRootPath ?? dirname(input.filePath)
      : input.filePath;
    const watcher = watch(watchTarget, {
      awaitWriteFinish: { stabilityThreshold: 30, pollInterval: 10 },
      ignoreInitial: true,
      ignored: (path) =>
        /(^|\/)(node_modules|\.git|dist|build|\.next|\.cache|\.turbo|\.parcel-cache)(\/|$)/u.test(path),
      persistent: true,
    });

    const onChange = (): void => {
      this.scheduleUpdate();
    };

    watcher.on("add", onChange);
    watcher.on("change", onChange);
    watcher.on("unlink", () => {
      this.sendError(`File removed: ${input.publicPath}`);
    });
    watcher.on("error", (error) => {
      this.sendError(error instanceof Error ? error.message : "Preview watcher failed.");
    });

    await new Promise<void>((resolveReady, rejectReady) => {
      watcher.once("ready", resolveReady);
      watcher.once("error", rejectReady);
    });

    this.watcher = watcher;
  }

  private scheduleUpdate(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
    }

    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;

      if (this.currentPath === null || this.currentPublicPath === null) {
        return;
      }

      void this.sendUpdate(
        this.currentPath,
        this.currentPublicPath,
        this.currentHtmlRoot,
        this.currentPublicBasePath ?? undefined,
      ).catch((error) => {
        this.sendError(error instanceof Error ? error.message : "Failed to refresh preview.");
      });
    }, this.service.getDebounceMs());
  }

  private async sendUpdate(
    filePath: string,
    publicPath: string,
    htmlRootPath: string | null,
    publicBasePath: string | undefined,
  ): Promise<void> {
    const fileStats = await stat(filePath);

    if (!fileStats.isFile()) {
      this.sendError(`Not a file: ${publicPath}`);
      return;
    }

    if (isXlsxPath(filePath)) {
      await this.sendWorkbook(filePath, publicPath, fileStats.size, fileStats.mtimeMs, publicBasePath);
      return;
    }

    if (isHtmlPath(filePath)) {
      this.sendHtmlPreview(filePath, publicPath, Date.now(), htmlRootPath, publicBasePath);
      return;
    }

    await this.sendBytes(filePath, publicPath, fileStats.size, fileStats.mtimeMs, publicBasePath);
  }

  private async sendBytes(
    filePath: string,
    publicPath: string,
    size: number,
    mtime: number,
    publicBasePath: string | undefined,
  ): Promise<void> {
    const buffer = await readFile(filePath);
    const assetBaseUrl = this.createAssetBaseUrl(filePath, publicBasePath);
    this.send({
      type: "file",
      path: publicPath,
      name: basename(filePath),
      mime: mimeForPath(filePath),
      size,
      mtime,
      data: buffer.toString("base64"),
      ...(assetBaseUrl === undefined ? {} : { assetBaseUrl }),
    });
  }

  private createAssetBaseUrl(filePath: string, publicBasePath: string | undefined): string | undefined {
    if (!isMarkdownPath(filePath)) {
      return undefined;
    }

    this.service.registerFileAssetRoot(this.connectionId, { rootPath: dirname(filePath) });
    return this.service.buildFileAssetBaseUrl(this.connectionId, publicBasePath);
  }

  private sendHtmlPreview(
    filePath: string,
    publicPath: string,
    mtime: number,
    explicitRoot: string | null,
    publicBasePath: string | undefined,
  ): void {
    const rootPath = explicitRoot ?? dirname(filePath);
    const entryPath = relative(rootPath, filePath);

    this.service.registerHtmlRoot(this.connectionId, { rootPath, entryPath });
    this.send({
      type: "htmlPreview",
      path: publicPath,
      name: basename(filePath),
      mtime,
      url: this.service.buildHtmlPreviewUrl(this.connectionId, entryPath, publicBasePath),
    });
  }

  private async sendWorkbook(
    filePath: string,
    publicPath: string,
    size: number,
    mtime: number,
    publicBasePath: string | undefined,
  ): Promise<void> {
    const buffer = await readFile(filePath);
    const result = await createWorkbookPreview(filePath, this.service.getXlsxOptions());
    this.service.registerXlsxAssetDirectory(this.connectionId, result.assetDirectory);
    attachWorkbookAssetUrls(
      result.workbook,
      (assetPath) => this.service.buildXlsxAssetUrl(this.connectionId, assetPath, publicBasePath),
    );
    this.send({
      type: "workbook",
      path: publicPath,
      name: basename(filePath),
      size,
      mtime,
      data: buffer.toString("base64"),
      workbook: result.workbook,
    });
  }

  private async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await this.closeWatcher();
    await this.service.cleanupConnection(this.connectionId);
  }

  private async closeWatcher(): Promise<void> {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }

    const watcher = this.watcher;
    this.watcher = null;

    if (watcher !== null) {
      await watcher.close();
    }
  }

  private send(message: PreviewServerMessage): void {
    if (this.webSocket.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify(message));
    }
  }

  private sendError(message: string): void {
    this.send({ type: "error", message });
  }
}

export const createPreviewService = (options: PreviewServiceOptions = {}): PreviewService =>
  new PreviewService(options);

export const bindPreviewWebSocketServer = (
  socketServer: WebSocketServer,
  service: PreviewService,
): void => {
  socketServer.on("connection", (webSocket) => {
    service.handleWebSocketConnection(webSocket);
  });
};

const parseClientMessage = (data: WebSocket.RawData): PreviewClientMessage => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawDataToText(data)) as unknown;
  } catch {
    throw new Error("Message must be valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid preview message.");
  }

  const record = parsed as Record<string, unknown>;

  if (record["type"] === "watch") {
    if (typeof record["path"] !== "string") {
      throw new Error("Preview watch path is required.");
    }

    return {
      type: "watch",
      path: record["path"],
      root: typeof record["root"] === "string" ? record["root"] : undefined,
      publicBasePath: typeof record["publicBasePath"] === "string" && record["publicBasePath"].trim().length > 0
        ? normalizeBasePath(record["publicBasePath"])
        : undefined,
    };
  }

  if (record["type"] === "ping") {
    return {
      type: "ping",
      requestId: typeof record["requestId"] === "string" ? record["requestId"] : undefined,
    };
  }

  throw new Error("Unsupported preview message.");
};

const rawDataToText = (data: WebSocket.RawData): string => {
  if (typeof data === "string") {
    return data;
  }

  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
};

const isXlsxPath = (path: string): boolean =>
  extname(path).toLowerCase() === ".xlsx";

const isHtmlPath = (path: string): boolean => {
  const extension = extname(path).toLowerCase();
  return extension === ".html" || extension === ".htm";
};

const isMarkdownPath = (path: string): boolean => {
  const extension = extname(path).toLowerCase();
  return extension === ".md" || extension === ".markdown" || extension === ".mdx";
};

const sendJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    ...previewCorsHeaders,
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(payload)),
    "content-type": "application/json",
  });
  response.end(payload);
};

const injectBasePath = (indexHtml: string, basePath: string): string => {
  const normalized = normalizeBasePath(basePath);
  const baseHref = normalized === "/" ? "/" : `${normalized}/`;
  return indexHtml
    .replaceAll("%HEYSNAP_PREVIEWER_BASE_PATH%", normalized)
    .replaceAll("%HEYSNAP_PREVIEWER_BASE_HREF%", baseHref);
};

const readPublicBasePath = (request: IncomingMessage, fallbackBasePath: string): string => {
  const raw = request.headers[PUBLIC_BASE_PATH_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (typeof value === "string" && value.trim().length > 0) {
    return normalizeBasePath(value);
  }

  return fallbackBasePath;
};

const encodePathSegments = (path: string): string =>
  path.split(sep).map(encodeURIComponent).join("/");

const decodePath = (path: string): string =>
  path.split("/").map((segment) => decodeURIComponent(segment)).join(sep);

const joinUrlPath = (...parts: string[]): string => {
  const joined = parts
    .flatMap((part, index) => {
      if (index === 0) {
        return [part.replace(/\/+$/u, "")];
      }

      return part.split("/").filter((segment) => segment.length > 0);
    })
    .join("/");

  return joined.startsWith("/") ? joined : `/${joined}`;
};

const resolveClientRoot = (clientRoot: string | URL | undefined): string => {
  if (clientRoot instanceof URL) {
    return fileURLToPath(clientRoot);
  }

  if (typeof clientRoot === "string") {
    return resolve(clientRoot);
  }

  return resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/client");
};

const previewCorsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-origin": "*",
} as const;

const cryptoRandomId = (): string => {
  return randomUUID();
};
