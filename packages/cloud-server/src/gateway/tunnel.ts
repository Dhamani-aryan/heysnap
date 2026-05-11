import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { ReadableStream } from "node:stream/web";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import { hashToken } from "../auth/tokens.js";
import type { CloudServerConfig } from "../config.js";
import type { CloudStore, MachineIdentityRecord } from "../db/types.js";
import type { GatewayAccessService } from "./access-sessions.js";

export type GatewayRoute = "filesystem";

export interface TunnelStatusRegistry {
  isConnected(computerId: string): boolean;
  proxyHttpRequest?(computerId: string, input: GatewayHttpRequest): Promise<GatewayHttpResponse | null>;
  proxyStreamingHttpRequest?(computerId: string, input: GatewayHttpRequest): Promise<GatewayHttpStreamResponse | null>;
}

export interface GatewayHttpRequest {
  readonly path: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: Buffer;
}

export interface GatewayHttpResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

export interface GatewayHttpStreamResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: ReadableStream<Uint8Array>;
  cancel(): void;
}

export interface GatewayTunnelServerOptions {
  readonly store: CloudStore;
  readonly config: CloudServerConfig;
  readonly gatewayAccessService: GatewayAccessService;
  readonly registry?: MachineTunnelRegistry;
}

export interface UpgradeServer {
  on(
    event: "upgrade",
    listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
}

export class MachineTunnelRegistry {
  private readonly tunnels = new Map<string, MachineTunnel>();

  set(computerId: string, tunnel: MachineTunnel): void {
    this.tunnels.get(computerId)?.close(1012, "Replaced by a newer tunnel");
    this.tunnels.set(computerId, tunnel);
  }

  get(computerId: string): MachineTunnel | undefined {
    return this.tunnels.get(computerId);
  }

  delete(computerId: string, tunnel: MachineTunnel): void {
    if (this.tunnels.get(computerId) === tunnel) {
      this.tunnels.delete(computerId);
    }
  }

  isConnected(computerId: string): boolean {
    return this.tunnels.has(computerId);
  }

  async proxyHttpRequest(computerId: string, input: GatewayHttpRequest): Promise<GatewayHttpResponse | null> {
    const tunnel = this.tunnels.get(computerId);

    if (tunnel === undefined) {
      return null;
    }

    return tunnel.proxyHttpRequest(input);
  }

  async proxyStreamingHttpRequest(
    computerId: string,
    input: GatewayHttpRequest,
  ): Promise<GatewayHttpStreamResponse | null> {
    const tunnel = this.tunnels.get(computerId);

    if (tunnel === undefined) {
      return null;
    }

    return tunnel.proxyStreamingHttpRequest(input);
  }

  connectedComputerIds(): string[] {
    return Array.from(this.tunnels.keys());
  }
}

export const attachGatewayTunnelServer = (
  server: UpgradeServer,
  options: GatewayTunnelServerOptions,
): MachineTunnelRegistry => {
  const registry = options.registry ?? new MachineTunnelRegistry();
  const machineSocketServer = new WebSocketServer({ noServer: true });
  const gatewaySocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");

    if (requestUrl.pathname === "/machines/tunnel") {
      void authenticateMachineTunnel(options.store, options.config, request.headers.authorization)
        .then((machine) => {
          if (machine === null) {
            rejectUpgrade(socket, 401, "Machine token required");
            return;
          }

          machineSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
            const tunnel = new MachineTunnel(machine.computerId, webSocket, registry);
            registry.set(machine.computerId, tunnel);
          });
        })
        .catch((error) => {
          console.error(error);
          rejectUpgrade(socket, 500, "Tunnel authentication failed");
        });
      return;
    }

    const routeMatch = matchGatewayRoute(requestUrl.pathname);

    if (routeMatch === null) {
      rejectUpgrade(socket, 404, "Unknown WebSocket route");
      return;
    }

    void authenticateGatewayRoute(options, requestUrl, request.headers.authorization, routeMatch.computerId)
      .then((ok) => {
        if (!ok) {
          rejectUpgrade(socket, 401, "Invalid gateway access token");
          return;
        }

        const tunnel = registry.get(routeMatch.computerId);

        if (tunnel === undefined) {
          rejectUpgrade(socket, 503, "Machine tunnel is not connected");
          return;
        }

        gatewaySocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          tunnel.openGatewayConnection(webSocket, {
            route: routeMatch.route,
            targetPath: buildMachineTargetPath(routeMatch.route, requestUrl),
          });
        });
      })
      .catch((error) => {
        console.error(error);
        rejectUpgrade(socket, 500, "Gateway upgrade failed");
      });
  });

  return registry;
};

export class MachineTunnel {
  private readonly gatewayConnections = new Map<string, WebSocket>();
  private readonly pendingHttpRequests = new Map<string, PendingHttpRequest>();
  private readonly pendingHttpStreams = new Map<string, PendingHttpStream>();
  private readonly activeHttpStreams = new Map<string, ActiveHttpStream>();

  constructor(
    readonly computerId: string,
    private readonly machineWebSocket: WebSocket,
    private readonly registry: MachineTunnelRegistry,
  ) {
    this.machineWebSocket.on("message", (data) => {
      this.handleMachineMessage(data);
    });
    this.machineWebSocket.on("close", () => {
      this.closeGatewayConnections(1011, "Machine tunnel closed");
      this.rejectPendingHttpRequests(new Error("Machine tunnel closed"));
      this.rejectHttpStreams(new Error("Machine tunnel closed"));
      this.registry.delete(this.computerId, this);
    });
    this.machineWebSocket.on("error", () => {
      this.closeGatewayConnections(1011, "Machine tunnel errored");
      this.rejectPendingHttpRequests(new Error("Machine tunnel errored"));
      this.rejectHttpStreams(new Error("Machine tunnel errored"));
      this.registry.delete(this.computerId, this);
    });
  }

  openGatewayConnection(
    gatewayWebSocket: WebSocket,
    input: {
      readonly route: GatewayRoute;
      readonly targetPath: string;
    },
  ): void {
    const connectionId = randomUUID();
    this.gatewayConnections.set(connectionId, gatewayWebSocket);

    gatewayWebSocket.on("message", (data, isBinary) => {
      this.sendToMachine({
        type: "data",
        connectionId,
        ...rawDataToTunnelPayload(data, isBinary),
      });
    });
    gatewayWebSocket.on("close", (code, reason) => {
      this.gatewayConnections.delete(connectionId);
      this.sendToMachine({
        type: "close",
        connectionId,
        code: normalizeWebSocketCloseCode(code),
        reason: reason.toString("utf8"),
      });
    });
    gatewayWebSocket.on("error", () => {
      this.gatewayConnections.delete(connectionId);
      this.sendToMachine({
        type: "close",
        connectionId,
        code: 1011,
        reason: "Gateway socket errored",
      });
    });

    this.sendToMachine({
      type: "open",
      connectionId,
      route: input.route,
      path: input.targetPath,
    });
  }

  close(code: number, reason: string): void {
    this.closeGatewayConnections(code, reason);
    this.rejectPendingHttpRequests(new Error(reason));
    this.machineWebSocket.close(code, reason);
  }

  proxyHttpRequest(input: GatewayHttpRequest): Promise<GatewayHttpResponse> {
    const connectionId = randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingHttpRequests.delete(connectionId);
        reject(new Error("Machine HTTP tunnel request timed out"));
      }, HTTP_PROXY_TIMEOUT_MS);

      this.pendingHttpRequests.set(connectionId, { resolve, reject, timeout });
      this.sendToMachine({
        type: "httpRequest",
        connectionId,
        path: input.path,
        method: input.method,
        headers: input.headers,
        bodyBase64: input.body?.toString("base64"),
      });
    });
  }

  proxyStreamingHttpRequest(input: GatewayHttpRequest): Promise<GatewayHttpStreamResponse> {
    const connectionId = randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingHttpStreams.delete(connectionId);
        reject(new Error("Machine HTTP tunnel request timed out"));
      }, HTTP_PROXY_TIMEOUT_MS);

      this.pendingHttpStreams.set(connectionId, { resolve, reject, timeout });
      this.sendToMachine({
        type: "httpRequest",
        connectionId,
        path: input.path,
        method: input.method,
        headers: input.headers,
        bodyBase64: input.body?.toString("base64"),
        stream: true,
      });
    });
  }

  private handleMachineMessage(data: RawData): void {
    const message = parseMachineMessage(data);

    if (message === null) {
      this.machineWebSocket.close(1003, "Invalid tunnel message");
      return;
    }

    if (message.type === "httpResponse") {
      this.resolveHttpResponse(message);
      return;
    }

    if (message.type === "httpResponseStart") {
      this.resolveHttpStreamStart(message);
      return;
    }

    if (message.type === "httpResponseChunk") {
      this.writeHttpStreamChunk(message);
      return;
    }

    if (message.type === "httpResponseEnd") {
      this.closeHttpStream(message.connectionId);
      return;
    }

    const gatewayWebSocket = this.gatewayConnections.get(message.connectionId);

    if (gatewayWebSocket === undefined) {
      return;
    }

    switch (message.type) {
      case "openResult":
        if (!message.ok) {
          gatewayWebSocket.close(1011, message.error ?? "Machine failed to open route");
          this.gatewayConnections.delete(message.connectionId);
        }
        break;
      case "data":
        if (gatewayWebSocket.readyState === WebSocket.OPEN) {
          gatewayWebSocket.send(tunnelPayloadToRawData(message));
        }
        break;
      case "close":
        gatewayWebSocket.close(
          normalizeWebSocketCloseCode(message.code),
          message.reason ?? "Machine closed route",
        );
        this.gatewayConnections.delete(message.connectionId);
        break;
    }
  }

  private sendToMachine(message: CloudTunnelMessage): void {
    if (this.machineWebSocket.readyState === WebSocket.OPEN) {
      this.machineWebSocket.send(JSON.stringify(message));
    }
  }

  private closeGatewayConnections(code: number, reason: string): void {
    for (const gatewayWebSocket of this.gatewayConnections.values()) {
      gatewayWebSocket.close(code, reason);
    }

    this.gatewayConnections.clear();
  }

  private resolveHttpResponse(message: MachineHttpResponseMessage): void {
    const pending = this.pendingHttpRequests.get(message.connectionId);

    if (pending === undefined) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingHttpRequests.delete(message.connectionId);
    pending.resolve({
      statusCode: message.statusCode,
      headers: message.headers,
      body: Buffer.from(message.bodyBase64, "base64"),
    });
  }

  private resolveHttpStreamStart(message: MachineHttpResponseStartMessage): void {
    const pending = this.pendingHttpStreams.get(message.connectionId);

    if (pending === undefined) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingHttpStreams.delete(message.connectionId);

    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start: (streamController) => {
        controller = streamController;
      },
      cancel: () => {
        this.sendToMachine({
          type: "close",
          connectionId: message.connectionId,
          code: 1000,
          reason: "HTTP stream cancelled",
        });
        this.activeHttpStreams.delete(message.connectionId);
      },
    });

    if (controller === null) {
      pending.reject(new Error("Failed to open HTTP stream"));
      return;
    }

    this.activeHttpStreams.set(message.connectionId, { controller });
    pending.resolve({
      statusCode: message.statusCode,
      headers: message.headers,
      body,
      cancel: () => {
        this.sendToMachine({
          type: "close",
          connectionId: message.connectionId,
          code: 1000,
          reason: "HTTP stream cancelled",
        });
        this.activeHttpStreams.delete(message.connectionId);
      },
    });
  }

  private writeHttpStreamChunk(message: MachineHttpResponseChunkMessage): void {
    this.activeHttpStreams
      .get(message.connectionId)
      ?.controller.enqueue(Buffer.from(message.bodyBase64, "base64"));
  }

  private closeHttpStream(connectionId: string): void {
    const stream = this.activeHttpStreams.get(connectionId);

    if (stream === undefined) {
      return;
    }

    stream.controller.close();
    this.activeHttpStreams.delete(connectionId);
  }

  private rejectPendingHttpRequests(error: Error): void {
    for (const [connectionId, pending] of this.pendingHttpRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingHttpRequests.delete(connectionId);
    }
  }

  private rejectHttpStreams(error: Error): void {
    for (const [connectionId, pending] of this.pendingHttpStreams.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingHttpStreams.delete(connectionId);
    }

    for (const [connectionId, stream] of this.activeHttpStreams.entries()) {
      stream.controller.error(error);
      this.activeHttpStreams.delete(connectionId);
    }
  }
}

interface PendingHttpRequest {
  readonly resolve: (response: GatewayHttpResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface PendingHttpStream {
  readonly resolve: (response: GatewayHttpStreamResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface ActiveHttpStream {
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
}

type CloudTunnelMessage =
  | { readonly type: "open"; readonly connectionId: string; readonly route: GatewayRoute; readonly path: string }
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
  | { readonly type: "openResult"; readonly connectionId: string; readonly ok: false; readonly error?: string }
  | MachineHttpResponseMessage
  | MachineHttpResponseStartMessage
  | MachineHttpResponseChunkMessage
  | { readonly type: "httpResponseEnd"; readonly connectionId: string }
  | { readonly type: "data"; readonly connectionId: string; readonly data: string; readonly dataType?: TunnelPayloadType }
  | { readonly type: "close"; readonly connectionId: string; readonly code?: number; readonly reason?: string };

type TunnelPayloadType = "text" | "binary";

type MachineHttpResponseMessage = {
  readonly type: "httpResponse";
  readonly connectionId: string;
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly bodyBase64: string;
};

type MachineHttpResponseStartMessage = {
  readonly type: "httpResponseStart";
  readonly connectionId: string;
  readonly statusCode: number;
  readonly headers: Record<string, string>;
};

type MachineHttpResponseChunkMessage = {
  readonly type: "httpResponseChunk";
  readonly connectionId: string;
  readonly bodyBase64: string;
};

const authenticateMachineTunnel = async (
  store: CloudStore,
  config: CloudServerConfig,
  authorization: string | undefined,
): Promise<MachineIdentityRecord | null> => {
  const token = readBearerToken(authorization);

  if (token === undefined) {
    return null;
  }

  const identity = await store.getMachineIdentityByTokenHash(hashToken(token, config.sessionSecret));

  if (identity === null || identity.revokedAt !== null) {
    return null;
  }

  await store.touchMachineIdentity({ identityId: identity.id, lastUsedAt: new Date() });
  return identity;
};

const authenticateGatewayRoute = async (
  options: GatewayTunnelServerOptions,
  requestUrl: URL,
  authorization: string | undefined,
  computerId: string,
): Promise<boolean> => {
  const token = readBearerToken(authorization)
    ?? requestUrl.searchParams.get("accessToken")
    ?? requestUrl.searchParams.get("token")
    ?? undefined;

  if (token === undefined || token.length === 0) {
    return false;
  }

  const accessSession = await options.gatewayAccessService.authenticateAccessToken({ token, computerId });
  return accessSession !== null;
};

const matchGatewayRoute = (pathname: string): { readonly computerId: string; readonly route: GatewayRoute } | null => {
  const match = /^\/gateway\/computers\/([^/]+)\/([^/]+)$/.exec(pathname);

  if (match === null) {
    return null;
  }

  const route = match[2];

  if (route !== "filesystem") {
    return null;
  }

  return { computerId: decodeURIComponent(match[1] ?? ""), route };
};

const buildMachineTargetPath = (route: GatewayRoute, requestUrl: URL): string => {
  const query = new URLSearchParams(requestUrl.searchParams);
  query.delete("accessToken");
  query.delete("token");
  const queryString = query.toString();

  return `/${route}${queryString.length > 0 ? `?${queryString}` : ""}`;
};

const parseMachineMessage = (data: RawData): MachineTunnelMessage | null => {
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
    case "openResult":
      if (message["ok"] === true) {
        return { type: "openResult", connectionId: message["connectionId"], ok: true };
      }

      return {
        type: "openResult",
        connectionId: message["connectionId"],
        ok: false,
        error: typeof message["error"] === "string" ? message["error"] : undefined,
      };
    case "data":
      return typeof message["data"] === "string"
        ? {
            type: "data",
            connectionId: message["connectionId"],
            data: message["data"],
            dataType: parseTunnelPayloadType(message["dataType"]),
          }
        : null;
    case "httpResponse":
      return isHttpResponseMessage(message)
        ? {
            type: "httpResponse",
            connectionId: message["connectionId"],
            statusCode: message["statusCode"],
            headers: message["headers"],
            bodyBase64: message["bodyBase64"],
          }
        : null;
    case "httpResponseStart":
      return isHttpResponseStartMessage(message)
        ? {
            type: "httpResponseStart",
            connectionId: message["connectionId"],
            statusCode: message["statusCode"],
            headers: message["headers"],
          }
        : null;
    case "httpResponseChunk":
      return typeof message["bodyBase64"] === "string"
        ? {
            type: "httpResponseChunk",
            connectionId: message["connectionId"],
            bodyBase64: message["bodyBase64"],
          }
        : null;
    case "httpResponseEnd":
      return { type: "httpResponseEnd", connectionId: message["connectionId"] };
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

const isHttpResponseMessage = (message: Record<string, unknown>): message is {
  readonly connectionId: string;
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly bodyBase64: string;
} => (
  typeof message["connectionId"] === "string" &&
  typeof message["statusCode"] === "number" &&
  Number.isInteger(message["statusCode"]) &&
  message["statusCode"] >= 100 &&
  message["statusCode"] <= 599 &&
  typeof message["bodyBase64"] === "string" &&
  isStringRecord(message["headers"])
);

const isHttpResponseStartMessage = (message: Record<string, unknown>): message is {
  readonly connectionId: string;
  readonly statusCode: number;
  readonly headers: Record<string, string>;
} => (
  typeof message["connectionId"] === "string" &&
  typeof message["statusCode"] === "number" &&
  Number.isInteger(message["statusCode"]) &&
  message["statusCode"] >= 100 &&
  message["statusCode"] <= 599 &&
  isStringRecord(message["headers"])
);

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "string");
};

const readBearerToken = (authorization: string | undefined): string | undefined => {
  if (authorization === undefined) {
    return undefined;
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || token === undefined || token.trim().length === 0) {
    return undefined;
  }

  return token.trim();
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

const HTTP_PROXY_TIMEOUT_MS = 120_000;

const rejectUpgrade = (socket: Duplex, status: number, message: string): void => {
  socket.write([
    `HTTP/1.1 ${String(status)} ${message}`,
    "Connection: close",
    "Content-Type: text/plain",
    `Content-Length: ${String(Buffer.byteLength(message))}`,
    "",
    message,
  ].join("\r\n"));
  socket.destroy();
};
