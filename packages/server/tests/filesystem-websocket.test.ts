import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

  it("uploads files and publishes a mutation snapshot", async () => {
    const root = await createRoot();
    const { url } = await startFilesystemServer(root);
    const client = await connect(`${url}/filesystem`);

    await client.next("hello");
    await client.next("snapshot");

    client.socket.send(JSON.stringify({
      type: "upload",
      requestId: "upload-1",
      files: [
        {
          type: "directory",
          relativePath: "notes",
        },
        {
          type: "file",
          relativePath: "notes/today.txt",
          contentBase64: Buffer.from("hello upload").toString("base64"),
        },
      ],
    }));

    expect(await client.next("ack")).toMatchObject({
      type: "ack",
      requestId: "upload-1",
      action: "upload",
    });
    expect(await client.next("snapshot")).toMatchObject({
      type: "snapshot",
      reason: "mutation",
      listing: { entries: [{ name: "notes", path: "notes", type: "directory" }] },
    });
    expect(await readFile(join(root, "notes", "today.txt"), "utf8")).toBe("hello upload");
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

  it("restores remembered directory and open files across reconnects", async () => {
    const root = await createRoot();
    await mkdir(join(root, "current"), { recursive: true });
    await mkdir(join(root, "open"), { recursive: true });
    await writeFile(join(root, "open", "report.txt"), "hello");
    const { url } = await startFilesystemServer(root);
    const firstClient = await connect(`${url}/filesystem`);

    await firstClient.next("hello");
    await firstClient.next("snapshot");

    firstClient.socket.send(JSON.stringify({ type: "subscribe", requestId: "subscribe-current", path: "current" }));
    expect(await firstClient.next("snapshot")).toMatchObject({
      type: "snapshot",
      listing: { path: "current" },
    });

    firstClient.socket.send(JSON.stringify({
      type: "setOpenFiles",
      requestId: "set-open-files",
      paths: ["open/report.txt"],
    }));
    expect(await firstClient.next("ack")).toMatchObject({
      type: "ack",
      requestId: "set-open-files",
      action: "setOpenFiles",
      result: { paths: ["open/report.txt"] },
    });
    firstClient.socket.close();

    const secondClient = await connect(`${url}/filesystem`);
    expect(await secondClient.next("hello")).toMatchObject({
      type: "hello",
      viewState: {
        currentPath: "current",
        openFiles: [{ path: "open/report.txt", type: "file", size: 5 }],
      },
    });
    expect(await secondClient.next("snapshot")).toMatchObject({
      type: "snapshot",
      reason: "subscribe",
      listing: { path: "current" },
    });
  });

  it("does not restore missing open files", async () => {
    const root = await createRoot();
    await mkdir(join(root, "open"), { recursive: true });
    await writeFile(join(root, "open", "keep.txt"), "keep");
    const { url } = await startFilesystemServer(root);
    const firstClient = await connect(`${url}/filesystem`);

    await firstClient.next("hello");
    await firstClient.next("snapshot");

    firstClient.socket.send(JSON.stringify({
      type: "setOpenFiles",
      requestId: "set-open-files",
      paths: ["open/keep.txt", "open/missing.txt"],
    }));
    await firstClient.next("ack");
    firstClient.socket.close();

    const secondClient = await connect(`${url}/filesystem`);
    expect(await secondClient.next("hello")).toMatchObject({
      type: "hello",
      viewState: {
        openFiles: [{ path: "open/keep.txt", type: "file", size: 4 }],
      },
    });
  });

  it("clears remembered open files", async () => {
    const root = await createRoot();
    await mkdir(join(root, "open"), { recursive: true });
    await writeFile(join(root, "open", "keep.txt"), "keep");
    const { url } = await startFilesystemServer(root);
    const firstClient = await connect(`${url}/filesystem`);

    await firstClient.next("hello");
    await firstClient.next("snapshot");

    firstClient.socket.send(JSON.stringify({
      type: "setOpenFiles",
      requestId: "set-open-files",
      paths: ["open/keep.txt"],
    }));
    await firstClient.next("ack");

    firstClient.socket.send(JSON.stringify({
      type: "setOpenFiles",
      requestId: "clear-open-files",
      paths: [],
    }));
    expect(await firstClient.next("ack")).toMatchObject({
      type: "ack",
      requestId: "clear-open-files",
      action: "setOpenFiles",
      result: { paths: [] },
    });
    firstClient.socket.close();

    const secondClient = await connect(`${url}/filesystem`);
    expect(await secondClient.next("hello")).toMatchObject({
      type: "hello",
      viewState: {
        openFiles: [],
      },
    });
  });

  it("falls back to root when remembered directory no longer exists", async () => {
    const root = await createRoot();
    await mkdir(join(root, "gone"), { recursive: true });
    const { url } = await startFilesystemServer(root);
    const firstClient = await connect(`${url}/filesystem`);

    await firstClient.next("hello");
    await firstClient.next("snapshot");

    firstClient.socket.send(JSON.stringify({ type: "subscribe", requestId: "subscribe-gone", path: "gone" }));
    await firstClient.next("snapshot");
    firstClient.socket.close();
    await removeEntriesForTest(join(root, "gone"));

    const secondClient = await connect(`${url}/filesystem`);
    expect(await secondClient.next("hello")).toMatchObject({
      type: "hello",
      viewState: {
        currentPath: "gone",
      },
    });
    expect(await secondClient.next("snapshot")).toMatchObject({
      type: "snapshot",
      reason: "subscribe",
      listing: { path: "" },
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
  readonly none: <TType extends FilesystemServerMessage["type"]>(type: TType) => Promise<void>;
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
    none: async (type) => {
      const existingIndex = messages.findIndex((message) => message.type === type);

      if (existingIndex >= 0) {
        throw new Error(`Received unexpected ${type}`);
      }

      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const waiter = (message: FilesystemServerMessage): boolean => {
          if (message.type !== type) {
            return false;
          }

          clearTimeout(timer);
          const waiterIndex = waiters.indexOf(waiter);

          if (waiterIndex >= 0) {
            waiters.splice(waiterIndex, 1);
          }

          reject(new Error(`Received unexpected ${type}`));
          return true;
        };

        timer = setTimeout(() => {
          const waiterIndex = waiters.indexOf(waiter);

          if (waiterIndex >= 0) {
            waiters.splice(waiterIndex, 1);
          }

          resolve();
        }, 150);
        waiters.push(waiter);
      });
    },
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
