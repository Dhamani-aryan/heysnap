import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { attachFilesystemWebSocketServer } from "../src/filesystem/websocket.js";
import { removeEntriesForTest } from "../src/filesystem/service.js";
import type { FilesystemServerMessage } from "../src/filesystem/types.js";

let openServers: Server[] = [];
let openSockets: WebSocket[] = [];

afterEach(async () => {
  await Promise.all(openSockets.map((socket) => closeSocket(socket)));
  openSockets = [];
  await Promise.all(openServers.map((server) => closeServer(server)));
  openServers = [];
});

describe("filesystem websocket", () => {
  it("connects, snapshots, creates, renames, and trashes", async () => {
    const root = await createRoot();
    const { url } = await startFilesystemServer(root);
    const client = await connect(`${url}/filesystem`);
    const { socket } = client;

    expect(await client.next("hello")).toMatchObject({ type: "hello" });
    expect(await client.next("snapshot")).toMatchObject({
      type: "snapshot",
      reason: "subscribe",
      listing: { path: "" },
    });

    socket.send(JSON.stringify({ type: "createFolder", requestId: "create-1" }));
    expect(await client.next("ack")).toMatchObject({
      type: "ack",
      requestId: "create-1",
      action: "createFolder",
    });
    expect(await client.next("snapshot")).toMatchObject({
      type: "snapshot",
      reason: "mutation",
      listing: { entries: [{ name: "untitled folder", path: "untitled folder" }] },
    });

    socket.send(JSON.stringify({
      type: "rename",
      requestId: "rename-1",
      path: "untitled folder",
      newName: "renamed",
    }));
    expect(await client.next("ack")).toMatchObject({
      type: "ack",
      requestId: "rename-1",
      action: "rename",
    });
    expect(await client.next("snapshot")).toMatchObject({
      type: "snapshot",
      reason: "mutation",
      listing: { entries: [{ name: "renamed", path: "renamed" }] },
    });

    socket.send(JSON.stringify({ type: "trash", requestId: "trash-1", paths: ["renamed"] }));
    expect(await client.next("ack")).toMatchObject({
      type: "ack",
      requestId: "trash-1",
      action: "trash",
    });
    expect(await client.next("snapshot")).toMatchObject({
      type: "snapshot",
      reason: "mutation",
      listing: { entries: [] },
    });
  });

  it("sends a watch snapshot when the active directory changes", async () => {
    const root = await createRoot();
    const { url } = await startFilesystemServer(root);
    const client = await connect(`${url}/filesystem`);

    await client.next("hello");
    await client.next("snapshot");

    await writeFile(join(root, "new-file.txt"), "hello");

    const snapshot = await client.next("snapshot");

    expect(snapshot).toMatchObject({
      type: "snapshot",
      reason: "watch",
      listing: { entries: [{ name: "new-file.txt", path: "new-file.txt" }] },
    });
  });

  it("responds to heartbeat pings", async () => {
    const root = await createRoot();
    const { url } = await startFilesystemServer(root);
    const client = await connect(`${url}/filesystem`);

    await client.next("hello");
    await client.next("snapshot");

    client.socket.send(JSON.stringify({ type: "ping", requestId: "heartbeat-1" }));

    expect(await client.next("pong")).toMatchObject({
      type: "pong",
      requestId: "heartbeat-1",
    });
  });
});

const createRoot = async (): Promise<string> => mkdtemp(join(tmpdir(), "ank1015-ws-"));

const startFilesystemServer = async (
  root: string,
): Promise<{ readonly server: Server; readonly url: string }> => {
  const server = createServer();
  openServers.push(server);

  attachFilesystemWebSocketServer(server, {
    root: { absolutePath: root, name: "root" },
    trashFunction: removeEntriesForTest,
    debounceMs: 20,
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }

  return {
    server,
    url: `ws://127.0.0.1:${String(address.port)}`,
  };
};

interface WebSocketClient {
  readonly socket: WebSocket;
  readonly next: <TType extends FilesystemServerMessage["type"]>(
    type: TType,
  ) => Promise<Extract<FilesystemServerMessage, { readonly type: TType }>>;
}

const connect = async (url: string): Promise<WebSocketClient> => {
  const socket = new WebSocket(url);
  const messages: FilesystemServerMessage[] = [];
  const waiters: Array<(message: FilesystemServerMessage) => boolean> = [];

  socket.on("message", (data) => {
    const message = JSON.parse(Buffer.from(data).toString("utf8")) as FilesystemServerMessage;
    const waiterIndex = waiters.findIndex((waiter) => waiter(message));

    if (waiterIndex >= 0) {
      waiters.splice(waiterIndex, 1);
      return;
    }

    messages.push(message);
  });

  openSockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  return {
    socket,
    next: async (type) => {
      const existingIndex = messages.findIndex((message) => message.type === type);

      if (existingIndex >= 0) {
        return messages.splice(existingIndex, 1)[0] as Extract<FilesystemServerMessage, { readonly type: typeof type }>;
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiterIndex = waiters.indexOf(waiter);

          if (waiterIndex >= 0) {
            waiters.splice(waiterIndex, 1);
          }

          reject(new Error(`Timed out waiting for ${type}`));
        }, 5000);
        const waiter = (message: FilesystemServerMessage): boolean => {
          if (message.type !== type) {
            return false;
          }

          clearTimeout(timer);
          resolve(message as Extract<FilesystemServerMessage, { readonly type: typeof type }>);
          return true;
        };

        waiters.push(waiter);
      });
    },
  };
};

const closeSocket = async (socket: WebSocket): Promise<void> => {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    socket.once("close", resolve);
    socket.close();
  });
};

const closeServer = async (server: Server): Promise<void> => {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
};
