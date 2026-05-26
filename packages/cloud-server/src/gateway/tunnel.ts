import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { ReadableStream } from "node:stream/web";
import type { Duplex } from "node:stream";

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
  type TunnelRoute,
  type TunnelTrafficClass,
} from "@ank1015-app/tunnel-protocol";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { hashToken } from "../auth/tokens.js";
import type { CloudServerConfig } from "../config.js";
import type { CloudStore, ComputerAccessSessionRecord, MachineIdentityRecord } from "../db/types.js";
import { errorToLog, logger, sanitizeUrlPath } from "../shared/logger.js";
import { hasAccessScope, type GatewayAccessScope, type GatewayAccessService } from "./access-sessions.js";

export type GatewayRoute = TunnelRoute;
export { normalizeWebSocketCloseCode };

const PREVIEW_ACCESS_COOKIE_NAME = "heysnap_preview_access";
const DEFAULT_TUNNEL_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_TUNNEL_HEARTBEAT_TIMEOUT_MS = 10_000;

export interface GatewayRouteMetadata {
  readonly userId: string;
  readonly accessSessionId: string;
  readonly computerId: string;
}

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
  readonly trafficClass?: TunnelTrafficClass;
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
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
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
    const previous = this.tunnels.get(computerId);

    this.tunnels.set(computerId, tunnel);

    if (previous !== undefined) {
      logger.warn({
        event: "machine_tunnel.replaced",
        computerId,
        previousTunnelId: previous.tunnelId,
        nextTunnelId: tunnel.tunnelId,
      }, "Machine tunnel replaced by a newer tunnel");
      previous.close(1012, "Replaced by a newer tunnel");
    }
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
            const tunnel = new MachineTunnel(machine.computerId, webSocket, registry, {
              heartbeatIntervalMs: options.heartbeatIntervalMs,
              heartbeatTimeoutMs: options.heartbeatTimeoutMs,
            });
            registry.set(machine.computerId, tunnel);
          });
        })
        .catch((error) => {
          logger.error({
            event: "machine_tunnel.upgrade_error",
            err: errorToLog(error),
            path: sanitizeUrlPath(request.url),
          }, "Tunnel authentication failed");
          rejectUpgrade(socket, 500, "Tunnel authentication failed");
        });
      return;
    }

    const routeMatch = matchGatewayRoute(requestUrl.pathname);

    if (routeMatch === null) {
      logger.warn({
        event: "gateway_ws.upgrade_rejected",
        reason: "unknown_route",
        path: sanitizeUrlPath(request.url),
      }, "Rejected gateway websocket upgrade");
      rejectUpgrade(socket, 404, "Unknown WebSocket route");
      return;
    }

    void authenticateGatewayRoute(
      options,
      requestUrl,
      request.headers.authorization,
      typeof request.headers.cookie === "string" ? request.headers.cookie : undefined,
      routeMatch,
    )
      .then((accessSession) => {
        if (accessSession === "forbidden") {
          logger.warn({
            event: "gateway_ws.upgrade_rejected",
            reason: "forbidden_scope",
            computerId: routeMatch.computerId,
            route: routeMatch.route,
            path: sanitizeUrlPath(request.url),
          }, "Rejected gateway websocket upgrade");
          rejectUpgrade(socket, 403, "Gateway access token does not allow this route");
          return;
        }

        if (accessSession === null) {
          logger.warn({
            event: "gateway_ws.upgrade_rejected",
            reason: "invalid_access_token",
            computerId: routeMatch.computerId,
            route: routeMatch.route,
            path: sanitizeUrlPath(request.url),
          }, "Rejected gateway websocket upgrade");
          rejectUpgrade(socket, 401, "Invalid gateway access token");
          return;
        }

        const tunnel = registry.get(routeMatch.computerId);

        if (tunnel === undefined) {
          logger.warn({
            event: "gateway_ws.upgrade_rejected",
            reason: "machine_tunnel_not_connected",
            computerId: routeMatch.computerId,
            route: routeMatch.route,
            accessSessionId: accessSession.id,
            userId: accessSession.userId,
            path: sanitizeUrlPath(request.url),
          }, "Rejected gateway websocket upgrade");
          rejectUpgrade(socket, 503, "Machine tunnel is not connected");
          return;
        }

        gatewaySocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          tunnel.openGatewayConnection(webSocket, {
            route: routeMatch.route,
            targetPath: buildMachineTargetPath(routeMatch, requestUrl),
            metadata: {
              userId: accessSession.userId,
              accessSessionId: accessSession.id,
              computerId: routeMatch.computerId,
            },
          });
        });
      })
      .catch((error) => {
        logger.error({
          event: "gateway_ws.upgrade_error",
          err: errorToLog(error),
          computerId: routeMatch.computerId,
          route: routeMatch.route,
          path: sanitizeUrlPath(request.url),
        }, "Gateway websocket upgrade failed");
        rejectUpgrade(socket, 500, "Gateway upgrade failed");
      });
  });

  return registry;
};

export class MachineTunnel {
  readonly tunnelId = randomUUID();
  private readonly gatewayConnections = new Map<string, WebSocket>();
  private readonly gatewayConnectionStats = new Map<string, GatewayConnectionStats>();
  private readonly pendingHttpRequests = new Map<string, PendingHttpRequest>();
  private readonly pendingHttpStreams = new Map<string, PendingHttpStream>();
  private readonly activeHttpResponses = new Map<string, ActiveHttpResponse>();
  private readonly openedAt = Date.now();
  private readonly sendScheduler: TunnelSendScheduler;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private messagesFromMachine = 0;
  private messagesToMachine = 0;

  constructor(
    readonly computerId: string,
    private readonly machineWebSocket: WebSocket,
    private readonly registry: MachineTunnelRegistry,
    private readonly heartbeatOptions: MachineTunnelHeartbeatOptions = {},
  ) {
    this.sendScheduler = new TunnelSendScheduler({
      socket: this.machineWebSocket,
      isOpen: () => this.machineWebSocket.readyState === WebSocket.OPEN,
      onConnectionOverflow: (connectionId, profile, reason) => {
        this.closeLogicalConnectionForOverload(connectionId, profile, reason);
      },
      onSendError: (error) => {
        logger.warn({
          event: "machine_tunnel.send_error",
          computerId: this.computerId,
          tunnelId: this.tunnelId,
          err: errorToLog(error),
        }, "Machine tunnel send failed");
      },
    });
    logger.info({
      event: "machine_tunnel.open",
      computerId: this.computerId,
      tunnelId: this.tunnelId,
    }, "Machine tunnel opened");
    this.startHeartbeat();
    this.machineWebSocket.on("message", (data, isBinary) => {
      this.messagesFromMachine += 1;
      this.handleMachineMessage(data, isBinary);
    });
    this.machineWebSocket.on("pong", () => {
      this.clearHeartbeatTimeout();
    });
    this.machineWebSocket.on("close", (code, reason) => {
      this.clearHeartbeat();
      logger.warn({
        event: "machine_tunnel.close",
        computerId: this.computerId,
        tunnelId: this.tunnelId,
        closeCode: code,
        closeReason: reason.toString("utf8"),
        ageMs: Date.now() - this.openedAt,
        gatewayConnectionCount: this.gatewayConnections.size,
        pendingHttpRequestCount: this.pendingHttpRequests.size,
        pendingHttpStreamCount: this.pendingHttpStreams.size,
        activeHttpStreamCount: this.activeHttpResponses.size,
        messagesFromMachine: this.messagesFromMachine,
        messagesToMachine: this.messagesToMachine,
      }, "Machine tunnel closed");
      this.closeGatewayConnections(1011, "Machine tunnel closed");
      this.rejectPendingHttpRequests(new Error("Machine tunnel closed"));
      this.rejectHttpStreams(new Error("Machine tunnel closed"));
      this.sendScheduler.close(new Error("Machine tunnel closed"));
      this.registry.delete(this.computerId, this);
    });
    this.machineWebSocket.on("error", (error) => {
      this.clearHeartbeat();
      logger.error({
        event: "machine_tunnel.error",
        computerId: this.computerId,
        tunnelId: this.tunnelId,
        err: errorToLog(error),
        ageMs: Date.now() - this.openedAt,
      }, "Machine tunnel errored");
      this.closeGatewayConnections(1011, "Machine tunnel errored");
      this.rejectPendingHttpRequests(new Error("Machine tunnel errored"));
      this.rejectHttpStreams(new Error("Machine tunnel errored"));
      this.sendScheduler.close(new Error("Machine tunnel errored"));
      this.registry.delete(this.computerId, this);
    });
  }

  openGatewayConnection(
    gatewayWebSocket: WebSocket,
    input: {
      readonly route: GatewayRoute;
      readonly targetPath: string;
      readonly metadata?: GatewayRouteMetadata;
    },
  ): void {
    const connectionId = randomUUID();
    const profile = profileForWebSocketRoute(input.route);
    const stats: GatewayConnectionStats = {
      openedAt: Date.now(),
      route: input.route,
      profile,
      messagesFromGateway: 0,
      messagesToGateway: 0,
    };
    this.gatewayConnections.set(connectionId, gatewayWebSocket);
    this.gatewayConnectionStats.set(connectionId, stats);
    logger.info({
      event: "gateway_ws.open",
      computerId: this.computerId,
      tunnelId: this.tunnelId,
      gatewayConnectionId: connectionId,
      route: input.route,
      path: sanitizeUrlPath(input.targetPath),
      userId: input.metadata?.userId,
      accessSessionId: input.metadata?.accessSessionId,
    }, "Gateway websocket opened");

    gatewayWebSocket.on("message", (data, isBinary) => {
      stats.messagesFromGateway += 1;
      this.observeTunnelSend(
        this.sendBinaryToMachine({
          type: "wsData",
          connectionId,
          payload: webSocketRawDataToBuffer(data),
          isText: !isBinary,
        }, profile),
        connectionId,
        profile,
      );
    });
    gatewayWebSocket.on("close", (code, reason) => {
      this.gatewayConnections.delete(connectionId);
      this.gatewayConnectionStats.delete(connectionId);
      this.sendScheduler.removeConnection(connectionId);
      logger.info({
        event: "gateway_ws.close",
        computerId: this.computerId,
        tunnelId: this.tunnelId,
        gatewayConnectionId: connectionId,
        route: input.route,
        closeCode: code,
        closeReason: reason.toString("utf8"),
        ageMs: Date.now() - stats.openedAt,
        messagesFromGateway: stats.messagesFromGateway,
        messagesToGateway: stats.messagesToGateway,
      }, "Gateway websocket closed");
      this.observeTunnelSend(
        this.sendControlToMachine({
          type: "close",
          connectionId,
          code: normalizeWebSocketCloseCode(code),
          reason: reason.toString("utf8"),
        }, profile),
        connectionId,
        profile,
      );
    });
    gatewayWebSocket.on("error", (error) => {
      this.gatewayConnections.delete(connectionId);
      this.gatewayConnectionStats.delete(connectionId);
      this.sendScheduler.removeConnection(connectionId);
      logger.error({
        event: "gateway_ws.error",
        computerId: this.computerId,
        tunnelId: this.tunnelId,
        gatewayConnectionId: connectionId,
        route: input.route,
        err: errorToLog(error),
        ageMs: Date.now() - stats.openedAt,
      }, "Gateway websocket errored");
      this.observeTunnelSend(
        this.sendControlToMachine({
          type: "close",
          connectionId,
          code: 1011,
          reason: "Gateway socket errored",
        }, profile),
        connectionId,
        profile,
      );
    });

    this.observeTunnelSend(
      this.sendControlToMachine({
        type: "open",
        connectionId,
        route: input.route,
        path: input.targetPath,
        metadata: input.metadata,
        trafficClass: profile.trafficClass,
      }, profile),
      connectionId,
      profile,
    );
  }

  close(code: number, reason: string): void {
    this.closeGatewayConnections(code, reason);
    this.rejectPendingHttpRequests(new Error(reason));
    this.sendScheduler.close(new Error(reason));
    this.machineWebSocket.close(code, reason);
  }

  proxyHttpRequest(input: GatewayHttpRequest): Promise<GatewayHttpResponse> {
    const connectionId = randomUUID();
    const profile = profileForTrafficClass(input.trafficClass ?? inferHttpTrafficClass(input.path));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingHttpRequests.delete(connectionId);
        this.activeHttpResponses.delete(connectionId);
        this.sendScheduler.removeConnection(connectionId);
        reject(new Error("Machine HTTP tunnel request timed out"));
      }, HTTP_PROXY_TIMEOUT_MS);

      this.pendingHttpRequests.set(connectionId, { resolve, reject, timeout, profile });
      void this.sendHttpRequest(connectionId, input, profile).catch((error) => {
        clearTimeout(timeout);
        this.pendingHttpRequests.delete(connectionId);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  proxyStreamingHttpRequest(input: GatewayHttpRequest): Promise<GatewayHttpStreamResponse> {
    const connectionId = randomUUID();
    const profile = profileForTrafficClass(input.trafficClass ?? inferHttpTrafficClass(input.path));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingHttpStreams.delete(connectionId);
        this.activeHttpResponses.delete(connectionId);
        this.sendScheduler.removeConnection(connectionId);
        reject(new Error("Machine HTTP tunnel request timed out"));
      }, HTTP_PROXY_TIMEOUT_MS);

      this.pendingHttpStreams.set(connectionId, { resolve, reject, timeout, profile });
      void this.sendHttpRequest(connectionId, { ...input, trafficClass: profile.trafficClass }, profile, true).catch((error) => {
        clearTimeout(timeout);
        this.pendingHttpStreams.delete(connectionId);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private handleMachineMessage(data: RawData, isBinary: boolean): void {
    if (this.registry.get(this.computerId) !== this) {
      logger.warn({
        event: "machine_tunnel.stale_message_dropped",
        computerId: this.computerId,
        tunnelId: this.tunnelId,
      }, "Dropped message from a replaced machine tunnel");
      return;
    }

    if (isBinary) {
      this.handleMachineBinaryFrame(data);
      return;
    }

    const message = parseTunnelControlMessage(rawDataToText(data));

    if (message === null) {
      this.machineWebSocket.close(1003, "Invalid tunnel message");
      return;
    }

    if (message.type === "httpResponseStart") {
      this.resolveHttpStreamStart(message);
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
          this.gatewayConnectionStats.delete(message.connectionId);
        }
        break;
      case "close":
        gatewayWebSocket.close(
          normalizeWebSocketCloseCode(message.code),
          message.reason ?? "Machine closed route",
        );
        this.gatewayConnections.delete(message.connectionId);
        this.gatewayConnectionStats.delete(message.connectionId);
        this.sendScheduler.removeConnection(message.connectionId);
        break;
    }
  }

  private handleMachineBinaryFrame(data: RawData): void {
    const frame = decodeTunnelBinaryFrame(rawDataToBinaryBuffer(data));

    if (frame === null) {
      this.machineWebSocket.close(1003, "Invalid tunnel binary frame");
      return;
    }

    if (frame.type === "httpResponseBody") {
      this.writeHttpStreamChunk(frame.connectionId, frame.payload);
      return;
    }

    if (frame.type !== "wsData") {
      this.machineWebSocket.close(1003, "Unexpected tunnel binary frame");
      return;
    }

    const gatewayWebSocket = this.gatewayConnections.get(frame.connectionId);

    if (gatewayWebSocket === undefined || gatewayWebSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const stats = this.gatewayConnectionStats.get(frame.connectionId);
    if (stats !== undefined) {
      if (gatewayWebSocket.bufferedAmount + frame.payload.byteLength > stats.profile.maxQueuedBytes) {
        this.closeLogicalConnectionForOverload(frame.connectionId, stats.profile, TUNNEL_OVERLOAD_CLOSE_REASON);
        return;
      }

      stats.messagesToGateway += 1;
    }

    gatewayWebSocket.send(frame.isText ? frame.payload.toString("utf8") : frame.payload);
  }

  private sendControlToMachine(message: TunnelControlMessage, profile: TunnelQueueProfile): Promise<void> {
    if (this.machineWebSocket.readyState !== WebSocket.OPEN) {
      return Promise.resolve();
    }

    this.messagesToMachine += 1;
    return this.sendScheduler.enqueue({
      connectionId: message.connectionId,
      data: stringifyTunnelControlMessage(message),
      profile,
    });
  }

  private sendBinaryToMachine(
    frame: Parameters<typeof encodeTunnelBinaryFrame>[0],
    profile: TunnelQueueProfile,
  ): Promise<void> {
    if (this.machineWebSocket.readyState !== WebSocket.OPEN) {
      return Promise.resolve();
    }

    this.messagesToMachine += 1;
    return this.sendScheduler.enqueue({
      connectionId: frame.connectionId,
      data: encodeTunnelBinaryFrame(frame),
      profile,
    });
  }

  private async sendHttpRequest(
    connectionId: string,
    input: GatewayHttpRequest,
    profile: TunnelQueueProfile,
    stream = false,
  ): Promise<void> {
    await this.sendControlToMachine({
      type: "httpRequestStart",
      connectionId,
      path: input.path,
      method: input.method,
      headers: input.headers,
      stream,
      trafficClass: profile.trafficClass,
    }, profile);

    if (input.body !== undefined && input.body.byteLength > 0) {
      await this.sendBinaryToMachine({
        type: "httpRequestBody",
        connectionId,
        payload: input.body,
        isText: false,
      }, profile);
    }

    await this.sendControlToMachine({ type: "httpRequestEnd", connectionId }, profile);
  }

  private startHeartbeat(): void {
    const heartbeatIntervalMs = this.heartbeatOptions.heartbeatIntervalMs ?? DEFAULT_TUNNEL_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, heartbeatIntervalMs);
  }

  private sendHeartbeat(): void {
    if (this.machineWebSocket.readyState !== WebSocket.OPEN || this.heartbeatTimeoutTimer !== null) {
      return;
    }

    const heartbeatTimeoutMs = this.heartbeatOptions.heartbeatTimeoutMs ?? DEFAULT_TUNNEL_HEARTBEAT_TIMEOUT_MS;
    this.heartbeatTimeoutTimer = setTimeout(() => {
      logger.warn({
        event: "machine_tunnel.heartbeat_timeout",
        computerId: this.computerId,
        tunnelId: this.tunnelId,
        ageMs: Date.now() - this.openedAt,
        heartbeatTimeoutMs,
        gatewayConnectionCount: this.gatewayConnections.size,
        pendingHttpRequestCount: this.pendingHttpRequests.size,
        pendingHttpStreamCount: this.pendingHttpStreams.size,
        activeHttpStreamCount: this.activeHttpResponses.size,
      }, "Machine tunnel heartbeat timed out");
      this.machineWebSocket.terminate();
    }, heartbeatTimeoutMs);

    this.machineWebSocket.ping();
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

  private closeGatewayConnections(code: number, reason: string): void {
    for (const gatewayWebSocket of this.gatewayConnections.values()) {
      gatewayWebSocket.close(code, reason);
    }

    this.gatewayConnections.clear();
    this.gatewayConnectionStats.clear();
  }

  private closeLogicalConnectionForOverload(
    connectionId: string,
    profile: TunnelQueueProfile,
    reason: string,
  ): void {
    logger.warn({
      event: "machine_tunnel.connection_overloaded",
      computerId: this.computerId,
      tunnelId: this.tunnelId,
      connectionId,
      trafficClass: profile.trafficClass,
      reason,
      queuedBytes: this.sendScheduler.getConnectionQueuedBytes(connectionId),
    }, "Logical tunnel connection exceeded its queue limit");

    this.gatewayConnections.get(connectionId)?.close(TUNNEL_OVERLOAD_CLOSE_CODE, reason);
    this.gatewayConnections.delete(connectionId);
    this.gatewayConnectionStats.delete(connectionId);

    const error = new Error(reason);
    const pendingRequest = this.pendingHttpRequests.get(connectionId);
    if (pendingRequest !== undefined) {
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(error);
      this.pendingHttpRequests.delete(connectionId);
    }

    const pendingStream = this.pendingHttpStreams.get(connectionId);
    if (pendingStream !== undefined) {
      clearTimeout(pendingStream.timeout);
      pendingStream.reject(error);
      this.pendingHttpStreams.delete(connectionId);
    }

    const activeResponse = this.activeHttpResponses.get(connectionId);
    if (activeResponse !== undefined) {
      if (activeResponse.kind === "buffer") {
        activeResponse.pending.reject(error);
      } else {
        activeResponse.controller.error(error);
      }
      this.activeHttpResponses.delete(connectionId);
    }

    if (this.machineWebSocket.readyState === WebSocket.OPEN) {
      this.machineWebSocket.send(stringifyTunnelControlMessage({
        type: "close",
        connectionId,
        code: TUNNEL_OVERLOAD_CLOSE_CODE,
        reason: TUNNEL_OVERLOAD_CLOSE_REASON,
      }));
    }
  }

  private resolveHttpStreamStart(message: Extract<TunnelControlMessage, { readonly type: "httpResponseStart" }>): void {
    const buffered = this.pendingHttpRequests.get(message.connectionId);

    if (buffered !== undefined) {
      this.activeHttpResponses.set(message.connectionId, {
        kind: "buffer",
        statusCode: message.statusCode,
        headers: message.headers,
        chunks: [],
        pending: buffered,
        profile: buffered.profile,
        bytesQueued: 0,
      });
      return;
    }

    const pending = this.pendingHttpStreams.get(message.connectionId);

    if (pending === undefined) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingHttpStreams.delete(message.connectionId);

    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const cancel = (): void => {
      this.observeTunnelSend(
        this.sendControlToMachine({
          type: "close",
          connectionId: message.connectionId,
          code: 1000,
          reason: "HTTP stream cancelled",
        }, pending.profile),
        message.connectionId,
        pending.profile,
      );
      this.activeHttpResponses.delete(message.connectionId);
      this.sendScheduler.removeConnection(message.connectionId);
    };
    const body = new ReadableStream<Uint8Array>({
      start: (streamController) => {
        controller = streamController;
      },
      cancel,
    }, {
      highWaterMark: pending.profile.maxQueuedBytes,
      size: (chunk) => chunk.byteLength,
    });

    if (controller === null) {
      pending.reject(new Error("Failed to open HTTP stream"));
      return;
    }

    this.activeHttpResponses.set(message.connectionId, { kind: "stream", controller, profile: pending.profile });
    pending.resolve({
      statusCode: message.statusCode,
      headers: message.headers,
      body,
      cancel,
    });
  }

  private writeHttpStreamChunk(connectionId: string, chunk: Buffer): void {
    const response = this.activeHttpResponses.get(connectionId);

    if (response === undefined) {
      return;
    }

    if (response.kind === "buffer") {
      response.bytesQueued += chunk.byteLength;
      if (response.bytesQueued > response.profile.maxQueuedBytes) {
        this.closeLogicalConnectionForOverload(connectionId, response.profile, TUNNEL_OVERLOAD_CLOSE_REASON);
        return;
      }

      response.chunks.push(chunk);
      return;
    }

    response.controller.enqueue(chunk);
    if (response.controller.desiredSize !== null && response.controller.desiredSize < 0) {
      this.closeLogicalConnectionForOverload(connectionId, response.profile, TUNNEL_OVERLOAD_CLOSE_REASON);
    }
  }

  private closeHttpStream(connectionId: string): void {
    const response = this.activeHttpResponses.get(connectionId);

    if (response === undefined) {
      return;
    }

    if (response.kind === "buffer") {
      clearTimeout(response.pending.timeout);
      this.pendingHttpRequests.delete(connectionId);
      response.pending.resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(response.chunks),
      });
    } else {
      response.controller.close();
    }

    this.activeHttpResponses.delete(connectionId);
    this.sendScheduler.removeConnection(connectionId);
  }

  private rejectPendingHttpRequests(error: Error): void {
    for (const [connectionId, pending] of this.pendingHttpRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingHttpRequests.delete(connectionId);
      this.activeHttpResponses.delete(connectionId);
      this.sendScheduler.removeConnection(connectionId);
    }
  }

  private rejectHttpStreams(error: Error): void {
    for (const [connectionId, pending] of this.pendingHttpStreams.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingHttpStreams.delete(connectionId);
      this.activeHttpResponses.delete(connectionId);
      this.sendScheduler.removeConnection(connectionId);
    }

    for (const [connectionId, response] of this.activeHttpResponses.entries()) {
      if (response.kind === "buffer") {
        response.pending.reject(error);
      } else {
        response.controller.error(error);
      }
      this.activeHttpResponses.delete(connectionId);
      this.sendScheduler.removeConnection(connectionId);
    }
  }

  private observeTunnelSend(promise: Promise<void>, connectionId: string, profile: TunnelQueueProfile): void {
    promise.catch((error) => {
      logger.warn({
        event: "machine_tunnel.logical_send_failed",
        computerId: this.computerId,
        tunnelId: this.tunnelId,
        connectionId,
        trafficClass: profile.trafficClass,
        err: errorToLog(error),
      }, "Logical tunnel send failed");
    });
  }
}

interface MachineTunnelHeartbeatOptions {
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
}

interface PendingHttpRequest {
  readonly resolve: (response: GatewayHttpResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly profile: TunnelQueueProfile;
}

interface PendingHttpStream {
  readonly resolve: (response: GatewayHttpStreamResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly profile: TunnelQueueProfile;
}

type ActiveHttpResponse =
  | {
      readonly kind: "buffer";
      readonly statusCode: number;
      readonly headers: Record<string, string>;
      readonly chunks: Buffer[];
      readonly pending: PendingHttpRequest;
      readonly profile: TunnelQueueProfile;
      bytesQueued: number;
    }
  | {
      readonly kind: "stream";
      readonly controller: ReadableStreamDefaultController<Uint8Array>;
      readonly profile: TunnelQueueProfile;
    };

interface GatewayConnectionStats {
  readonly openedAt: number;
  readonly route: GatewayRoute;
  readonly profile: TunnelQueueProfile;
  messagesFromGateway: number;
  messagesToGateway: number;
}

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
  cookieHeader: string | undefined,
  routeMatch: { readonly computerId: string; readonly route: GatewayRoute; readonly suffix: string },
): Promise<ComputerAccessSessionRecord | "forbidden" | null> => {
  const token = readBearerToken(authorization)
    ?? requestUrl.searchParams.get("accessToken")
    ?? requestUrl.searchParams.get("token")
    ?? (routeMatch.route === "preview" ? readCookie(cookieHeader, PREVIEW_ACCESS_COOKIE_NAME) : undefined)
    ?? undefined;

  if (token === undefined || token.length === 0) {
    return null;
  }

  const accessSession = await options.gatewayAccessService.authenticateAccessToken({ token, computerId: routeMatch.computerId });

  if (accessSession === null) {
    return null;
  }

  return hasAccessScope(accessSession, scopeForGatewayWebSocketRoute(routeMatch.route, routeMatch.suffix))
    ? accessSession
    : "forbidden";
};

const matchGatewayRoute = (
  pathname: string,
): { readonly computerId: string; readonly route: GatewayRoute; readonly suffix: string } | null => {
  const match = /^\/gateway\/computers\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(pathname);

  if (match === null) {
    return null;
  }

  const route = match[2];

  if (route !== "filesystem" && route !== "browser-control" && route !== "preview") {
    return null;
  }

  return {
    computerId: decodeURIComponent(match[1] ?? ""),
    route,
    suffix: match[3] ?? "",
  };
};

const buildMachineTargetPath = (
  routeMatch: { readonly route: GatewayRoute; readonly suffix: string },
  requestUrl: URL,
): string => {
  const query = new URLSearchParams(requestUrl.searchParams);
  query.delete("accessToken");
  query.delete("token");
  const queryString = query.toString();
  const suffix = routeMatch.suffix.length > 0 ? `/${routeMatch.suffix}` : "";

  return `/${routeMatch.route}${suffix}${queryString.length > 0 ? `?${queryString}` : ""}`;
};

const scopeForGatewayWebSocketRoute = (
  route: GatewayRoute,
  suffix: string,
): GatewayAccessScope => {
  if (route === "browser-control") {
    return "browser-control:ws";
  }

  if (route === "preview" && (suffix === "ws" || suffix.startsWith("ws/"))) {
    return "preview:ws";
  }

  return "filesystem:ws";
};

const readCookie = (cookieHeader: string | undefined, name: string): string | undefined => {
  if (cookieHeader === undefined) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    if (rawName !== name || rawValueParts.length === 0) {
      continue;
    }

    const rawValue = rawValueParts.join("=");
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return undefined;
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

const inferHttpTrafficClass = (path: string): TunnelTrafficClass => {
  if (path.startsWith("/filesystem/download")) {
    return "filesystem:download";
  }

  if (path.startsWith("/filesystem/uploads")) {
    return "filesystem:upload";
  }

  if (path.startsWith("/agent")) {
    return "agent:http";
  }

  if (path.startsWith("/capabilities")) {
    return "capabilities:http";
  }

  if (path.startsWith("/preview")) {
    return "preview:http";
  }

  if (path.startsWith("/feedback")) {
    return "feedback:http";
  }

  return "generic:http";
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
