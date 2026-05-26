import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeTunnelBinaryFrame,
  encodeTunnelBinaryFrame,
  parseTunnelControlMessage,
  stringifyTunnelControlMessage,
  type TunnelControlMessage,
} from "@ank1015-app/tunnel-protocol";

import { MachineTunnelClient, normalizeWebSocketCloseCode, toLocalHttpRequestHeaders } from "../src/tunnel/client.js";

const servers: Server[] = [];
const socketServers: WebSocketServer[] = [];
const clients: MachineTunnelClient[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => {
    client.stop();
  });
  socketServers.splice(0).forEach((server) => {
    server.close();
  });
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("machine tunnel client", () => {
  it("normalizes reserved websocket close codes before forwarding them", () => {
    expect(normalizeWebSocketCloseCode(undefined)).toBe(1000);
    expect(normalizeWebSocketCloseCode(1005)).toBe(1000);
    expect(normalizeWebSocketCloseCode(1006)).toBe(1000);
    expect(normalizeWebSocketCloseCode(1015)).toBe(1000);
    expect(normalizeWebSocketCloseCode(1011)).toBe(1011);
    expect(normalizeWebSocketCloseCode(4000)).toBe(4000);
  });

  it("strips content-length before proxying HTTP requests to the local machine server", () => {
    expect(toLocalHttpRequestHeaders({
      "content-type": "application/json",
      "content-length": "999",
    })).toEqual({ "content-type": "application/json" });
  });

  it("proxies cloud HTTP requests with bodies to the local machine server", async () => {
    const localServer = await startServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on("end", () => {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({
          code: "INVALID_UPLOAD",
          method: request.method,
          path: request.url,
          body: Buffer.concat(chunks).toString("utf8"),
          contentLength: request.headers["content-length"],
          contentType: request.headers["content-type"],
        }));
      });
    });
    const cloudServer = await startServer();
    const cloudSocketServer = new WebSocketServer({ server: cloudServer, path: "/machines/tunnel" });
    socketServers.push(cloudSocketServer);
    const responsePromise = waitForTunnelHttpResponse(cloudSocketServer, (socket) => {
      const connectionId = "11111111-2222-4333-8444-555555555555";
      socket.send(stringifyTunnelControlMessage({
        type: "httpRequestStart",
        connectionId,
        path: "/filesystem/uploads",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "999",
        },
      }));
      socket.send(encodeTunnelBinaryFrame({
        type: "httpRequestBody",
        connectionId,
        payload: Buffer.from("{}", "utf8"),
      }));
      socket.send(stringifyTunnelControlMessage({ type: "httpRequestEnd", connectionId }));
    });
    const tokenFile = await writeTokenFile("machine-token");
    const client = new MachineTunnelClient({
      cloudServerPublicUrl: serverUrl(cloudServer),
      computerId: "computer-1",
      localPort: serverPort(localServer),
      tokenFile,
      reconnectMs: 60_000,
    });
    clients.push(client);
    client.start();

    const response = await responsePromise;
    const body = JSON.parse(response.body.toString("utf8")) as Record<string, unknown>;

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(body).toMatchObject({
      code: "INVALID_UPLOAD",
      method: "POST",
      path: "/filesystem/uploads",
      body: "{}",
      contentLength: "2",
      contentType: "application/json",
    });
  });

  it("returns structured 502 responses when local HTTP proxying fails", async () => {
    const unusedPort = await getUnusedPort();
    const cloudServer = await startServer();
    const cloudSocketServer = new WebSocketServer({ server: cloudServer, path: "/machines/tunnel" });
    socketServers.push(cloudSocketServer);
    const responsePromise = waitForTunnelHttpResponse(cloudSocketServer, (socket) => {
      const connectionId = "22222222-2222-4333-8444-555555555555";
      socket.send(stringifyTunnelControlMessage({
        type: "httpRequestStart",
        connectionId,
        path: "/filesystem/uploads",
        method: "POST",
        headers: { "content-type": "application/json" },
      }));
      socket.send(encodeTunnelBinaryFrame({
        type: "httpRequestBody",
        connectionId,
        payload: Buffer.from("{}", "utf8"),
      }));
      socket.send(stringifyTunnelControlMessage({ type: "httpRequestEnd", connectionId }));
    });
    const tokenFile = await writeTokenFile("machine-token");
    const client = new MachineTunnelClient({
      cloudServerPublicUrl: serverUrl(cloudServer),
      computerId: "computer-1",
      localPort: unusedPort,
      tokenFile,
      reconnectMs: 60_000,
    });
    clients.push(client);
    client.start();

    const response = await responsePromise;
    const body = JSON.parse(response.body.toString("utf8")) as {
      readonly error?: { readonly code?: string; readonly message?: string };
    };

    expect(response.statusCode).toBe(502);
    expect(response.headers["content-type"]).toBe("application/json");
    expect(body.error?.code).toBe("MACHINE_HTTP_PROXY_FAILED");
    expect(body.error?.message).toContain("Machine HTTP proxy failed");
  });
});

interface TunnelHttpResponseMessage {
  readonly connectionId: string;
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

const startServer = (
  listener?: Parameters<typeof createServer>[0],
): Promise<Server> =>
  new Promise((resolve) => {
    const server = createServer(listener);
    server.listen(0, "127.0.0.1", () => {
      servers.push(server);
      resolve(server);
    });
  });

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const waitForTunnelHttpResponse = (
  socketServer: WebSocketServer,
  onConnection: (socket: WebSocket) => void,
): Promise<TunnelHttpResponseMessage> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for tunnel HTTP response"));
    }, 3000);
    socketServer.once("connection", (socket) => {
      const chunks: Buffer[] = [];
      let responseStart: Extract<TunnelControlMessage, { type: "httpResponseStart" }> | undefined;
      onConnection(socket);
      socket.on("message", (data, isBinary) => {
        try {
          if (isBinary) {
            const frame = decodeTunnelBinaryFrame(data);
            if (frame.type === "httpResponseBody") {
              chunks.push(frame.payload);
            }
            return;
          }

          const message = parseTunnelControlMessage(data.toString("utf8"));
          if (message?.type === "httpResponseStart") {
            responseStart = message;
            return;
          }

          if (message?.type === "httpResponseEnd" && responseStart !== undefined) {
            clearTimeout(timeout);
            resolve({
              connectionId: responseStart.connectionId,
              statusCode: responseStart.statusCode,
              headers: responseStart.headers,
              body: Buffer.concat(chunks),
            });
          }
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      });
      socket.once("error", reject);
    });
  });

const writeTokenFile = async (token: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "ank1015-tunnel-client-"));
  tempDirectories.push(directory);
  const tokenFile = join(directory, "machine-token");
  await writeFile(tokenFile, token);
  return tokenFile;
};

const getUnusedPort = async (): Promise<number> => {
  const server = await startServer();
  const port = serverPort(server);
  await closeServer(server);
  servers.splice(servers.indexOf(server), 1);
  return port;
};

const serverPort = (server: Server): number => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return address.port;
};

const serverUrl = (server: Server): string =>
  `http://127.0.0.1:${String(serverPort(server))}`;
