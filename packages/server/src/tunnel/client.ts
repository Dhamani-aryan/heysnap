import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import {
  decodeTunnelBinaryFrame,
  encodeTunnelBinaryFrame,
  normalizeWebSocketCloseCode,
  parseTunnelControlMessage,
  profileForTrafficClass,
  profileForWebSocketRoute,
  stringifyTunnelControlMessage,
  TunnelSendScheduler,
  TUNNEL_OVERLOAD_CLOSE_CODE,
  TUNNEL_OVERLOAD_CLOSE_REASON,
  type TunnelControlMessage,
  type TunnelQueueProfile,
  type TunnelTrafficClass,
} from "@ank1015-app/tunnel-protocol";
import { WebSocket, type RawData } from "ws";

import { errorToLog, logger, sanitizeUrlPath } from "../shared/logger.js";

export { normalizeWebSocketCloseCode };

export interface MachineTunnelClientOptions {
  readonly cloudServerPublicUrl: string;
  readonly computerId: string;
  readonly tokenFile: string;
  readonly localPort: number;
  readonly reconnectMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
}

export const startMachineTunnelClient = (options: MachineTunnelClientOptions): MachineTunnelClient => {
  const client = new MachineTunnelClient(options);
  client.start();
  return client;
};

export class MachineTunnelClient {
  private cloudWebSocket: WebSocket | null = null;
  private readonly localConnections = new Map<string, LocalTunnelConnection>();
  private readonly httpAbortControllers = new Map<string, AbortController>();
  private readonly pendingHttpRequests = new Map<string, PendingHttpRequest>();
  private sendScheduler: TunnelSendScheduler | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private cloudTunnelId: string | null = null;
  private cloudTunnelOpenedAt = 0;
  private cloudMessagesIn = 0;
  private cloudMessagesOut = 0;

  constructor(private readonly options: MachineTunnelClientOptions) {}

  start(): void {
    this.connectSoon(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearHeartbeat();
    this.abortHttpRequests("Machine tunnel client stopped");
    this.closeLocalConnections(1000, "Machine tunnel client stopped");
    this.sendScheduler?.close(new Error("Machine tunnel client stopped"));
    this.pendingHttpRequests.clear();
    this.cloudWebSocket?.close(1000, "Machine tunnel client stopped");
    this.cloudWebSocket = null;
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
    this.sendScheduler = new TunnelSendScheduler({
      socket: webSocket,
      isOpen: () => this.cloudWebSocket === webSocket && webSocket.readyState === WebSocket.OPEN,
      onConnectionOverflow: (connectionId, profile, reason) => {
        this.closeLogicalConnectionForOverload(connectionId, profile, reason);
      },
      onSendError: (error) => {
        logger.warn({
          event: "machine_tunnel_client.send_error",
          computerId: this.options.computerId,
          cloudTunnelId,
          err: errorToLog(error),
        }, "Machine tunnel send failed");
      },
    });

    webSocket.on("open", () => {
      logger.info({
        event: "machine_tunnel_client.open",
        computerId: this.options.computerId,
        cloudTunnelId,
      }, "Machine tunnel connected");
      this.startHeartbeat(webSocket, cloudTunnelId);
    });
    webSocket.on("message", (data, isBinary) => {
      this.cloudMessagesIn += 1;
      this.handleCloudMessage(data, isBinary);
    });
    webSocket.on("pong", () => {
      this.clearHeartbeatTimeout();
    });
    webSocket.on("close", (code, reason) => {
      this.clearHeartbeat();
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
      this.abortHttpRequests("Cloud tunnel closed");
      this.sendScheduler?.close(new Error("Cloud tunnel closed"));
      this.pendingHttpRequests.clear();
      if (this.cloudWebSocket === webSocket) {
        this.sendScheduler = null;
      }
      this.cloudWebSocket = null;
      this.connectSoon(this.options.reconnectMs ?? 5000);
    });
    webSocket.on("error", (error) => {
      this.clearHeartbeat();
      logger.error({
        event: "machine_tunnel_client.error",
        computerId: this.options.computerId,
        cloudTunnelId,
        err: errorToLog(error),
      }, "Machine tunnel error");
      this.abortHttpRequests("Cloud tunnel errored");
      this.sendScheduler?.close(new Error("Cloud tunnel errored"));
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

  private handleCloudMessage(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      this.handleCloudBinaryFrame(data);
      return;
    }

    const message = parseTunnelControlMessage(rawDataToText(data));

    if (message === null) {
      this.cloudWebSocket?.close(1003, "Invalid tunnel message");
      return;
    }

    switch (message.type) {
      case "open":
        this.openLocalConnection(message.connectionId, message.path, message.route, message.metadata, message.trafficClass);
        break;
      case "httpRequestStart":
        this.startHttpRequest(message);
        break;
      case "httpRequestEnd":
        void this.finishHttpRequest(message.connectionId);
        break;
      case "openResult":
      case "httpResponseStart":
      case "httpResponseEnd":
        this.cloudWebSocket?.close(1003, "Unexpected tunnel control message");
        break;
      case "close":
        this.httpAbortControllers.get(message.connectionId)?.abort();
        this.httpAbortControllers.delete(message.connectionId);
        this.pendingHttpRequests.delete(message.connectionId);
        this.sendScheduler?.removeConnection(message.connectionId);
        this.localConnections.get(message.connectionId)?.webSocket.close(
          normalizeWebSocketCloseCode(message.code),
          message.reason,
        );
        this.localConnections.delete(message.connectionId);
        break;
    }
  }

  private handleCloudBinaryFrame(data: RawData): void {
    const frame = decodeTunnelBinaryFrame(rawDataToBinaryBuffer(data));

    if (frame === null) {
      this.cloudWebSocket?.close(1003, "Invalid tunnel binary frame");
      return;
    }

    switch (frame.type) {
      case "httpRequestBody":
        this.pendingHttpRequests.get(frame.connectionId)?.chunks.push(frame.payload);
        break;
      case "wsData": {
        const localConnection = this.localConnections.get(frame.connectionId);

        if (localConnection === undefined) {
          break;
        }

        if (localConnection.opened && localConnection.webSocket.readyState === WebSocket.OPEN) {
          if (localConnection.webSocket.bufferedAmount + frame.payload.byteLength > localConnection.profile.maxQueuedBytes) {
            this.closeLogicalConnectionForOverload(frame.connectionId, localConnection.profile, TUNNEL_OVERLOAD_CLOSE_REASON);
            break;
          }

          localConnection.messagesOut += 1;
          localConnection.webSocket.send(frame.isText ? frame.payload.toString("utf8") : frame.payload);
        } else {
          if (localConnection.pendingDataBytes + frame.payload.byteLength > localConnection.profile.maxQueuedBytes) {
            this.closeLogicalConnectionForOverload(frame.connectionId, localConnection.profile, TUNNEL_OVERLOAD_CLOSE_REASON);
            break;
          }

          localConnection.pendingData.push(frame);
          localConnection.pendingDataBytes += frame.payload.byteLength;
        }
        break;
      }
      case "httpResponseBody":
        this.cloudWebSocket?.close(1003, "Unexpected tunnel binary frame");
        break;
    }
  }

  private startHttpRequest(message: Extract<TunnelControlMessage, { readonly type: "httpRequestStart" }>): void {
    const abortController = new AbortController();
    const profile = profileForTrafficClass(message.trafficClass);
    this.httpAbortControllers.set(message.connectionId, abortController);
    this.pendingHttpRequests.set(message.connectionId, {
      message,
      abortController,
      chunks: [],
      profile,
    });
  }

  private async finishHttpRequest(connectionId: string): Promise<void> {
    const pending = this.pendingHttpRequests.get(connectionId);

    if (pending === undefined) {
      return;
    }

    this.pendingHttpRequests.delete(connectionId);
    await this.handleHttpRequest(pending);
  }

  private async handleHttpRequest(pending: PendingHttpRequest): Promise<void> {
    const { message, abortController, profile } = pending;
    const requestBody = pending.chunks.length === 0 ? undefined : Buffer.concat(pending.chunks);
    const requestHeaders = toLocalHttpRequestHeaders(message.headers);

    try {
      const response = await fetch(`http://127.0.0.1:${String(this.options.localPort)}${message.path}`, {
        method: message.method ?? "GET",
        headers: requestHeaders,
        body: requestBody,
        signal: abortController.signal,
      });

      if (message.stream === true) {
        await this.streamHttpResponse(message.connectionId, response, profile);
        return;
      }

      const body = Buffer.from(await response.arrayBuffer());
      await this.sendHttpResponseStart(message.connectionId, response, profile);
      await this.sendBinaryToCloud({
        type: "httpResponseBody",
        connectionId: message.connectionId,
        payload: body,
        isText: false,
      }, profile);
      await this.sendControlToCloud({ type: "httpResponseEnd", connectionId: message.connectionId }, profile);
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      const errorMessage = toHttpProxyErrorMessage(error);
      logger.error({
        event: "machine_tunnel_client.http_proxy_error",
        computerId: this.options.computerId,
        cloudTunnelId: this.cloudTunnelId,
        connectionId: message.connectionId,
        method: message.method ?? "GET",
        path: sanitizeUrlPath(message.path),
        hasBody: requestBody !== undefined,
        bodyBytes: requestBody?.byteLength ?? 0,
        forwardedHeaderNames: Object.keys(message.headers ?? {}).sort(),
        localHeaderNames: Object.keys(requestHeaders ?? {}).sort(),
        err: errorToLog(error),
        cause: getErrorCauseLog(error),
      }, "Machine tunnel HTTP proxy request failed");
      const body = Buffer.from(JSON.stringify({
        error: {
          code: "MACHINE_HTTP_PROXY_FAILED",
          message: errorMessage,
        },
      }), "utf8");
      await this.sendControlToCloud({
        type: "httpResponseStart",
        connectionId: message.connectionId,
        statusCode: 502,
        headers: {
          "content-type": "application/json",
        },
      }, profile);
      await this.sendBinaryToCloud({
        type: "httpResponseBody",
        connectionId: message.connectionId,
        payload: body,
        isText: false,
      }, profile);
      await this.sendControlToCloud({ type: "httpResponseEnd", connectionId: message.connectionId }, profile);
    } finally {
      this.httpAbortControllers.delete(message.connectionId);
      this.sendScheduler?.removeConnection(message.connectionId);
    }
  }

  private async streamHttpResponse(connectionId: string, response: Response, profile: TunnelQueueProfile): Promise<void> {
    await this.sendHttpResponseStart(connectionId, response, profile);

    if (response.body !== null) {
      const reader = response.body.getReader();

      for (;;) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        await this.sendBinaryToCloud({
          type: "httpResponseBody",
          connectionId,
          payload: Buffer.from(value),
          isText: false,
        }, profile);
      }
    }

    await this.sendControlToCloud({ type: "httpResponseEnd", connectionId }, profile);
  }

  private sendHttpResponseStart(connectionId: string, response: Response, profile: TunnelQueueProfile): Promise<void> {
    return this.sendControlToCloud({
      type: "httpResponseStart",
      connectionId,
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
    }, profile);
  }

  private openLocalConnection(
    connectionId: string,
    path: string,
    route: "filesystem" | "browser-control" | "preview",
    metadata: CloudTunnelOpenMetadata | undefined,
    trafficClass: TunnelTrafficClass | undefined,
  ): void {
    const profile = trafficClass === undefined ? profileForWebSocketRoute(route) : profileForTrafficClass(trafficClass);
    const localWebSocket = new WebSocket(`ws://127.0.0.1:${String(this.options.localPort)}${path}`, {
      headers: buildLocalConnectionHeaders(metadata),
    });
    const localConnection: LocalTunnelConnection = {
      webSocket: localWebSocket,
      opened: false,
      openedAt: Date.now(),
      path,
      profile,
      messagesIn: 0,
      messagesOut: 0,
      pendingData: [],
      pendingDataBytes: 0,
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
      this.observeTunnelSend(
        this.sendControlToCloud({ type: "openResult", connectionId, ok: true }, profile),
        connectionId,
        profile,
      );

      for (const message of localConnection.pendingData.splice(0)) {
        if (localWebSocket.bufferedAmount + message.payload.byteLength > profile.maxQueuedBytes) {
          this.closeLogicalConnectionForOverload(connectionId, profile, TUNNEL_OVERLOAD_CLOSE_REASON);
          break;
        }

        localConnection.messagesOut += 1;
        localWebSocket.send(message.isText ? message.payload.toString("utf8") : message.payload);
      }
      localConnection.pendingDataBytes = 0;
    });
    localWebSocket.on("message", (data, isBinary) => {
      localConnection.messagesIn += 1;
      this.observeTunnelSend(
        this.sendBinaryToCloud({
          type: "wsData",
          connectionId,
          payload: webSocketRawDataToBuffer(data),
          isText: !isBinary,
        }, profile),
        connectionId,
        profile,
      );
    });
    localWebSocket.on("close", (code, reason) => {
      this.localConnections.delete(connectionId);
      this.sendScheduler?.removeConnection(connectionId);
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
      this.observeTunnelSend(
        this.sendControlToCloud({
          type: "close",
          connectionId,
          code: normalizeWebSocketCloseCode(code),
          reason: reason.toString("utf8"),
        }, profile),
        connectionId,
        profile,
      );
    });
    localWebSocket.on("error", (error) => {
      this.localConnections.delete(connectionId);
      this.sendScheduler?.removeConnection(connectionId);
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
        this.observeTunnelSend(
          this.sendControlToCloud({
            type: "openResult",
            connectionId,
            ok: false,
            error: error instanceof Error ? error.message : "Failed to open local route",
          }, profile),
          connectionId,
          profile,
        );
      }
    });
  }

  private sendControlToCloud(message: TunnelControlMessage, profile: TunnelQueueProfile): Promise<void> {
    if (this.cloudWebSocket?.readyState !== WebSocket.OPEN || this.sendScheduler === null) {
      return Promise.resolve();
    }

    this.cloudMessagesOut += 1;
    return this.sendScheduler.enqueue({
      connectionId: message.connectionId,
      data: stringifyTunnelControlMessage(message),
      profile,
    });
  }

  private sendBinaryToCloud(
    frame: Parameters<typeof encodeTunnelBinaryFrame>[0],
    profile: TunnelQueueProfile,
  ): Promise<void> {
    if (this.cloudWebSocket?.readyState !== WebSocket.OPEN || this.sendScheduler === null) {
      return Promise.resolve();
    }

    this.cloudMessagesOut += 1;
    return this.sendScheduler.enqueue({
      connectionId: frame.connectionId,
      data: encodeTunnelBinaryFrame(frame),
      profile,
    });
  }

  private closeLogicalConnectionForOverload(
    connectionId: string,
    profile: TunnelQueueProfile,
    reason: string,
  ): void {
    logger.warn({
      event: "machine_tunnel_client.connection_overloaded",
      computerId: this.options.computerId,
      cloudTunnelId: this.cloudTunnelId,
      connectionId,
      trafficClass: profile.trafficClass,
      reason,
      queuedBytes: this.sendScheduler?.getConnectionQueuedBytes(connectionId) ?? 0,
    }, "Logical tunnel connection exceeded its queue limit");

    this.localConnections.get(connectionId)?.webSocket.close(TUNNEL_OVERLOAD_CLOSE_CODE, reason);
    this.localConnections.delete(connectionId);
    this.httpAbortControllers.get(connectionId)?.abort();
    this.httpAbortControllers.delete(connectionId);
    this.pendingHttpRequests.delete(connectionId);

    if (this.cloudWebSocket?.readyState === WebSocket.OPEN) {
      this.cloudWebSocket.send(stringifyTunnelControlMessage({
        type: "close",
        connectionId,
        code: TUNNEL_OVERLOAD_CLOSE_CODE,
        reason: TUNNEL_OVERLOAD_CLOSE_REASON,
      }));
    }
  }

  private observeTunnelSend(promise: Promise<void>, connectionId: string, profile: TunnelQueueProfile): void {
    promise.catch((error) => {
      logger.warn({
        event: "machine_tunnel_client.logical_send_failed",
        computerId: this.options.computerId,
        cloudTunnelId: this.cloudTunnelId,
        connectionId,
        trafficClass: profile.trafficClass,
        err: errorToLog(error),
      }, "Logical tunnel send failed");
    });
  }

  private startHeartbeat(webSocket: WebSocket, cloudTunnelId: string): void {
    const heartbeatIntervalMs = this.options.heartbeatIntervalMs ?? DEFAULT_TUNNEL_HEARTBEAT_INTERVAL_MS;
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat(webSocket, cloudTunnelId);
    }, heartbeatIntervalMs);
  }

  private sendHeartbeat(webSocket: WebSocket, cloudTunnelId: string): void {
    if (webSocket !== this.cloudWebSocket || webSocket.readyState !== WebSocket.OPEN || this.heartbeatTimeoutTimer !== null) {
      return;
    }

    const heartbeatTimeoutMs = this.options.heartbeatTimeoutMs ?? DEFAULT_TUNNEL_HEARTBEAT_TIMEOUT_MS;
    this.heartbeatTimeoutTimer = setTimeout(() => {
      logger.warn({
        event: "machine_tunnel_client.heartbeat_timeout",
        computerId: this.options.computerId,
        cloudTunnelId,
        ageMs: Date.now() - this.cloudTunnelOpenedAt,
        heartbeatTimeoutMs,
        localConnectionCount: this.localConnections.size,
        httpRequestCount: this.httpAbortControllers.size,
        messagesIn: this.cloudMessagesIn,
        messagesOut: this.cloudMessagesOut,
      }, "Machine tunnel heartbeat timed out");
      webSocket.terminate();
    }, heartbeatTimeoutMs);

    webSocket.ping();
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer !== null) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.clearHeartbeatTimeout();
  }

  private closeLocalConnections(code: number, reason: string): void {
    for (const localConnection of this.localConnections.values()) {
      localConnection.webSocket.close(code, reason);
    }

    this.localConnections.clear();
  }

  private abortHttpRequests(reason: string): void {
    for (const abortController of this.httpAbortControllers.values()) {
      abortController.abort(reason);
    }

    this.httpAbortControllers.clear();
    this.pendingHttpRequests.clear();
  }
}

const DEFAULT_TUNNEL_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_TUNNEL_HEARTBEAT_TIMEOUT_MS = 10_000;

interface LocalTunnelConnection {
  readonly webSocket: WebSocket;
  opened: boolean;
  readonly openedAt: number;
  readonly path: string;
  readonly profile: TunnelQueueProfile;
  messagesIn: number;
  messagesOut: number;
  readonly pendingData: Array<{
    readonly payload: Buffer;
    readonly isText: boolean;
  }>;
  pendingDataBytes: number;
}

interface CloudTunnelOpenMetadata {
  readonly userId?: string;
  readonly accessSessionId?: string;
  readonly computerId?: string;
}

interface PendingHttpRequest {
  readonly message: Extract<TunnelControlMessage, { readonly type: "httpRequestStart" }>;
  readonly abortController: AbortController;
  readonly chunks: Buffer[];
  readonly profile: TunnelQueueProfile;
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

export const toLocalHttpRequestHeaders = (
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  if (headers === undefined) {
    return undefined;
  }

  const localHeaders: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "content-length") {
      continue;
    }

    localHeaders[name] = value;
  }

  return Object.keys(localHeaders).length === 0 ? undefined : localHeaders;
};

const toHttpProxyErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Failed to proxy HTTP request";
  const cause = error instanceof Error && error.cause !== undefined
    ? `: ${getErrorCauseMessage(error.cause)}`
    : "";

  return `Machine HTTP proxy failed: ${message}${cause}`;
};

const getErrorCauseMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const getErrorCauseLog = (error: unknown): Record<string, unknown> | undefined =>
  error instanceof Error && error.cause !== undefined ? errorToLog(error.cause) : undefined;

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

const rawDataToBinaryBuffer = (data: RawData): Buffer =>
  typeof data === "string" ? Buffer.from(data, "utf8") : webSocketRawDataToBuffer(data);

const webSocketRawDataToBuffer = (data: RawData): Buffer => {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (typeof data === "string") {
    return Buffer.from(data, "utf8");
  }

  return Buffer.concat(data);
};
