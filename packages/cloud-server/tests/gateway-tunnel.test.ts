import { createServer, type Server } from "node:http";

import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import type { CloudServerConfig } from "../src/config.js";
import { hashToken } from "../src/auth/tokens.js";
import { GatewayAccessService } from "../src/gateway/access-sessions.js";
import { attachGatewayTunnelServer, normalizeWebSocketCloseCode } from "../src/gateway/tunnel.js";
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
  machineServerImage: "example.com/ank1015-machine-server:test",
  machineServerVersion: "test-version",
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
    }));

    await expect(waitForJsonMessage(gateway)).resolves.toMatchObject({ type: "hello" });
    gateway.send(JSON.stringify({ type: "ping", requestId: "ping-1" }));

    const dataMessage = await waitForJsonMessage<CloudDataMessage>(machine);
    expect(dataMessage.type).toBe("data");
    expect(JSON.parse(Buffer.from(dataMessage.data, "base64").toString("utf8"))).toEqual({
      type: "ping",
      requestId: "ping-1",
    });

    gateway.close();
    machine.close();
    await closeServer(server);
  });

  it("routes agent websocket data through the same machine tunnel", async () => {
    const { server, baseUrl, computer, access, machine } = await startConnectedTunnel();
    const machineOpen = waitForJsonMessage<CloudOpenMessage>(machine);
    const gateway = await openWebSocket(
      `${baseUrl}/gateway/computers/${computer.id}/agent?accessToken=${access.token}`,
    );
    const openMessage = await machineOpen;

    expect(openMessage).toMatchObject({
      type: "open",
      route: "agent",
      path: "/agent",
    });

    machine.send(JSON.stringify({ type: "openResult", connectionId: openMessage.connectionId, ok: true }));
    machine.send(JSON.stringify({
      type: "data",
      connectionId: openMessage.connectionId,
      data: Buffer.from(JSON.stringify({ type: "hello", serverTime: "now" }), "utf8").toString("base64"),
    }));

    await expect(waitForJsonMessage(gateway)).resolves.toMatchObject({ type: "hello" });
    gateway.send(JSON.stringify({ type: "ping", requestId: "agent-ping-1" }));

    const dataMessage = await waitForJsonMessage<CloudDataMessage>(machine);
    expect(JSON.parse(Buffer.from(dataMessage.data, "base64").toString("utf8"))).toEqual({
      type: "ping",
      requestId: "agent-ping-1",
    });

    gateway.close();
    machine.close();
    await closeServer(server);
  });

  it("rejects gateway connections without a valid access token", async () => {
    const { server, baseUrl, store } = await startTunnelServer();
    const user = await store.createUser({ email: "user@example.com", passwordHash: "hash" });
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
}

const startTunnelServer = async (): Promise<{
  readonly server: Server;
  readonly baseUrl: string;
  readonly store: InMemoryCloudStore;
}> => {
  const store = new InMemoryCloudStore();
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const gatewayAccessService = new GatewayAccessService(store, config);
  attachGatewayTunnelServer(server, { store, config, gatewayAccessService });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return { server, baseUrl: `ws://127.0.0.1:${String(address.port)}`, store };
};

const startConnectedTunnel = async (): Promise<{
  readonly server: Server;
  readonly baseUrl: string;
  readonly store: InMemoryCloudStore;
  readonly computer: { readonly id: string };
  readonly access: { readonly token: string };
  readonly machine: WebSocket;
}> => {
  const { server, baseUrl, store } = await startTunnelServer();
  const user = await store.createUser({ email: "user@example.com", passwordHash: "hash" });
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

  return { server, baseUrl, store, computer, access, machine };
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
