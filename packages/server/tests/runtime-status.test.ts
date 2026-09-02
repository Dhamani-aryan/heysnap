import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { startServer, type RunningServer } from "../src/runtime.js";

const openServers: RunningServer[] = [];
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.stop()));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("machine server runtime status", () => {
  it("reports idle status when no websocket sessions are open", async () => {
    const server = await startTestServer();

    const response = await fetch(server.urls.healthUrl.replace("/health", "/status"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      version: "development",
      lastActivityAt: expect.any(String),
      activeSessions: {
        filesystem: 0,
        agent: 0,
        total: 0,
      },
      safeToRestart: true,
      safeToSleep: true,
    });
    expect(server.getStatus().safeToRestart).toBe(true);
    expect(server.getStatus().safeToSleep).toBe(true);
  });

  it("marks the server unsafe to restart while websocket sessions are active", async () => {
    const server = await startTestServer();
    const socket = await openWebSocket(server.urls.filesystemWebSocketUrl);

    try {
      expect(server.getStatus()).toMatchObject({
        activeSessions: {
          filesystem: 1,
          total: 1,
        },
        safeToRestart: false,
        safeToSleep: true,
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

const startTestServer = async (): Promise<RunningServer> => {
  const filesystemRoot = await mkdtemp(join(tmpdir(), "ank1015-runtime-status-"));
  tempRoots.push(filesystemRoot);
  const server = await startServer({ port: 0, filesystemRoot });
  openServers.push(server);
  return server;
};
