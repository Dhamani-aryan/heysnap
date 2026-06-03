import { createServer, type ClientRequest, type IncomingMessage, type Server } from "node:http";
import { EventEmitter } from "node:events";
import type { ReadableStream } from "node:stream/web";

import { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeTunnelBinaryFrame,
  encodeTunnelBinaryFrame,
  parseTunnelControlMessage,
  stringifyTunnelControlMessage,
  type TunnelBinaryFrame,
  type TunnelControlMessage,
} from "@ank1015-app/tunnel-protocol";

import type { CloudServerConfig } from "../src/config.js";
import { hashToken } from "../src/auth/tokens.js";
import { GatewayAccessService } from "../src/gateway/access-sessions.js";
import { attachGatewayTunnelServer, MachineTunnel, MachineTunnelRegistry, normalizeWebSocketCloseCode } from "../src/gateway/tunnel.js";
import { InMemoryCloudStore } from "./in-memory-store.js";

const config: CloudServerConfig = {
  port: 4100,
  databaseUrl: "postgres://test",
  sessionSecret: "test-session-secret",
  sessionTtlSeconds: 60 * 60,
  computerAccessSessionTtlSeconds: 60,
  cloudServerPublicUrl: "https://cloud.example.com",
  awsRegion: "ap-south-1",
  awsEc2InstanceType: "t3.large",
  awsEc2RootVolumeGb: 80,
  awsMachineInstanceProfileName: "ank1015-machine-profile",
  awsMachineAmiSsmParameter: "/ank1015/machine-images/test/ami-id",
  machineServerChannel: "stable",
  allowedOrigins: ["https://app.example.com"],
  adminToken: "test-admin-token",
};

const servers: Server[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

describe("gateway tunnel", () => {
  it("terminates a machine tunnel after a missed heartbeat pong", async () => {
    vi.useFakeTimers();
    const registry = new MachineTunnelRegistry();
    const socket = new FakeMachineWebSocket();
    const tunnel = new MachineTunnel("computer-1", socket as unknown as WebSocket, registry, {
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 10,
    });
    registry.set("computer-1", tunnel);

    await vi.advanceTimersByTimeAsync(5);
    expect(socket.pingCount).toBe(1);

    await vi.advanceTimersByTimeAsync(10);
    expect(socket.terminated).toBe(true);
    expect(registry.isConnected("computer-1")).toBe(false);
  });

  it("clears machine tunnel heartbeat timers when the socket closes", async () => {
    vi.useFakeTimers();
    const registry = new MachineTunnelRegistry();
    const socket = new FakeMachineWebSocket();
    const tunnel = new MachineTunnel("computer-1", socket as unknown as WebSocket, registry, {
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 10,
    });
    registry.set("computer-1", tunnel);

    socket.close(1000, "done");
    await vi.advanceTimersByTimeAsync(50);

    expect(socket.pingCount).toBe(0);
    expect(registry.isConnected("computer-1")).toBe(false);
  });

  it("drops late messages from a replaced machine tunnel", () => {
    const registry = new MachineTunnelRegistry();
    const staleSocket = new FakeMachineWebSocket();
    const currentSocket = new FakeMachineWebSocket();
    const staleTunnel = new MachineTunnel("computer-1", staleSocket as unknown as WebSocket, registry);
    const currentTunnel = new MachineTunnel("computer-1", currentSocket as unknown as WebSocket, registry);
    registry.set("computer-1", currentTunnel);

    staleSocket.emit("message", Buffer.from("not-json", "utf8"), false);

    expect(staleSocket.closed).toBe(false);
    expect(registry.get("computer-1")).toBe(currentTunnel);

    staleTunnel.close(1000, "done");
    currentTunnel.close(1000, "done");
  });

  it("routes gateway websocket data through a connected machine tunnel", async () => {
    const { server, baseUrl, user, computer, access, machine } = await startConnectedTunnel();
    const machineOpen = waitForJsonMessage<CloudOpenMessage>(machine);
    const gateway = await openWebSocket(
      `${baseUrl}/gateway/computers/${computer.id}/filesystem?accessToken=${access.token}&path=src`,
    );
    const openMessage = await machineOpen;

    expect(openMessage).toMatchObject({
      type: "open",
      route: "filesystem",
      path: "/filesystem?path=src",
      metadata: {
        userId: user.id,
        accessSessionId: access.accessSession.id,
        computerId: computer.id,
      },
    });

    machine.send(stringifyTunnelControlMessage({ type: "openResult", connectionId: openMessage.connectionId, ok: true }));
    machine.send(encodeTunnelBinaryFrame({
      type: "wsData",
      connectionId: openMessage.connectionId,
      payload: Buffer.from(JSON.stringify({ type: "hello", serverTime: "now" }), "utf8"),
      isText: true,
    }));

    const gatewayHello = await waitForJsonFrame(gateway);
    expect(gatewayHello.isBinary).toBe(false);
    expect(gatewayHello.message).toMatchObject({ type: "hello" });
    gateway.send(JSON.stringify({ type: "ping", requestId: "ping-1" }));

    const dataMessage = await waitForBinaryFrame(machine);
    expect(dataMessage.type).toBe("wsData");
    expect(dataMessage.isText).toBe(true);
    expect(JSON.parse(dataMessage.payload.toString("utf8"))).toEqual({
      type: "ping",
      requestId: "ping-1",
    });

    gateway.close();
    machine.close();
    await closeServer(server);
  });

  it("streams agent HTTP responses through the machine tunnel", async () => {
    const { server, computer, machine, registry } = await startConnectedTunnel();
    await waitForCondition(() => registry.isConnected(computer.id));
    const requestPromise = waitForHttpRequestMessage(machine);
    const proxyPromise = registry.proxyStreamingHttpRequest(computer.id, {
      path: "/agent/runs",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.from("{\"path\":\"Projects\"}", "utf8"),
    });
    const request = await requestPromise;

    expect(request).toMatchObject({
      type: "httpRequestStart",
      path: "/agent/runs",
      method: "POST",
      headers: { "content-type": "application/json" },
      stream: true,
      trafficClass: "agent:http",
    });
    expect(request.body.toString("utf8")).toBe("{\"path\":\"Projects\"}");

    machine.send(stringifyTunnelControlMessage({
      type: "httpResponseStart",
      connectionId: request.connectionId,
      statusCode: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    machine.send(encodeTunnelBinaryFrame({
      type: "httpResponseBody",
      connectionId: request.connectionId,
      payload: Buffer.from("event: run_start\n", "utf8"),
    }));
    machine.send(encodeTunnelBinaryFrame({
      type: "httpResponseBody",
      connectionId: request.connectionId,
      payload: Buffer.from("data: {\"runId\":\"run-1\"}\n\n", "utf8"),
    }));
    machine.send(stringifyTunnelControlMessage({ type: "httpResponseEnd", connectionId: request.connectionId }));

    const response = await proxyPromise;

    expect(response).not.toBeNull();
    expect(response?.statusCode).toBe(200);
    expect(response?.headers["content-type"]).toBe("text/event-stream");
    expect(await readStreamText(response?.body)).toBe("event: run_start\ndata: {\"runId\":\"run-1\"}\n\n");

    machine.close();
    await closeServer(server);
  });

  it("streams HTTP download requests through the machine tunnel", async () => {
    const { server, computer, machine, registry } = await startConnectedTunnel();
    await waitForCondition(() => registry.isConnected(computer.id));
    await delay(10);
    const requestPromise = waitForHttpRequestMessage(machine);
    const proxyPromise = registry.proxyStreamingHttpRequest(computer.id, {
      path: "/filesystem/download?path=Project",
      trafficClass: "filesystem:download",
    });
    const request = await requestPromise;

    expect(request).toMatchObject({
      type: "httpRequestStart",
      path: "/filesystem/download?path=Project",
      stream: true,
      trafficClass: "filesystem:download",
    });
    expect(request.body.byteLength).toBe(0);

    machine.send(stringifyTunnelControlMessage({
      type: "httpResponseStart",
      connectionId: request.connectionId,
      statusCode: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": "attachment; filename=\"Project.zip\"",
      },
    }));
    machine.send(encodeTunnelBinaryFrame({
      type: "httpResponseBody",
      connectionId: request.connectionId,
      payload: Buffer.from("zip-bytes", "utf8"),
    }));
    machine.send(stringifyTunnelControlMessage({ type: "httpResponseEnd", connectionId: request.connectionId }));

    const response = await proxyPromise;

    expect(response).not.toBeNull();
    expect(response?.statusCode).toBe(200);
    expect(response?.headers["content-type"]).toBe("application/zip");
    expect(await readStreamText(response?.body)).toBe("zip-bytes");

    machine.close();
    await closeServer(server);
  });

  it("sends tunnel close when a streamed HTTP response is cancelled", async () => {
    const { server, computer, machine, registry } = await startConnectedTunnel();
    await waitForCondition(() => registry.isConnected(computer.id));
    const requestPromise = waitForHttpRequestMessage(machine);
    const proxyPromise = registry.proxyStreamingHttpRequest(computer.id, {
      path: "/filesystem/download?path=Project",
      trafficClass: "filesystem:download",
    });
    const request = await requestPromise;

    machine.send(stringifyTunnelControlMessage({
      type: "httpResponseStart",
      connectionId: request.connectionId,
      statusCode: 200,
      headers: { "content-type": "application/zip" },
    }));

    const response = await proxyPromise;
    expect(response).not.toBeNull();
    const closePromise = waitForJsonMessage<CloudCloseMessage>(machine);
    await response?.body.cancel();

    await expect(closePromise).resolves.toMatchObject({
      type: "close",
      connectionId: request.connectionId,
      code: 1000,
      reason: "HTTP stream cancelled",
    });

    machine.close();
    await closeServer(server);
  });

  it("returns null for HTTP proxy requests without a connected tunnel", async () => {
    const { server, store, registry } = await startTunnelServer();
    const user = await store.createUser({ email: "user@example.com", username: "user", passwordHash: "hash" });
    const computer = await store.createComputer({
      ownerUserId: user.id,
      name: "VM",
      kind: "cloud",
      status: "idle",
      providerMetadata: {},
      capabilities: ["filesystem"],
    });

    await expect(registry.proxyHttpRequest(computer.id, { path: "/filesystem/download" })).resolves.toBeNull();
    await closeServer(server);
  });

  it("rejects gateway connections without a valid access token", async () => {
    const { server, baseUrl, store } = await startTunnelServer();
    const user = await store.createUser({ email: "user@example.com", username: "user", passwordHash: "hash" });
    const computer = await store.createComputer({
      ownerUserId: user.id,
      name: "VM",
      kind: "cloud",
      status: "idle",
      providerMetadata: {},
      capabilities: ["filesystem"],
    });

    await expect(openWebSocket(`${baseUrl}/gateway/computers/${computer.id}/filesystem`)).rejects.toThrow();
    await closeServer(server);
  });

  it("routes browser-control websocket data through a connected machine tunnel with user metadata", async () => {
    const { server, baseUrl, user, computer, access, machine } = await startConnectedTunnel();
    const machineOpen = waitForJsonMessage<CloudOpenMessage>(machine);
    const gateway = await openWebSocket(
      `${baseUrl}/gateway/computers/${computer.id}/browser-control?accessToken=${access.token}`,
    );
    const openMessage = await machineOpen;

    expect(openMessage).toMatchObject({
      type: "open",
      route: "browser-control",
      path: "/browser-control",
      metadata: {
        userId: user.id,
        accessSessionId: access.accessSession.id,
        computerId: computer.id,
      },
    });

    machine.send(stringifyTunnelControlMessage({ type: "openResult", connectionId: openMessage.connectionId, ok: true }));
    gateway.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "client-1", capabilities: [] }));

    const dataMessage = await waitForBinaryFrame(machine);
    expect(dataMessage.type).toBe("wsData");
    expect(dataMessage.isText).toBe(true);
    expect(JSON.parse(dataMessage.payload.toString("utf8"))).toEqual({
      type: "hello",
      protocolVersion: 1,
      clientId: "client-1",
      capabilities: [],
    });

    gateway.close();
    machine.close();
    await closeServer(server);
  });

  it("relays browser-view publisher frames to subscribers without a machine tunnel", async () => {
    const { server, baseUrl, store } = await startTunnelServer();
    const user = await store.createUser({ email: "view-user@example.com", username: "view-user", passwordHash: "hash" });
    const computer = await store.createComputer({
      ownerUserId: user.id,
      name: "VM",
      kind: "cloud",
      status: "idle",
      providerMetadata: {},
      capabilities: ["filesystem", "agent"],
    });
    const access = await new GatewayAccessService(store, config).createAccessSession({
      userId: user.id,
      computerId: computer.id,
    });

    const publisherOpen = await openWebSocketWithJsonMessage<{
      readonly type: string;
      readonly subscriberCount: number;
    }>(
      `${baseUrl}/gateway/computers/${computer.id}/browser-view/publish?accessToken=${access.token}`,
    );
    const publisher = publisherOpen.webSocket;
    expect(publisherOpen.message).toMatchObject({
      type: "publisher.ready",
      subscriberCount: 0,
    });

    const subscriberOpen = await openWebSocketWithJsonMessage<{
      readonly type: string;
      readonly connected: boolean;
    }>(
      `${baseUrl}/gateway/computers/${computer.id}/browser-view/subscribe?accessToken=${access.token}`,
    );
    const subscriber = subscriberOpen.webSocket;
    expect(subscriberOpen.message).toMatchObject({
      type: "publisher.status",
      connected: true,
    });

    const commandMessage = {
      type: "browser.command",
      requestId: "command-1",
      command: "navigate",
      url: "example.com",
    };
    const commandForwardPromise = waitForJsonMessage(publisher);
    subscriber.send(JSON.stringify(commandMessage));
    await expect(commandForwardPromise).resolves.toEqual(commandMessage);

    const activeTabMessage = {
      type: "activeTab",
      windowId: 12,
      tabId: 34,
      title: "Example",
      url: "https://example.com",
      timestamp: "2026-06-03T00:00:00.000Z",
    };
    const browserStatusMessage = {
      type: "browser.status",
      connected: true,
      extensionStatus: "available",
      connectionStatus: "connected",
      windowId: 12,
      windowReady: true,
      timestamp: "2026-06-03T00:00:01.000Z",
    };
    const streamStatusMessage = {
      type: "stream.status",
      streaming: true,
      timestamp: "2026-06-03T00:00:02.000Z",
    };
    const stoppedStreamStatusMessage = {
      type: "stream.status",
      streaming: false,
      timestamp: "2026-06-03T00:00:03.000Z",
    };
    const frameMessage = {
      type: "frame",
      sequence: 1,
      tabId: 34,
      aspectRatio: 390 / 844,
      mimeType: "image/jpeg",
      byteLength: 4,
      receivedAt: 123,
      sentAt: 456,
    };
    const frameBytes = Buffer.from([1, 2, 3, 4]);
    const activeTabPromise = waitForJsonMessage(subscriber);
    publisher.send(JSON.stringify(activeTabMessage));
    await expect(activeTabPromise).resolves.toEqual(activeTabMessage);

    const browserStatusPromise = waitForJsonMessage(subscriber);
    publisher.send(JSON.stringify(browserStatusMessage));
    await expect(browserStatusPromise).resolves.toEqual(browserStatusMessage);

    const streamStatusPromise = waitForJsonMessage(subscriber);
    publisher.send(JSON.stringify(streamStatusMessage));
    await expect(streamStatusPromise).resolves.toEqual(streamStatusMessage);

    const frameMetadataPromise = waitForJsonMessage(subscriber);
    const frameBinaryPromise = waitForRawBinaryMessage(subscriber);
    publisher.send(JSON.stringify(frameMessage));
    publisher.send(frameBytes);

    await expect(frameMetadataPromise).resolves.toEqual(frameMessage);
    await expect(frameBinaryPromise).resolves.toEqual(frameBytes);

    const lateSubscriberOpen = await openWebSocketWithInitialMessages(
      `${baseUrl}/gateway/computers/${computer.id}/browser-view/subscribe?accessToken=${access.token}`,
      6,
    );
    const lateSubscriber = lateSubscriberOpen.webSocket;
    expect(lateSubscriberOpen.messages[0]).toMatchObject({
      kind: "json",
      message: {
        type: "publisher.status",
        connected: true,
      },
    });
    expect(lateSubscriberOpen.messages[1]).toEqual({
      kind: "json",
      message: activeTabMessage,
    });
    expect(lateSubscriberOpen.messages[2]).toEqual({
      kind: "json",
      message: browserStatusMessage,
    });
    expect(lateSubscriberOpen.messages[3]).toEqual({
      kind: "json",
      message: streamStatusMessage,
    });
    expect(lateSubscriberOpen.messages[4]).toEqual({
      kind: "json",
      message: frameMessage,
    });
    expect(lateSubscriberOpen.messages[5]).toMatchObject({
      kind: "binary",
    });
    expect(
      lateSubscriberOpen.messages[5]?.kind === "binary" ? lateSubscriberOpen.messages[5].data : null,
    ).toEqual(frameBytes);

    const stoppedStreamPromise = waitForJsonMessage(subscriber);
    const lateStoppedStreamPromise = waitForJsonMessage(lateSubscriber);
    publisher.send(JSON.stringify(stoppedStreamStatusMessage));
    await expect(stoppedStreamPromise).resolves.toEqual(stoppedStreamStatusMessage);
    await expect(lateStoppedStreamPromise).resolves.toEqual(stoppedStreamStatusMessage);

    const stoppedLateSubscriberOpen = await openWebSocketWithInitialMessages(
      `${baseUrl}/gateway/computers/${computer.id}/browser-view/subscribe?accessToken=${access.token}`,
      4,
    );
    const stoppedLateSubscriber = stoppedLateSubscriberOpen.webSocket;
    expect(stoppedLateSubscriberOpen.messages).toEqual([
      {
        kind: "json",
        message: {
          type: "publisher.status",
          connected: true,
        },
      },
      {
        kind: "json",
        message: activeTabMessage,
      },
      {
        kind: "json",
        message: browserStatusMessage,
      },
      {
        kind: "json",
        message: stoppedStreamStatusMessage,
      },
    ]);

    publisher.close();
    await expect(waitForJsonMessage(subscriber)).resolves.toMatchObject({
      type: "publisher.status",
      connected: false,
    });
    await expect(waitForJsonMessage(lateSubscriber)).resolves.toMatchObject({
      type: "publisher.status",
      connected: false,
    });

    subscriber.close();
    lateSubscriber.close();
    stoppedLateSubscriber.close();
    await closeServer(server);
  });

  it("routes preview websocket subpaths through a connected machine tunnel", async () => {
    const { server, baseUrl, user, computer, access, machine } = await startConnectedTunnel();
    const machineOpen = waitForJsonMessage<CloudOpenMessage>(machine);
    const gateway = await openWebSocket(
      `${baseUrl}/gateway/computers/${computer.id}/preview/ws?accessToken=${access.token}`,
    );
    const openMessage = await machineOpen;

    expect(openMessage).toMatchObject({
      type: "open",
      route: "preview",
      path: "/preview/ws",
      metadata: {
        userId: user.id,
        accessSessionId: access.accessSession.id,
        computerId: computer.id,
      },
    });

    machine.send(stringifyTunnelControlMessage({ type: "openResult", connectionId: openMessage.connectionId, ok: true }));
    gateway.send(JSON.stringify({ type: "watch", path: "Budget.xlsx" }));

    const dataMessage = await waitForBinaryFrame(machine);
    expect(dataMessage.type).toBe("wsData");
    expect(dataMessage.isText).toBe(true);
    expect(JSON.parse(dataMessage.payload.toString("utf8"))).toEqual({
      type: "watch",
      path: "Budget.xlsx",
    });

    gateway.close();
    machine.close();
    await closeServer(server);
  });

  it("authenticates preview websocket subpaths with the scoped preview cookie", async () => {
    const { server, baseUrl, user, computer, access, machine } = await startConnectedTunnel();
    const machineOpen = waitForJsonMessage<CloudOpenMessage>(machine);
    const gateway = await openWebSocket(
      `${baseUrl}/gateway/computers/${computer.id}/preview/ws`,
      { cookie: `heysnap_preview_access=${encodeURIComponent(access.token)}` },
    );
    const openMessage = await machineOpen;

    expect(openMessage).toMatchObject({
      type: "open",
      route: "preview",
      path: "/preview/ws",
      metadata: {
        userId: user.id,
        accessSessionId: access.accessSession.id,
        computerId: computer.id,
      },
    });

    gateway.close();
    machine.close();
    await closeServer(server);
  });

  it("normalizes reserved websocket close codes before forwarding them", () => {
    expect(normalizeWebSocketCloseCode(1005)).toBe(1000);
    expect(normalizeWebSocketCloseCode(1006)).toBe(1000);
    expect(normalizeWebSocketCloseCode(1015)).toBe(1000);
    expect(normalizeWebSocketCloseCode(1011)).toBe(1011);
    expect(normalizeWebSocketCloseCode(4000)).toBe(4000);
  });
});

interface CloudOpenMessage {
  readonly type: "open";
  readonly connectionId: string;
  readonly route: string;
  readonly path: string;
  readonly metadata?: {
    readonly userId: string;
    readonly accessSessionId: string;
    readonly computerId: string;
  };
}

interface CloudHttpRequestMessage {
  readonly type: "httpRequestStart";
  readonly connectionId: string;
  readonly path: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly stream?: boolean;
  readonly trafficClass?: string;
  readonly body: Buffer;
}

interface CloudCloseMessage {
  readonly type: "close";
  readonly connectionId: string;
  readonly code?: number;
  readonly reason?: string;
}

const startTunnelServer = async (): Promise<{
  readonly server: Server;
  readonly baseUrl: string;
  readonly store: InMemoryCloudStore;
  readonly registry: MachineTunnelRegistry;
}> => {
  const store = new InMemoryCloudStore();
  const registry = new MachineTunnelRegistry();
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const gatewayAccessService = new GatewayAccessService(store, config);
  attachGatewayTunnelServer(server, { store, config, gatewayAccessService, registry });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return { server, baseUrl: `ws://127.0.0.1:${String(address.port)}`, store, registry };
};

const startConnectedTunnel = async (): Promise<{
  readonly server: Server;
  readonly baseUrl: string;
  readonly store: InMemoryCloudStore;
  readonly user: { readonly id: string };
  readonly computer: { readonly id: string };
  readonly access: { readonly token: string; readonly accessSession: { readonly id: string } };
  readonly machine: WebSocket;
  readonly registry: MachineTunnelRegistry;
}> => {
  const { server, baseUrl, store, registry } = await startTunnelServer();
  const user = await store.createUser({ email: "user@example.com", username: "user", passwordHash: "hash" });
  const computer = await store.createComputer({
    ownerUserId: user.id,
    name: "VM",
    kind: "cloud",
    status: "idle",
    providerMetadata: {},
    capabilities: ["filesystem", "agent"],
  });
  const machineIdentity = await store.createMachineIdentity({
    computerId: computer.id,
    bootstrapTokenHash: hashToken("bootstrap-token", config.sessionSecret),
  });
  await store.activateMachineIdentity({
    identityId: machineIdentity.id,
    tokenHash: hashToken("machine-token", config.sessionSecret),
    activatedAt: new Date(),
  });
  const access = await new GatewayAccessService(store, config).createAccessSession({
    userId: user.id,
    computerId: computer.id,
  });
  const machine = await openWebSocket(`${baseUrl}/machines/tunnel`, {
    authorization: "Bearer machine-token",
  });

  return { server, baseUrl, store, user, computer, access, machine, registry };
};

const openWebSocket = (
  url: string,
  headers?: Record<string, string>,
): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const webSocket = new WebSocket(url, { headers });
    webSocket.once("open", () => resolve(webSocket));
    webSocket.once("error", reject);
    webSocket.once("unexpected-response", (_request, response) => {
      reject(new Error(`Unexpected response ${String(response.statusCode)}`));
    });
  });

const openWebSocketWithJsonMessage = <TMessage>(
  url: string,
  headers?: Record<string, string>,
): Promise<{ readonly webSocket: WebSocket; readonly message: TMessage }> =>
  new Promise((resolve, reject) => {
    const webSocket = new WebSocket(url, { headers });
    let opened = false;
    let message: TMessage | null = null;

    const cleanup = (): void => {
      clearTimeout(timeout);
      webSocket.off("open", onOpen);
      webSocket.off("message", onMessage);
      webSocket.off("error", onError);
      webSocket.off("unexpected-response", onUnexpectedResponse);
    };
    const maybeResolve = (): void => {
      if (!opened || message === null) return;
      cleanup();
      resolve({ webSocket, message });
    };
    const onOpen = (): void => {
      opened = true;
      maybeResolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onUnexpectedResponse = (_request: ClientRequest, response: IncomingMessage): void => {
      cleanup();
      reject(new Error(`Unexpected response ${String(response.statusCode)}`));
    };
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      if (isBinary || message !== null) {
        return;
      }

      try {
        message = JSON.parse(data.toString("utf8")) as TMessage;
        maybeResolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      webSocket.close();
      reject(new Error("Timed out waiting for websocket open message"));
    }, 3000);

    webSocket.on("open", onOpen);
    webSocket.on("message", onMessage);
    webSocket.once("error", onError);
    webSocket.once("unexpected-response", onUnexpectedResponse);
  });

type CapturedWebSocketMessage =
  | { readonly kind: "json"; readonly message: unknown }
  | { readonly kind: "binary"; readonly data: Buffer };

const openWebSocketWithInitialMessages = (
  url: string,
  messageCount: number,
  headers?: Record<string, string>,
): Promise<{ readonly webSocket: WebSocket; readonly messages: readonly CapturedWebSocketMessage[] }> =>
  new Promise((resolve, reject) => {
    const webSocket = new WebSocket(url, { headers });
    const messages: CapturedWebSocketMessage[] = [];
    let opened = false;
    let resolved = false;

    const cleanup = (): void => {
      clearTimeout(timeout);
      webSocket.off("open", onOpen);
      webSocket.off("message", onMessage);
      webSocket.off("error", onError);
      webSocket.off("unexpected-response", onUnexpectedResponse);
    };
    const maybeResolve = (): void => {
      if (!opened || resolved || messages.length < messageCount) return;
      resolved = true;
      cleanup();
      resolve({ webSocket, messages });
    };
    const onOpen = (): void => {
      opened = true;
      maybeResolve();
    };
    const onError = (error: Error): void => {
      if (resolved) return;
      cleanup();
      reject(error);
    };
    const onUnexpectedResponse = (_request: ClientRequest, response: IncomingMessage): void => {
      cleanup();
      reject(new Error(`Unexpected response ${String(response.statusCode)}`));
    };
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      try {
        messages.push(isBinary
          ? { kind: "binary", data: rawWebSocketDataToBuffer(data) }
          : { kind: "json", message: JSON.parse(data.toString("utf8")) });
        maybeResolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      webSocket.close();
      reject(new Error("Timed out waiting for websocket initial messages"));
    }, 3000);

    webSocket.on("open", onOpen);
    webSocket.on("message", onMessage);
    webSocket.once("error", onError);
    webSocket.once("unexpected-response", onUnexpectedResponse);
  });

const waitForJsonMessage = <TMessage>(webSocket: WebSocket): Promise<TMessage> =>
  new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      webSocket.off("message", onMessage);
      webSocket.off("error", onError);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      if (isBinary) {
        return;
      }

      cleanup();
      try {
        resolve(JSON.parse(data.toString("utf8")) as TMessage);
      } catch (error) {
        reject(error);
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message"));
    }, 3000);
    webSocket.on("message", onMessage);
    webSocket.once("error", onError);
  });

const waitForBinaryFrame = (webSocket: WebSocket): Promise<TunnelBinaryFrame> =>
  new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      webSocket.off("message", onMessage);
      webSocket.off("error", onError);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      if (!isBinary) {
        return;
      }

      cleanup();
      const frame = decodeTunnelBinaryFrame(data);
      if (frame === null) {
        reject(new Error("Received malformed tunnel binary frame"));
        return;
      }

      resolve(frame);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket binary frame"));
    }, 3000);
    webSocket.on("message", onMessage);
    webSocket.once("error", onError);
  });

const waitForRawBinaryMessage = (webSocket: WebSocket): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      webSocket.off("message", onMessage);
      webSocket.off("error", onError);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      if (!isBinary) {
        return;
      }

      cleanup();
      resolve(rawWebSocketDataToBuffer(data));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket binary message"));
    }, 3000);
    webSocket.on("message", onMessage);
    webSocket.once("error", onError);
  });

const rawWebSocketDataToBuffer = (data: WebSocket.RawData): Buffer => {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  return data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.concat(data);
};

const waitForHttpRequestMessage = (webSocket: WebSocket): Promise<CloudHttpRequestMessage> =>
  new Promise((resolve, reject) => {
    let start: Extract<TunnelControlMessage, { type: "httpRequestStart" }> | undefined;
    const chunks: Buffer[] = [];
    const cleanup = (): void => {
      clearTimeout(timeout);
      webSocket.off("message", onMessage);
      webSocket.off("error", onError);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      try {
        if (isBinary) {
          const frame = decodeTunnelBinaryFrame(data);
          if (frame?.type === "httpRequestBody") {
            chunks.push(frame.payload);
          }
          return;
        }

        const message = parseTunnelControlMessage(data.toString("utf8"));
        if (message?.type === "httpRequestStart") {
          start = message;
          return;
        }

        if (message?.type === "httpRequestEnd" && start !== undefined) {
          cleanup();
          resolve({
            ...start,
            body: Buffer.concat(chunks),
          });
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for tunnel HTTP request"));
    }, 3000);
    webSocket.on("message", onMessage);
    webSocket.once("error", onError);
  });

const waitForJsonFrame = <TMessage>(webSocket: WebSocket): Promise<{
  readonly message: TMessage;
  readonly isBinary: boolean;
}> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for websocket message")), 3000);
    webSocket.once("message", (data, isBinary) => {
      clearTimeout(timeout);
      try {
        resolve({
          message: JSON.parse(data.toString("utf8")) as TMessage,
          isBinary,
        });
      } catch (error) {
        reject(error);
      }
    });
  });

const waitForCondition = (
  condition: () => boolean,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
        return;
      }

      if (Date.now() - startedAt > 1000) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for condition"));
      }
    }, 10);
  });

const readStreamText = async (stream: ReadableStream<Uint8Array> | undefined): Promise<string> => {
  if (stream === undefined) {
    return "";
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      return text;
    }

    text += decoder.decode(value, { stream: true });
  }
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

class FakeMachineWebSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  pingCount = 0;
  terminated = false;
  closed = false;

  ping(): void {
    this.pingCount += 1;
  }

  send(): void {
    // Test double only needs heartbeat behavior.
  }

  close(code = 1000, reason = ""): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.readyState = WebSocket.CLOSED;
    this.emit("close", code, Buffer.from(reason, "utf8"));
  }

  terminate(): void {
    this.terminated = true;
    this.close(1006, "heartbeat timeout");
  }
}
