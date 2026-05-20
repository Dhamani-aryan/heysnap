import { randomUUID } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { basename } from "node:path";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import { ensureWithinRoot, resolveClientPath } from "../filesystem/paths.js";
import { attachWebSocketUpgradeRoute } from "../websocket/upgrade-router.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_TIMEOUT_MS = 5 * 60_000;
const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_FILE_BYTES = 50 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ATTACHMENT_CHUNK_BYTES = 512 * 1024;
const DEFAULT_ATTACHMENT_MIME_TYPE = "application/octet-stream";

const jsonHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type",
  "content-type": "application/json",
} as const;

export interface BrowserControlService {
  readonly broker: BrowserControlBroker;
  readonly socketServer: WebSocketServer;
  readonly handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
}

export interface BrowserControlServiceOptions {
  readonly filesystemRootPath?: string;
}

export interface BrowserControlStatus {
  readonly connected: boolean;
  readonly clientId: string | null;
  readonly capabilities: string[];
  readonly lastSeenAt: string | null;
}

export type BrowserControlCliInput = BrowserControlRequest & {
  readonly targetUserId?: string;
  readonly timeoutMs?: number;
  readonly clientRequestId?: string;
  readonly attachments?: readonly BrowserControlAttachmentInput[];
};

export type BrowserControlBrokerInput = BrowserControlRequest & {
  readonly targetUserId?: string;
  readonly timeoutMs?: number;
  readonly clientRequestId?: string;
  readonly attachments?: readonly BrowserControlResolvedAttachment[];
};

export type BrowserControlRequest =
  | { readonly command: "getTabs"; readonly params: BrowserControlGetTabsParams }
  | { readonly command: "createNewTab"; readonly params: BrowserControlCreateNewTabParams }
  | { readonly command: "closeTab"; readonly params: BrowserControlCloseTabParams }
  | { readonly command: "tab.focus"; readonly params: BrowserControlTabTargetParams }
  | { readonly command: "tab.back"; readonly params: BrowserControlTabNavigationParams }
  | { readonly command: "tab.forward"; readonly params: BrowserControlTabNavigationParams }
  | { readonly command: "tab.goTo"; readonly params: BrowserControlTabGoToParams }
  | { readonly command: "tab.refresh"; readonly params: BrowserControlTabRefreshParams }
  | { readonly command: "tab.evaluate"; readonly params: BrowserControlTabEvaluateParams }
  | { readonly command: "tab.cdp"; readonly params: BrowserControlTabCdpParams };

export interface BrowserControlGetTabsParams {
  readonly windowId?: number;
  readonly currentWindow?: boolean;
  readonly active?: boolean;
}

export interface BrowserControlCreateNewTabParams {
  readonly tabs: readonly BrowserControlCreateNewTabTarget[];
  readonly waitForLoad?: BrowserControlWaitForLoad;
}

export interface BrowserControlCreateNewTabTarget {
  readonly url?: string;
  readonly active?: boolean;
  readonly windowId?: number;
  readonly index?: number;
  readonly openerTabId?: number;
}

export interface BrowserControlCloseTabParams {
  readonly tabIds: readonly number[];
}

export interface BrowserControlTabTargetParams {
  readonly tabId: number;
}

export interface BrowserControlTabNavigationParams extends BrowserControlTabTargetParams {
  readonly waitForLoad?: BrowserControlWaitForLoad;
}

export interface BrowserControlTabGoToParams extends BrowserControlTabTargetParams {
  readonly url: string;
  readonly waitForLoad?: BrowserControlWaitForLoad;
}

export interface BrowserControlTabRefreshParams extends BrowserControlTabTargetParams {
  readonly bypassCache?: boolean;
  readonly waitForLoad?: BrowserControlWaitForLoad;
}

export type BrowserControlWaitForLoad =
  | boolean
  | {
      readonly timeoutMs?: number;
      readonly waitUntil?: "domcontentloaded" | "complete" | "networkIdle";
    };

export interface BrowserControlTabEvaluateParams extends BrowserControlTabTargetParams {
  readonly expression: string;
  readonly awaitPromise?: boolean;
  readonly returnByValue?: boolean;
  readonly timeoutMs?: number;
}

export interface BrowserControlTabCdpParams extends BrowserControlTabTargetParams {
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface BrowserControlAttachmentInput {
  readonly id: string;
  readonly path: string;
  readonly name?: string;
  readonly mimeType?: string;
}

export interface BrowserControlAttachmentMetadata {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
}

export interface BrowserControlResolvedAttachment extends BrowserControlAttachmentMetadata {
  readonly absolutePath: string;
  readonly mtimeMs: number;
}

type BrowserControlCliResult =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: BrowserControlErrorPayload };

interface BrowserControlErrorPayload {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

interface BrowserControlClient {
  readonly connectionId: string;
  readonly userId: string;
  readonly accessSessionId: string;
  readonly webSocket: WebSocket;
  clientId: string | null;
  capabilities: string[];
  lastSeenAt: number;
  isReady: boolean;
  readonly pendingRequestIds: Set<string>;
}

interface PendingBrowserControlRequest {
  readonly requestId: string;
  readonly client: BrowserControlClient;
  readonly attachmentsById: Map<string, BrowserControlResolvedAttachment>;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly resolve: (result: BrowserControlCliResult) => void;
  completed: boolean;
}

type BrowserControlClientMessage =
  | {
      readonly type: "hello";
      readonly protocolVersion: number;
      readonly clientId: string;
      readonly capabilities: string[];
    }
  | {
      readonly type: "response";
      readonly requestId: string;
      readonly ok: true;
      readonly result: unknown;
    }
  | {
      readonly type: "response";
      readonly requestId: string;
      readonly ok: false;
      readonly error: BrowserControlErrorPayload;
    }
  | {
      readonly type: "attachment.read";
      readonly requestId: string;
      readonly chunkRequestId: string;
      readonly attachmentId: string;
      readonly offset: number;
      readonly length: number;
    };

export const createBrowserControlService = (
  options: BrowserControlServiceOptions = {},
): BrowserControlService => {
  const broker = new BrowserControlBroker();
  const socketServer = new WebSocketServer({ noServer: true });

  socketServer.on("connection", (webSocket, request) => {
    const userId = readHeader(request, "x-heysnap-user-id");
    const accessSessionId = readHeader(request, "x-heysnap-access-session-id");

    if (userId === undefined || accessSessionId === undefined) {
      webSocket.close(1008, "Browser-control user metadata is required");
      return;
    }

    broker.attachClient(webSocket, { userId, accessSessionId });
  });

  return {
    broker,
    socketServer,
    handleRequest: async (request, response) =>
      handleBrowserControlHttpRequest(request, response, broker, options),
  };
};

export const attachBrowserControlWebSocketServer = (
  server: Server,
  service: BrowserControlService,
): void => {
  attachWebSocketUpgradeRoute(server, "/browser-control", service.socketServer);
};

export class BrowserControlBroker {
  private readonly clientsByUserId = new Map<string, Set<BrowserControlClient>>();
  private readonly pendingRequests = new Map<string, PendingBrowserControlRequest>();

  attachClient(
    webSocket: WebSocket,
    input: {
      readonly userId: string;
      readonly accessSessionId: string;
    },
  ): void {
    const client: BrowserControlClient = {
      connectionId: randomUUID(),
      userId: input.userId,
      accessSessionId: input.accessSessionId,
      webSocket,
      clientId: null,
      capabilities: [],
      lastSeenAt: Date.now(),
      isReady: false,
      pendingRequestIds: new Set(),
    };

    let clients = this.clientsByUserId.get(client.userId);
    if (clients === undefined) {
      clients = new Set();
      this.clientsByUserId.set(client.userId, clients);
    }
    clients.add(client);

    webSocket.on("message", (data) => {
      this.handleClientMessage(client, data);
    });
    webSocket.on("close", () => {
      this.detachClient(client, "BROWSER_CONTROL_CLIENT_DISCONNECTED", "Browser-control client disconnected.");
    });
    webSocket.on("error", () => {
      this.detachClient(client, "BROWSER_CONTROL_CLIENT_DISCONNECTED", "Browser-control client errored.");
    });
  }

  getStatus(userId: string): BrowserControlStatus {
    const client = this.selectClient(userId);
    return clientToStatus(client);
  }

  getStatusForLatestClient(): BrowserControlStatus {
    return clientToStatus(this.selectLatestClient());
  }

  async execute(
    input: BrowserControlBrokerInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<BrowserControlCliResult> {
    const client = input.targetUserId === undefined
      ? this.selectLatestClient()
      : this.selectClient(input.targetUserId);

    if (client === null) {
      return browserControlError(
        "CHROME_NOT_CONNECTED",
        input.targetUserId === undefined
          ? "Chrome is not connected. Open the machine workspace in Chrome and keep it connected."
          : "Chrome is not connected for the target user. Open the machine workspace in Chrome and keep it connected.",
      );
    }

    const requestId = randomUUID();
    const timeoutMs = normalizeTimeoutMs(input.timeoutMs);

    return await new Promise<BrowserControlCliResult>((resolve) => {
      const complete = (result: BrowserControlCliResult): void => {
        const pending = this.pendingRequests.get(requestId);

        if (pending === undefined || pending.completed) {
          return;
        }

        pending.completed = true;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);
        client.pendingRequestIds.delete(requestId);
        options.signal?.removeEventListener("abort", handleAbort);
        resolve(result);
      };

      const sendCancel = (reason: string): void => {
        if (client.webSocket.readyState === WebSocket.OPEN) {
          client.webSocket.send(JSON.stringify({ type: "cancel", requestId, reason }));
        }
      };

      const handleAbort = (): void => {
        sendCancel("Browser-control request cancelled");
        complete(browserControlError("BROWSER_CONTROL_CANCELLED", "Browser-control request was cancelled."));
      };

      const timeout = setTimeout(() => {
        sendCancel("Browser-control request timed out");
        complete(browserControlError("BROWSER_CONTROL_TIMEOUT", "Browser-control client did not respond before the timeout."));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        requestId,
        client,
        attachmentsById: new Map((input.attachments ?? []).map((attachment) => [attachment.id, attachment])),
        timeout,
        resolve: complete,
        completed: false,
      });
      client.pendingRequestIds.add(requestId);

      if (options.signal?.aborted === true) {
        handleAbort();
        return;
      }

      options.signal?.addEventListener("abort", handleAbort, { once: true });

      client.webSocket.send(JSON.stringify({
        type: "request",
        requestId,
        command: input.command,
        params: input.params,
        timeoutMs,
        clientRequestId: input.clientRequestId,
        attachments: input.attachments?.map(attachmentToMetadata),
      }));
    });
  }

  private handleClientMessage(client: BrowserControlClient, data: RawData): void {
    const message = parseClientMessage(data);

    if (message === null) {
      client.webSocket.close(1003, "Invalid browser-control message");
      this.detachClient(client, "BROWSER_CONTROL_PROTOCOL_ERROR", "Browser-control client sent an invalid message.");
      return;
    }

    client.lastSeenAt = Date.now();

    if (message.type === "hello") {
      client.clientId = message.clientId;
      client.capabilities = message.capabilities;
      client.isReady = true;
      return;
    }

    if (message.type === "attachment.read") {
      void this.handleAttachmentRead(client, message);
      return;
    }

    const pending = this.pendingRequests.get(message.requestId);

    if (pending === undefined || pending.client !== client) {
      return;
    }

    if (message.ok) {
      pending.resolve({ ok: true, result: message.result });
      return;
    }

    pending.resolve({ ok: false, error: normalizeClientError(message.error) });
  }

  private async handleAttachmentRead(
    client: BrowserControlClient,
    message: Extract<BrowserControlClientMessage, { readonly type: "attachment.read" }>,
  ): Promise<void> {
    const pending = this.pendingRequests.get(message.requestId);

    if (pending === undefined || pending.client !== client || pending.completed) {
      this.sendAttachmentError(client, message, "BROWSER_ATTACHMENT_REQUEST_NOT_FOUND", "Browser-control request is no longer pending.");
      return;
    }

    if (message.length <= 0 || message.length > MAX_ATTACHMENT_CHUNK_BYTES) {
      this.sendAttachmentError(client, message, "BROWSER_ATTACHMENT_RANGE_INVALID", `Attachment chunks must be between 1 and ${String(MAX_ATTACHMENT_CHUNK_BYTES)} bytes.`);
      return;
    }

    const attachment = pending.attachmentsById.get(message.attachmentId);

    if (attachment === undefined) {
      this.sendAttachmentError(client, message, "BROWSER_ATTACHMENT_NOT_FOUND", "Browser-control attachment was not found on this request.");
      return;
    }

    if (message.offset < 0 || message.offset > attachment.size) {
      this.sendAttachmentError(client, message, "BROWSER_ATTACHMENT_RANGE_INVALID", "Attachment read offset is outside the file.");
      return;
    }

    try {
      const chunk = await readAttachmentChunk(attachment, message.offset, message.length);
      const currentPending = this.pendingRequests.get(message.requestId);

      if (currentPending === undefined || currentPending.client !== client || currentPending.completed) {
        return;
      }

      sendWebSocketJson(client.webSocket, {
        type: "attachment.chunk",
        requestId: message.requestId,
        chunkRequestId: message.chunkRequestId,
        attachmentId: message.attachmentId,
        offset: message.offset,
        dataBase64: chunk.data.toString("base64"),
        done: chunk.done,
      });
    } catch (error) {
      const attachmentError = toAttachmentReadError(error);
      this.sendAttachmentError(client, message, attachmentError.code, attachmentError.message);
    }
  }

  private sendAttachmentError(
    client: BrowserControlClient,
    message: Extract<BrowserControlClientMessage, { readonly type: "attachment.read" }>,
    code: string,
    errorMessage: string,
  ): void {
    sendWebSocketJson(client.webSocket, {
      type: "attachment.error",
      requestId: message.requestId,
      chunkRequestId: message.chunkRequestId,
      attachmentId: message.attachmentId,
      error: {
        code,
        message: errorMessage,
      },
    });
  }

  private detachClient(client: BrowserControlClient, code: string, message: string): void {
    const clients = this.clientsByUserId.get(client.userId);
    clients?.delete(client);

    if (clients?.size === 0) {
      this.clientsByUserId.delete(client.userId);
    }

    for (const requestId of [...client.pendingRequestIds]) {
      const pending = this.pendingRequests.get(requestId);

      if (pending !== undefined) {
        pending.resolve(browserControlError(code, message));
      }
    }
  }

  private selectClient(userId: string): BrowserControlClient | null {
    const clients = this.clientsByUserId.get(userId);

    if (clients === undefined) {
      return null;
    }

    const readyClients = [...clients].filter((client) =>
      client.isReady && client.webSocket.readyState === WebSocket.OPEN
    );

    if (readyClients.length === 0) {
      return null;
    }

    return readyClients.reduce((latest, candidate) =>
      candidate.lastSeenAt >= latest.lastSeenAt ? candidate : latest
    );
  }

  private selectLatestClient(): BrowserControlClient | null {
    const readyClients = [...this.clientsByUserId.values()]
      .flatMap((clients) => [...clients])
      .filter((client) => client.isReady && client.webSocket.readyState === WebSocket.OPEN);

    if (readyClients.length === 0) {
      return null;
    }

    return readyClients.reduce((latest, candidate) =>
      candidate.lastSeenAt >= latest.lastSeenAt ? candidate : latest
    );
  }
}

const handleBrowserControlHttpRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  broker: BrowserControlBroker,
  options: BrowserControlServiceOptions,
): Promise<boolean> => {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (!requestUrl.pathname.startsWith("/browser-control")) {
    return false;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, jsonHeaders);
    response.end();
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/browser-control/status") {
    const userId = requestUrl.searchParams.get("userId")?.trim();

    sendJson(response, 200, {
      status: userId === undefined || userId.length === 0
        ? broker.getStatusForLatestClient()
        : broker.getStatus(userId),
    });
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/browser-control/requests") {
    const abortController = new AbortController();
    response.on("close", () => {
      if (!response.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const input = parseCliInput(await readJsonBody(request));
      const attachments = await resolveBrowserControlAttachments(input.attachments, options.filesystemRootPath);
      const result = await broker.execute({
        ...input,
        attachments,
      }, { signal: abortController.signal });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, browserControlError(
        "INVALID_REQUEST",
        error instanceof Error ? error.message : "Invalid browser-control request.",
      ));
    }
    return true;
  }

  sendJson(response, 404, browserControlError("NOT_FOUND", "Browser-control endpoint not found."));
  return true;
};

const clientToStatus = (client: BrowserControlClient | null): BrowserControlStatus => {
  if (client === null) {
    return {
      connected: false,
      clientId: null,
      capabilities: [],
      lastSeenAt: null,
    };
  }

  return {
    connected: true,
    clientId: client.clientId,
    capabilities: client.capabilities,
    lastSeenAt: new Date(client.lastSeenAt).toISOString(),
  };
};

const parseCliInput = (body: unknown): BrowserControlCliInput => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Browser-control request body must be a JSON object.");
  }

  const input = body as Record<string, unknown>;
  const targetUserId = readNonEmptyString(input["targetUserId"]);
  const timeoutMs = input["timeoutMs"];
  const clientRequestId = input["clientRequestId"];
  const attachments = parseBrowserControlAttachmentInputs(input["attachments"]);
  const request = parseBrowserControlRequest(input);

  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || typeof timeoutMs !== "number" || timeoutMs <= 0)) {
    throw new Error("timeoutMs must be a positive number.");
  }

  if (clientRequestId !== undefined && typeof clientRequestId !== "string") {
    throw new Error("clientRequestId must be a string.");
  }

  return {
    targetUserId,
    ...request,
    timeoutMs: typeof timeoutMs === "number" ? timeoutMs : undefined,
    clientRequestId: typeof clientRequestId === "string" ? clientRequestId : undefined,
    attachments,
  };
};

const parseBrowserControlAttachmentInputs = (value: unknown): readonly BrowserControlAttachmentInput[] | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error("attachments must be an array.");
  }

  if (value.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`attachments cannot include more than ${String(MAX_ATTACHMENT_COUNT)} files.`);
  }

  const seenIds = new Set<string>();
  return value.map((entry, index) => {
    const label = `attachments[${String(index)}]`;
    const attachment = readRequiredObject(entry, label);
    assertAllowedKeys(attachment, label, ["id", "path", "name", "mimeType"]);
    const id = readRequiredNonEmptyString(attachment["id"], `${label}.id`);

    if (seenIds.has(id)) {
      throw new Error(`attachments includes duplicate id "${id}".`);
    }
    seenIds.add(id);

    return stripUndefined({
      id,
      path: readRequiredNonEmptyString(attachment["path"], `${label}.path`),
      name: readOptionalNonEmptyString(attachment["name"], `${label}.name`),
      mimeType: readOptionalNonEmptyString(attachment["mimeType"], `${label}.mimeType`),
    });
  });
};

const resolveBrowserControlAttachments = async (
  attachments: readonly BrowserControlAttachmentInput[] | undefined,
  filesystemRootPath: string | undefined,
): Promise<readonly BrowserControlResolvedAttachment[] | undefined> => {
  if (attachments === undefined || attachments.length === 0) {
    return undefined;
  }

  if (filesystemRootPath === undefined) {
    throw new Error("Browser-control attachments are unavailable because the filesystem root is not configured.");
  }

  const realRootPath = await realpath(filesystemRootPath);
  const resolvedAttachments: BrowserControlResolvedAttachment[] = [];
  let totalSize = 0;

  for (const attachment of attachments) {
    const targetPath = resolveClientPath(filesystemRootPath, attachment.path);
    let realTargetPath: string;

    try {
      realTargetPath = await realpath(targetPath);
    } catch {
      throw new Error(`attachments.${attachment.id}.path was not found.`);
    }

    ensureWithinRoot(realRootPath, realTargetPath);
    const targetStats = await stat(realTargetPath);

    if (!targetStats.isFile()) {
      throw new Error(`attachments.${attachment.id}.path must point to a file.`);
    }

    if (targetStats.size > MAX_ATTACHMENT_FILE_BYTES) {
      throw new Error(`attachments.${attachment.id}.path exceeds the ${String(MAX_ATTACHMENT_FILE_BYTES)} byte per-file limit.`);
    }

    totalSize += targetStats.size;
    if (totalSize > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new Error(`attachments exceed the ${String(MAX_ATTACHMENT_TOTAL_BYTES)} byte total limit.`);
    }

    resolvedAttachments.push({
      id: attachment.id,
      absolutePath: realTargetPath,
      name: attachment.name ?? basename(realTargetPath),
      mimeType: attachment.mimeType ?? DEFAULT_ATTACHMENT_MIME_TYPE,
      size: targetStats.size,
      mtimeMs: targetStats.mtimeMs,
    });
  }

  return resolvedAttachments;
};

const attachmentToMetadata = (
  attachment: BrowserControlResolvedAttachment,
): BrowserControlAttachmentMetadata => ({
  id: attachment.id,
  name: attachment.name,
  mimeType: attachment.mimeType,
  size: attachment.size,
});

const supportedBrowserControlCommands = [
  "getTabs",
  "createNewTab",
  "closeTab",
  "tab.focus",
  "tab.back",
  "tab.forward",
  "tab.goTo",
  "tab.refresh",
  "tab.evaluate",
  "tab.cdp",
] as const;

const parseBrowserControlRequest = (input: Record<string, unknown>): BrowserControlRequest => {
  const command = readNonEmptyString(input["command"]);

  if (command === undefined) {
    throw new Error("command is required.");
  }

  switch (command) {
    case "getTabs":
      return { command, params: parseGetTabsParams(input["params"]) };
    case "createNewTab":
      return { command, params: parseCreateNewTabParams(input["params"]) };
    case "closeTab":
      return { command, params: parseCloseTabParams(input["params"]) };
    case "tab.focus":
      return { command, params: parseTabTargetParams(input["params"], `${command}.params`) };
    case "tab.back":
    case "tab.forward":
      return { command, params: parseTabNavigationParams(input["params"], `${command}.params`) };
    case "tab.goTo":
      return { command, params: parseTabGoToParams(input["params"]) };
    case "tab.refresh":
      return { command, params: parseTabRefreshParams(input["params"]) };
    case "tab.evaluate":
      return { command, params: parseTabEvaluateParams(input["params"]) };
    case "tab.cdp":
      return { command, params: parseTabCdpParams(input["params"]) };
    default:
      throw new Error(`Unsupported browser-control command "${command}". Supported commands: ${supportedBrowserControlCommands.join(", ")}.`);
  }
};

const parseGetTabsParams = (value: unknown): BrowserControlGetTabsParams => {
  const params = readOptionalObject(value, "getTabs.params");

  if (params === undefined) {
    return {};
  }

  assertAllowedKeys(params, "getTabs.params", ["windowId", "currentWindow", "active"]);
  return stripUndefined({
    windowId: readOptionalInteger(params["windowId"], "getTabs.params.windowId"),
    currentWindow: readOptionalBoolean(params["currentWindow"], "getTabs.params.currentWindow"),
    active: readOptionalBoolean(params["active"], "getTabs.params.active"),
  });
};

const parseCreateNewTabParams = (value: unknown): BrowserControlCreateNewTabParams => {
  const params = readOptionalObject(value, "createNewTab.params");

  if (params === undefined) {
    return { tabs: [{}] };
  }

  if (params["tabs"] !== undefined) {
    assertAllowedKeys(params, "createNewTab.params", ["tabs", "waitForLoad"]);

    if (!Array.isArray(params["tabs"]) || params["tabs"].length === 0) {
      throw new Error("createNewTab.params.tabs must be a non-empty array.");
    }

    return stripUndefined({
      tabs: params["tabs"].map((tab, index) => parseCreateNewTabTarget(tab, `createNewTab.params.tabs[${String(index)}]`)),
      waitForLoad: parseWaitForLoad(params["waitForLoad"], "createNewTab.params.waitForLoad"),
    });
  }

  assertAllowedKeys(params, "createNewTab.params", ["url", "active", "windowId", "index", "openerTabId", "waitForLoad"]);
  const target = { ...params };
  delete target["waitForLoad"];
  return stripUndefined({
    tabs: [parseCreateNewTabTarget(target, "createNewTab.params")],
    waitForLoad: parseWaitForLoad(params["waitForLoad"], "createNewTab.params.waitForLoad"),
  });
};

const parseCreateNewTabTarget = (value: unknown, label: string): BrowserControlCreateNewTabTarget => {
  const target = readRequiredObject(value, label);
  assertAllowedKeys(target, label, ["url", "active", "windowId", "index", "openerTabId"]);
  return stripUndefined({
    url: readOptionalNonEmptyString(target["url"], `${label}.url`),
    active: readOptionalBoolean(target["active"], `${label}.active`),
    windowId: readOptionalInteger(target["windowId"], `${label}.windowId`),
    index: readOptionalInteger(target["index"], `${label}.index`),
    openerTabId: readOptionalInteger(target["openerTabId"], `${label}.openerTabId`),
  });
};

const parseCloseTabParams = (value: unknown): BrowserControlCloseTabParams => {
  const params = readRequiredObject(value, "closeTab.params");
  assertAllowedKeys(params, "closeTab.params", ["tabId", "tabIds"]);

  const hasTabId = params["tabId"] !== undefined;
  const hasTabIds = params["tabIds"] !== undefined;

  if (hasTabId === hasTabIds) {
    throw new Error("closeTab.params must include exactly one of tabId or tabIds.");
  }

  if (hasTabId) {
    return { tabIds: [readRequiredInteger(params["tabId"], "closeTab.params.tabId")] };
  }

  if (!Array.isArray(params["tabIds"]) || params["tabIds"].length === 0) {
    throw new Error("closeTab.params.tabIds must be a non-empty array.");
  }

  return {
    tabIds: params["tabIds"].map((tabId, index) => readRequiredInteger(tabId, `closeTab.params.tabIds[${String(index)}]`)),
  };
};

const parseTabTargetParams = (value: unknown, label: string): BrowserControlTabTargetParams => {
  const params = readRequiredObject(value, label);
  assertAllowedKeys(params, label, ["tabId"]);
  return {
    tabId: readRequiredInteger(params["tabId"], `${label}.tabId`),
  };
};

const parseTabNavigationParams = (value: unknown, label: string): BrowserControlTabNavigationParams => {
  const params = readRequiredObject(value, label);
  assertAllowedKeys(params, label, ["tabId", "waitForLoad"]);
  return stripUndefined({
    tabId: readRequiredInteger(params["tabId"], `${label}.tabId`),
    waitForLoad: parseWaitForLoad(params["waitForLoad"], `${label}.waitForLoad`),
  });
};

const parseTabGoToParams = (value: unknown): BrowserControlTabGoToParams => {
  const params = readRequiredObject(value, "tab.goTo.params");
  assertAllowedKeys(params, "tab.goTo.params", ["tabId", "url", "waitForLoad"]);
  return stripUndefined({
    tabId: readRequiredInteger(params["tabId"], "tab.goTo.params.tabId"),
    url: readRequiredNonEmptyString(params["url"], "tab.goTo.params.url"),
    waitForLoad: parseWaitForLoad(params["waitForLoad"], "tab.goTo.params.waitForLoad"),
  });
};

const parseTabRefreshParams = (value: unknown): BrowserControlTabRefreshParams => {
  const params = readRequiredObject(value, "tab.refresh.params");
  assertAllowedKeys(params, "tab.refresh.params", ["tabId", "bypassCache", "waitForLoad"]);
  return stripUndefined({
    tabId: readRequiredInteger(params["tabId"], "tab.refresh.params.tabId"),
    bypassCache: readOptionalBoolean(params["bypassCache"], "tab.refresh.params.bypassCache"),
    waitForLoad: parseWaitForLoad(params["waitForLoad"], "tab.refresh.params.waitForLoad"),
  });
};

const parseTabEvaluateParams = (value: unknown): BrowserControlTabEvaluateParams => {
  const params = readRequiredObject(value, "tab.evaluate.params");
  assertAllowedKeys(params, "tab.evaluate.params", ["tabId", "expression", "awaitPromise", "returnByValue", "timeoutMs"]);
  return stripUndefined({
    tabId: readRequiredInteger(params["tabId"], "tab.evaluate.params.tabId"),
    expression: readRequiredNonEmptyString(params["expression"], "tab.evaluate.params.expression"),
    awaitPromise: readOptionalBoolean(params["awaitPromise"], "tab.evaluate.params.awaitPromise"),
    returnByValue: readOptionalBoolean(params["returnByValue"], "tab.evaluate.params.returnByValue"),
    timeoutMs: readOptionalPositiveInteger(params["timeoutMs"], "tab.evaluate.params.timeoutMs"),
  });
};

const parseTabCdpParams = (value: unknown): BrowserControlTabCdpParams => {
  const params = readRequiredObject(value, "tab.cdp.params");
  assertAllowedKeys(params, "tab.cdp.params", ["tabId", "method", "params"]);
  return stripUndefined({
    tabId: readRequiredInteger(params["tabId"], "tab.cdp.params.tabId"),
    method: readRequiredNonEmptyString(params["method"], "tab.cdp.params.method"),
    params: params["params"] === undefined ? undefined : readRequiredObject(params["params"], "tab.cdp.params.params"),
  });
};

const parseWaitForLoad = (value: unknown, label: string): BrowserControlWaitForLoad | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const params = readRequiredObject(value, label);
  assertAllowedKeys(params, label, ["timeoutMs", "waitUntil"]);
  const waitUntil = params["waitUntil"];

  if (
    waitUntil !== undefined &&
    waitUntil !== "domcontentloaded" &&
    waitUntil !== "complete" &&
    waitUntil !== "networkIdle"
  ) {
    throw new Error(`${label}.waitUntil must be domcontentloaded, complete, or networkIdle.`);
  }
  const parsedWaitUntil = waitUntil as "domcontentloaded" | "complete" | "networkIdle" | undefined;

  return stripUndefined({
    timeoutMs: readOptionalPositiveInteger(params["timeoutMs"], `${label}.timeoutMs`),
    waitUntil: parsedWaitUntil,
  });
};

const parseClientMessage = (data: RawData): BrowserControlClientMessage | null => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawDataToText(data)) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const message = parsed as Record<string, unknown>;

  if (message["type"] === "hello") {
    const clientId = readNonEmptyString(message["clientId"]);
    const capabilities = message["capabilities"];

    if (
      typeof message["protocolVersion"] !== "number" ||
      clientId === undefined ||
      !Array.isArray(capabilities) ||
      !capabilities.every((capability) => typeof capability === "string")
    ) {
      return null;
    }

    return {
      type: "hello",
      protocolVersion: message["protocolVersion"],
      clientId,
      capabilities,
    };
  }

  if (message["type"] === "response") {
    const requestId = readNonEmptyString(message["requestId"]);

    if (requestId === undefined) {
      return null;
    }

    if (message["ok"] === true) {
      return {
        type: "response",
        requestId,
        ok: true,
        result: message["result"],
      };
    }

    if (message["ok"] === false) {
      return {
        type: "response",
        requestId,
        ok: false,
        error: normalizeClientError(message["error"]),
      };
    }
  }

  if (message["type"] === "attachment.read") {
    const requestId = readNonEmptyString(message["requestId"]);
    const chunkRequestId = readNonEmptyString(message["chunkRequestId"]);
    const attachmentId = readNonEmptyString(message["attachmentId"]);
    const offset = message["offset"];
    const length = message["length"];

    if (
      requestId === undefined ||
      chunkRequestId === undefined ||
      attachmentId === undefined ||
      !isNonNegativeInteger(offset) ||
      !isPositiveInteger(length)
    ) {
      return null;
    }

    return {
      type: "attachment.read",
      requestId,
      chunkRequestId,
      attachmentId,
      offset,
      length,
    };
  }

  return null;
};

const readAttachmentChunk = async (
  attachment: BrowserControlResolvedAttachment,
  offset: number,
  length: number,
): Promise<{ readonly data: Buffer; readonly done: boolean }> => {
  const file = await open(attachment.absolutePath, "r");

  try {
    const currentStats = await file.stat();

    if (currentStats.size !== attachment.size || currentStats.mtimeMs !== attachment.mtimeMs) {
      throw new AttachmentReadError("BROWSER_ATTACHMENT_CHANGED", "Browser-control attachment changed after request validation.");
    }

    const remaining = Math.max(attachment.size - offset, 0);
    const readLength = Math.min(length, remaining);
    const buffer = Buffer.alloc(readLength);

    if (readLength === 0) {
      return {
        data: buffer,
        done: true,
      };
    }

    const result = await file.read(buffer, 0, readLength, offset);
    return {
      data: result.bytesRead === buffer.byteLength ? buffer : buffer.subarray(0, result.bytesRead),
      done: offset + result.bytesRead >= attachment.size,
    };
  } finally {
    await file.close();
  }
};

class AttachmentReadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AttachmentReadError";
  }
}

const toAttachmentReadError = (error: unknown): BrowserControlErrorPayload => {
  if (error instanceof AttachmentReadError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  return {
    code: "BROWSER_ATTACHMENT_READ_FAILED",
    message: error instanceof Error ? error.message : "Failed to read browser-control attachment.",
  };
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const bodyText = Buffer.concat(chunks).toString("utf8");

  if (bodyText.length === 0) {
    return {};
  }

  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
};

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(body));
};

const browserControlError = (
  code: string,
  message: string,
  details?: unknown,
): BrowserControlCliResult => ({
  ok: false,
  error: details === undefined ? { code, message } : { code, message, details },
});

const normalizeClientError = (value: unknown): BrowserControlErrorPayload => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      code: "BROWSER_EXECUTOR_ERROR",
      message: "Browser executor failed.",
    };
  }

  const error = value as Record<string, unknown>;
  return {
    code: readNonEmptyString(error["code"]) ?? "BROWSER_EXECUTOR_ERROR",
    message: readNonEmptyString(error["message"]) ?? "Browser executor failed.",
    details: error["details"],
  };
};

const normalizeTimeoutMs = (timeoutMs: number | undefined): number => {
  if (timeoutMs === undefined) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  return Math.min(Math.max(timeoutMs, 1), MAX_REQUEST_TIMEOUT_MS);
};

const readNonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const readRequiredNonEmptyString = (value: unknown, label: string): string => {
  const stringValue = readNonEmptyString(value);

  if (stringValue === undefined) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return stringValue;
};

const readOptionalNonEmptyString = (value: unknown, label: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return readRequiredNonEmptyString(value, label);
};

const readRequiredInteger = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return value;
};

const readOptionalInteger = (value: unknown, label: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return readRequiredInteger(value, label);
};

const readOptionalPositiveInteger = (value: unknown, label: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
};

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const readOptionalBoolean = (value: unknown, label: string): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
};

const readOptionalObject = (value: unknown, label: string): Record<string, unknown> | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return readRequiredObject(value, label);
};

const readRequiredObject = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
};

const assertAllowedKeys = (
  value: Record<string, unknown>,
  label: string,
  allowedKeys: readonly string[],
): void => {
  const allowed = new Set(allowedKeys);
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));

  if (unknownKeys.length > 0) {
    throw new Error(`${label} includes unsupported field(s): ${unknownKeys.join(", ")}.`);
  }
};

const stripUndefined = <TValue extends Record<string, unknown>>(value: TValue): TValue =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as TValue;

const readHeader = (request: IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first.trim().length === 0 ? undefined : first.trim();
};

const rawDataToText = (data: RawData): string => {
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

const sendWebSocketJson = (webSocket: WebSocket, message: unknown): void => {
  if (webSocket.readyState === WebSocket.OPEN) {
    webSocket.send(JSON.stringify(message));
  }
};
