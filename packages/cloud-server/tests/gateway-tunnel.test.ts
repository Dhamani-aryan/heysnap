import { createServer, type Server } from "node:http";
import type { ReadableStream } from "node:stream/web";

import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import type { CloudServerConfig } from "../src/config.js";
import { hashToken } from "../src/auth/tokens.js";
import { GatewayAccessService } from "../src/gateway/access-sessions.js";
import { attachGatewayTunnelServer, MachineTunnelRegistry, normalizeWebSocketCloseCode } from "../src/gateway/tunnel.js";
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
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

describe("gateway tunnel", () => {
  it("routes gateway websocket data through a connected machine tunnel", async () => {
    const { server, baseUrl, computer, access, machine } = await startConnectedTunnel();
    const machineOpen = waitForJsonMessage<CloudOpenMessage>(machine);
    const gateway = await openWebSocket(
      `${baseUrl}/gateway/computers/${computer.id}/filesystem?accessToken=${access.token}&path=src`,
    );
    const openMessage = await machineOpen;

    expect(openMessage).toMatchObject({
      type: "open",
      route: "filesystem",
      path: "/filesystem?path=src",
    });

    machine.send(JSON.stringify({ type: "openResult", connectionId: openMessage.connectionId, ok: true }));
    machine.send(JSON.stringify({
      type: "data",
      connectionId: openMessage.connectionId,
      data: Buffer.from(JSON.stringify({ type: "hello", serverTime: "now" }), "utf8").toString("base64"),
      dataType: "text",
    }));

    const gatewayHello = await waitForJsonFrame(gateway);
    expect(gatewayHello.isBinary).toBe(false);
    expect(gatewayHello.message).toMatchObject({ type: "hello" });
    gateway.send(JSON.stringify({ type: "ping", requestId: "ping-1" }));

    const dataMessage = await waitForJsonMessage<CloudDataMessage>(machine);
    expect(dataMessage.type).toBe("data");
    expect(dataMessage.dataType).toBe("text");
    expect(JSON.parse(Buffer.from(dataMessage.data, "base64").toString("utf8"))).toEqual({
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
    const requestPromise = waitForJsonMessage<CloudHttpRequestMessage>(machine);
    const proxyPromise = registry.proxyStreamingHttpRequest(computer.id, {
      path: "/agent/runs",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.from("{\"path\":\"Projects\"}", "utf8"),
    });
    const request = await requestPromise;

    expect(request).toMatchObject({
      type: "httpRequest",
      path: "/agent/runs",
      method: "POST",
      headers: { "content-type": "application/json" },
      bodyBase64: Buffer.from("{\"path\":\"Projects\"}", "utf8").toString("base64"),
      stream: true,
    });

    machine.send(JSON.stringify({
      type: "httpResponseStart",
      connectionId: request.connectionId,
      statusCode: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    machine.send(JSON.stringify({
      type: "httpResponseChunk",
      connectionId: request.connectionId,
      bodyBase64: Buffer.from("event: run_start\n", "utf8").toString("base64"),
    }));
    machine.send(JSON.stringify({
      type: "httpResponseChunk",
      connectionId: request.connectionId,
      bodyBase64: Buffer.from("data: {\"runId\":\"run-1\"}\n\n", "utf8").toString("base64"),
    }));
    machine.send(JSON.stringify({ type: "httpResponseEnd", connectionId: request.connectionId }));

    const response = await proxyPromise;

    expect(response).not.toBeNull();
    expect(response?.statusCode).toBe(200);
    expect(response?.headers["content-type"]).toBe("text/event-stream");
    expect(await readStreamText(response?.body)).toBe("event: run_start\ndata: {\"runId\":\"run-1\"}\n\n");

    machine.close();
    await closeServer(server);
  });

  it("proxies HTTP download requests through the machine tunnel", async () => {
    const { server, computer, machine, registry } = await startConnectedTunnel();
    await waitForCondition(() => registry.isConnected(computer.id));
    await delay(10);
    const requestPromise = waitForJsonMessage<CloudHttpRequestMessage>(machine);
    const proxyPromise = registry.proxyHttpRequest(computer.id, {
      path: "/filesystem/download?path=Project",
    });
    const request = await requestPromise;

    expect(request).toMatchObject({
      type: "httpRequest",
      path: "/filesystem/download?path=Project",
    });

    machine.send(JSON.stringify({
      type: "httpResponse",
      connectionId: request.connectionId,
      statusCode: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": "attachment; filename=\"Project.zip\"",
      },
      bodyBase64: Buffer.from("zip-bytes", "utf8").toString("base64"),
    }));

    const response = await proxyPromise;

    expect(response).not.toBeNull();
    expect(response?.statusCode).toBe(200);
    expect(response?.headers["content-type"]).toBe("application/zip");
    expect(response?.body.toString("utf8")).toBe("zip-bytes");

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
}

interface CloudDataMessage {
  readonly type: "data";
  readonly connectionId: string;
  readonly data: string;
  readonly dataType?: "text" | "binary";
}

interface CloudHttpRequestMessage {
  readonly type: "httpRequest";
  readonly connectionId: string;
  readonly path: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly bodyBase64?: string;
  readonly stream?: boolean;
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
  readonly computer: { readonly id: string };
  readonly access: { readonly token: string };
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

  return { server, baseUrl, store, computer, access, machine, registry };
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

const waitForJsonMessage = <TMessage>(webSocket: WebSocket): Promise<TMessage> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for websocket message")), 3000);
    webSocket.once("message", (data) => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(data.toString("utf8")) as TMessage);
      } catch (error) {
        reject(error);
      }
    });
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
