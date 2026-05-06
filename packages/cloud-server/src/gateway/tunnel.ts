import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import { hashToken } from "../auth/tokens.js";
import type { CloudServerConfig } from "../config.js";
import type { CloudStore, MachineIdentityRecord } from "../db/types.js";
import type { GatewayAccessService } from "./access-sessions.js";

export type GatewayRoute = "filesystem" | "agent";

export interface TunnelStatusRegistry {
  isConnected(computerId: string): boolean;
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
      this.registry.delete(this.computerId, this);
    });
    this.machineWebSocket.on("error", () => {
      this.closeGatewayConnections(1011, "Machine tunnel errored");
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

    gatewayWebSocket.on("message", (data) => {
      this.sendToMachine({
        type: "data",
        connectionId,
        data: rawDataToBase64(data),
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
    this.machineWebSocket.close(code, reason);
  }

  private handleMachineMessage(data: RawData): void {
    const message = parseMachineMessage(data);

    if (message === null) {
      this.machineWebSocket.close(1003, "Invalid tunnel message");
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
          gatewayWebSocket.send(Buffer.from(message.data, "base64"));
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
}

type CloudTunnelMessage =
  | { readonly type: "open"; readonly connectionId: string; readonly route: GatewayRoute; readonly path: string }
  | { readonly type: "data"; readonly connectionId: string; readonly data: string }
  | { readonly type: "close"; readonly connectionId: string; readonly code?: number; readonly reason?: string };

type MachineTunnelMessage =
  | { readonly type: "openResult"; readonly connectionId: string; readonly ok: true }
  | { readonly type: "openResult"; readonly connectionId: string; readonly ok: false; readonly error?: string }
  | { readonly type: "data"; readonly connectionId: string; readonly data: string }
  | { readonly type: "close"; readonly connectionId: string; readonly code?: number; readonly reason?: string };

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

  if (route !== "filesystem" && route !== "agent") {
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
        ? { type: "data", connectionId: message["connectionId"], data: message["data"] }
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
