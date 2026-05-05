import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { startServer, type RunningServer } from "../src/runtime.js";

const openServers: RunningServer[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.stop()));
});

describe("machine server runtime status", () => {
  it("reports idle status when no websocket sessions are open", async () => {
    const server = await startServer({ port: 0 });
    openServers.push(server);

    const response = await fetch(server.urls.healthUrl.replace("/health", "/status"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      version: "development",
      activeSessions: {
        filesystem: 0,
        agent: 0,
        total: 0,
      },
      safeToRestart: true,
    });
    expect(server.getStatus().safeToRestart).toBe(true);
  });

  it("marks the server unsafe to restart while websocket sessions are active", async () => {
    const server = await startServer({ port: 0 });
    openServers.push(server);
    const socket = await openWebSocket(server.urls.filesystemWebSocketUrl);

    try {
      expect(server.getStatus()).toMatchObject({
        activeSessions: {
          filesystem: 1,
          total: 1,
        },
        safeToRestart: false,
      });
    } finally {
      socket.close();
    }
  });
});

const openWebSocket = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => {
      resolve(socket);
    });
    socket.once("error", reject);
  });
