import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { WebSocket, type RawData } from "ws";

import { errorToLog, logger, sanitizeUrlPath } from "../shared/logger.js";

export interface MachineTunnelClientOptions {
  readonly cloudServerPublicUrl: string;
  readonly computerId: string;
  readonly tokenFile: string;
  readonly localPort: number;
  readonly reconnectMs?: number;
}

export const startMachineTunnelClient = (options: MachineTunnelClientOptions): void => {
  const client = new MachineTunnelClient(options);
  client.start();
};

class MachineTunnelClient {
  private cloudWebSocket: WebSocket | null = null;
  private readonly localConnections = new Map<string, LocalTunnelConnection>();
  private readonly httpAbortControllers = new Map<string, AbortController>();
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private cloudTunnelId: string | null = null;
  private cloudTunnelOpenedAt = 0;
  private cloudMessagesIn = 0;
  private cloudMessagesOut = 0;

  constructor(private readonly options: MachineTunnelClientOptions) {}

  start(): void {
    this.connectSoon(0);
  }

  private connectSoon(delayMs: number): void {
    if (this.stopped || this.reconnectTimer !== null) {
      return;
    }

    logger.info({
      event: "machine_tunnel_client.reconnect_scheduled",
      computerId: this.options.computerId,
      delayMs,
    }, "Machine tunnel reconnect scheduled");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delayMs);
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return;
    }

    const token = await this.readToken();

    if (token === null) {
      logger.warn({
        event: "machine_tunnel_client.token_missing",
        computerId: this.options.computerId,
        tokenFile: this.options.tokenFile,
      }, "Machine tunnel token is missing");
      this.connectSoon(this.options.reconnectMs ?? 5000);
      return;
    }

    const cloudTunnelId = randomUUID();
    this.cloudTunnelId = cloudTunnelId;
    this.cloudTunnelOpenedAt = Date.now();
    this.cloudMessagesIn = 0;
    this.cloudMessagesOut = 0;
    logger.info({
      event: "machine_tunnel_client.connect_start",
      computerId: this.options.computerId,
      cloudTunnelId,
      url: sanitizeUrlPath(buildTunnelUrl(this.options.cloudServerPublicUrl)),
      localPort: this.options.localPort,
    }, "Machine tunnel connecting");
    const webSocket = new WebSocket(buildTunnelUrl(this.options.cloudServerPublicUrl), {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    this.cloudWebSocket = webSocket;

    webSocket.on("open", () => {
      logger.info({
        event: "machine_tunnel_client.open",
        computerId: this.options.computerId,
        cloudTunnelId,
      }, "Machine tunnel connected");
    });
    webSocket.on("message", (data) => {
      this.cloudMessagesIn += 1;
      this.handleCloudMessage(data);
    });
    webSocket.on("close", (code, reason) => {
      logger.warn({
        event: "machine_tunnel_client.close",
        computerId: this.options.computerId,
        cloudTunnelId,
        closeCode: code,
        closeReason: reason.toString("utf8"),
        ageMs: Date.now() - this.cloudTunnelOpenedAt,
        localConnectionCount: this.localConnections.size,
        httpRequestCount: this.httpAbortControllers.size,
        messagesIn: this.cloudMessagesIn,
        messagesOut: this.cloudMessagesOut,
      }, "Machine tunnel closed");
      this.closeLocalConnections(1011, "Cloud tunnel closed");
      this.cloudWebSocket = null;
      this.connectSoon(this.options.reconnectMs ?? 5000);
    });
    webSocket.on("error", (error) => {
      logger.error({
        event: "machine_tunnel_client.error",
        computerId: this.options.computerId,
        cloudTunnelId,
        err: errorToLog(error),
      }, "Machine tunnel error");
      webSocket.close();
    });
  }

  private async readToken(): Promise<string | null> {
    try {
      const token = (await readFile(this.options.tokenFile, "utf8")).trim();
      return token.length > 0 ? token : null;
    } catch {
      return null;
    }
  }

  private handleCloudMessage(data: RawData): void {
    const message = parseCloudMessage(data);

    if (message === null) {
      this.cloudWebSocket?.close(1003, "Invalid tunnel message");
      return;
    }

    switch (message.type) {
      case "open":
        this.openLocalConnection(message.connectionId, message.path, message.metadata);
        break;
      case "httpRequest":
        void this.handleHttpRequest(message);
        break;
      case "data": {
        const localConnection = this.localConnections.get(message.connectionId);

        if (localConnection === undefined) {
          break;
        }

        if (localConnection.opened && localConnection.webSocket.readyState === WebSocket.OPEN) {
          localConnection.messagesOut += 1;
          localConnection.webSocket.send(tunnelPayloadToRawData(message));
        } else {
          localConnection.pendingData.push(message);
        }
        break;
      }
      case "close":
        this.httpAbortControllers.get(message.connectionId)?.abort();
        this.httpAbortControllers.delete(message.connectionId);
        this.localConnections.get(message.connectionId)?.webSocket.close(
          normalizeWebSocketCloseCode(message.code),
          message.reason,
        );
        this.localConnections.delete(message.connectionId);
        break;
    }
  }

  private async handleHttpRequest(message: Extract<CloudTunnelMessage, { readonly type: "httpRequest" }>): Promise<void> {
    const abortController = new AbortController();
    this.httpAbortControllers.set(message.connectionId, abortController);

    try {
      const response = await fetch(`http://127.0.0.1:${String(this.options.localPort)}${message.path}`, {
        method: message.method ?? "GET",
        headers: message.headers,
        body: message.bodyBase64 === undefined ? undefined : Buffer.from(message.bodyBase64, "base64"),
        signal: abortController.signal,
      });

      if (message.stream === true) {
        await this.streamHttpResponse(message.connectionId, response);
        return;
      }

      const body = Buffer.from(await response.arrayBuffer());
      this.sendToCloud({
        type: "httpResponse",
        connectionId: message.connectionId,
        statusCode: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        bodyBase64: body.toString("base64"),
      });
    } catch (error) {
      const body = Buffer.from(error instanceof Error ? error.message : "Failed to proxy HTTP request", "utf8");
      this.sendToCloud({
        type: "httpResponse",
        connectionId: message.connectionId,
        statusCode: 502,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
        bodyBase64: body.toString("base64"),
      });
    } finally {
      this.httpAbortControllers.delete(message.connectionId);
    }
  }

  private async streamHttpResponse(connectionId: string, response: Response): Promise<void> {
    this.sendToCloud({
      type: "httpResponseStart",
      connectionId,
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
    });

    if (response.body !== null) {
      const reader = response.body.getReader();

      for (;;) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        this.sendToCloud({
          type: "httpResponseChunk",
          connectionId,
          bodyBase64: Buffer.from(value).toString("base64"),
        });
      }
    }

    this.sendToCloud({ type: "httpResponseEnd", connectionId });
  }

  private openLocalConnection(
    connectionId: string,
    path: string,
    metadata: CloudTunnelOpenMetadata | undefined,
  ): void {
    const localWebSocket = new WebSocket(`ws://127.0.0.1:${String(this.options.localPort)}${path}`, {
      headers: buildLocalConnectionHeaders(metadata),
    });
    const localConnection: LocalTunnelConnection = {
      webSocket: localWebSocket,
      opened: false,
      openedAt: Date.now(),
      path,
      messagesIn: 0,
      messagesOut: 0,
      pendingData: [],
    };

    this.localConnections.set(connectionId, localConnection);
    logger.info({
      event: "machine_tunnel_client.local_ws.connect_start",
      computerId: this.options.computerId,
      cloudTunnelId: this.cloudTunnelId,
      connectionId,
      path: sanitizeUrlPath(path),
      userId: metadata?.userId,
      accessSessionId: metadata?.accessSessionId,
    }, "Opening local websocket for tunneled gateway connection");
    localWebSocket.on("open", () => {
      localConnection.opened = true;
      logger.info({
        event: "machine_tunnel_client.local_ws.open",
        computerId: this.options.computerId,
        cloudTunnelId: this.cloudTunnelId,
        connectionId,
        path: sanitizeUrlPath(path),
      }, "Local websocket opened");
      this.sendToCloud({ type: "openResult", connectionId, ok: true });

      for (const message of localConnection.pendingData.splice(0)) {
        localConnection.messagesOut += 1;
        localWebSocket.send(tunnelPayloadToRawData(message));
      }
    });
    localWebSocket.on("message", (data, isBinary) => {
      localConnection.messagesIn += 1;
      this.sendToCloud({
        type: "data",
        connectionId,
        ...rawDataToTunnelPayload(data, isBinary),
      });
    });
    localWebSocket.on("close", (code, reason) => {
      this.localConnections.delete(connectionId);
      logger.info({
        event: "machine_tunnel_client.local_ws.close",
        computerId: this.options.computerId,
        cloudTunnelId: this.cloudTunnelId,
        connectionId,
        path: sanitizeUrlPath(path),
        closeCode: code,
        closeReason: reason.toString("utf8"),
        ageMs: Date.now() - localConnection.openedAt,
        messagesIn: localConnection.messagesIn,
        messagesOut: localConnection.messagesOut,
      }, "Local websocket closed");
      this.sendToCloud({
        type: "close",
        connectionId,
        code: normalizeWebSocketCloseCode(code),
        reason: reason.toString("utf8"),
      });
    });
    localWebSocket.on("error", (error) => {
      this.localConnections.delete(connectionId);
      logger.error({
        event: "machine_tunnel_client.local_ws.error",
        computerId: this.options.computerId,
        cloudTunnelId: this.cloudTunnelId,
        connectionId,
        path: sanitizeUrlPath(path),
        err: errorToLog(error),
        ageMs: Date.now() - localConnection.openedAt,
      }, "Local websocket error");

      if (!localConnection.opened) {
        this.sendToCloud({
          type: "openResult",
          connectionId,
          ok: false,
          error: error instanceof Error ? error.message : "Failed to open local route",
        });
      }
    });
  }

  private sendToCloud(message: MachineTunnelMessage): void {
    if (this.cloudWebSocket?.readyState === WebSocket.OPEN) {
      this.cloudMessagesOut += 1;
      this.cloudWebSocket.send(JSON.stringify(message));
    }
  }

  private closeLocalConnections(code: number, reason: string): void {
    for (const localConnection of this.localConnections.values()) {
      localConnection.webSocket.close(code, reason);
    }

    this.localConnections.clear();
  }
}

interface LocalTunnelConnection {
  readonly webSocket: WebSocket;
  opened: boolean;
  readonly openedAt: number;
  readonly path: string;
  messagesIn: number;
  messagesOut: number;
  readonly pendingData: Extract<CloudTunnelMessage, { readonly type: "data" }>[];
}

type CloudTunnelMessage =
  | {
      readonly type: "open";
      readonly connectionId: string;
      readonly path: string;
      readonly metadata?: CloudTunnelOpenMetadata;
    }
  | {
      readonly type: "httpRequest";
      readonly connectionId: string;
      readonly path: string;
      readonly method?: string;
      readonly headers?: Record<string, string>;
      readonly bodyBase64?: string;
      readonly stream?: boolean;
    }
  | { readonly type: "data"; readonly connectionId: string; readonly data: string; readonly dataType?: TunnelPayloadType }
  | { readonly type: "close"; readonly connectionId: string; readonly code?: number; readonly reason?: string };

type MachineTunnelMessage =
  | { readonly type: "openResult"; readonly connectionId: string; readonly ok: true }
  | { readonly type: "openResult"; readonly connectionId: string; readonly ok: false; readonly error: string }
  | {
      readonly type: "httpResponse";
      readonly connectionId: string;
      readonly statusCode: number;
      readonly headers: Record<string, string>;
      readonly bodyBase64: string;
    }
  | {
      readonly type: "httpResponseStart";
      readonly connectionId: string;
      readonly statusCode: number;
      readonly headers: Record<string, string>;
    }
  | { readonly type: "httpResponseChunk"; readonly connectionId: string; readonly bodyBase64: string }
  | { readonly type: "httpResponseEnd"; readonly connectionId: string }
  | { readonly type: "data"; readonly connectionId: string; readonly data: string; readonly dataType: TunnelPayloadType }
  | { readonly type: "close"; readonly connectionId: string; readonly code?: number; readonly reason?: string };

type TunnelPayloadType = "text" | "binary";

interface CloudTunnelOpenMetadata {
  readonly userId?: string;
  readonly accessSessionId?: string;
  readonly computerId?: string;
}

const buildLocalConnectionHeaders = (
  metadata: CloudTunnelOpenMetadata | undefined,
): Record<string, string> | undefined => {
  const headers: Record<string, string> = {};

  if (metadata?.userId !== undefined) {
    headers["x-heysnap-user-id"] = metadata.userId;
  }

  if (metadata?.accessSessionId !== undefined) {
    headers["x-heysnap-access-session-id"] = metadata.accessSessionId;
  }

  if (metadata?.computerId !== undefined) {
    headers["x-heysnap-computer-id"] = metadata.computerId;
  }

  return Object.keys(headers).length === 0 ? undefined : headers;
};

const buildTunnelUrl = (cloudServerPublicUrl: string): string => {
  const url = new URL("/machines/tunnel", cloudServerPublicUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

const parseCloudMessage = (data: RawData): CloudTunnelMessage | null => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawDataToText(data)) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const message = parsed as Record<string, unknown>;

  if (typeof message["connectionId"] !== "string" || typeof message["type"] !== "string") {
    return null;
  }

  switch (message["type"]) {
    case "open":
      return typeof message["path"] === "string"
        ? {
            type: "open",
            connectionId: message["connectionId"],
            path: message["path"],
            metadata: parseOpenMetadata(message["metadata"]),
          }
        : null;
    case "httpRequest":
      return typeof message["path"] === "string"
        ? {
            type: "httpRequest",
            connectionId: message["connectionId"],
            path: message["path"],
            method: typeof message["method"] === "string" ? message["method"] : undefined,
            headers: isStringRecord(message["headers"]) ? message["headers"] : undefined,
            bodyBase64: typeof message["bodyBase64"] === "string" ? message["bodyBase64"] : undefined,
            stream: message["stream"] === true,
          }
        : null;
    case "data":
      return typeof message["data"] === "string"
        ? {
            type: "data",
            connectionId: message["connectionId"],
            data: message["data"],
            dataType: parseTunnelPayloadType(message["dataType"]),
          }
        : null;
    case "close":
      return {
        type: "close",
        connectionId: message["connectionId"],
        code: typeof message["code"] === "number" ? message["code"] : undefined,
        reason: typeof message["reason"] === "string" ? message["reason"] : undefined,
      };
    default:
      return null;
  }
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

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "string");
};

const rawDataToBase64 = (data: RawData): string => {
  if (typeof data === "string") {
    return Buffer.from(data, "utf8").toString("base64");
  }

  if (Buffer.isBuffer(data)) {
    return data.toString("base64");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("base64");
  }

  return Buffer.concat(data).toString("base64");
};

const rawDataToTunnelPayload = (
  data: RawData,
  isBinary: boolean,
): { readonly data: string; readonly dataType: TunnelPayloadType } => ({
  data: rawDataToBase64(data),
  dataType: isBinary ? "binary" : "text",
});

const tunnelPayloadToRawData = (
  message: { readonly data: string; readonly dataType?: TunnelPayloadType },
): string | Buffer => {
  const buffer = Buffer.from(message.data, "base64");
  return message.dataType === "text" ? buffer.toString("utf8") : buffer;
};

const parseTunnelPayloadType = (value: unknown): TunnelPayloadType | undefined =>
  value === "text" || value === "binary" ? value : undefined;

const parseOpenMetadata = (value: unknown): CloudTunnelOpenMetadata | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return {
    userId: typeof record["userId"] === "string" ? record["userId"] : undefined,
    accessSessionId: typeof record["accessSessionId"] === "string" ? record["accessSessionId"] : undefined,
    computerId: typeof record["computerId"] === "string" ? record["computerId"] : undefined,
  };
};

export const normalizeWebSocketCloseCode = (code: number | undefined): number => {
  if (code === undefined) {
    return 1000;
  }

  if (code === 1000 || (code >= 3000 && code <= 4999)) {
    return code;
  }

  if (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) {
    return code;
  }

  return 1000;
};
