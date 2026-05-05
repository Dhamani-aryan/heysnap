import { createServer, type Server } from "node:http";

import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { MockAgentHarness } from "../src/agent/mock-harness.js";
import { attachAgentWebSocketServer } from "../src/agent/websocket.js";
import type { AgentServerMessage } from "../src/agent/types.js";

let openServers: Server[] = [];
let openSockets: WebSocket[] = [];

afterEach(async () => {
  await Promise.all(openSockets.map((socket) => closeSocket(socket)));
  openSockets = [];
  await Promise.all(openServers.map((server) => closeServer(server)));
  openServers = [];
});

describe("agent websocket", () => {
  it("connects, retrieves threads, sends messages, and returns stored threads", async () => {
    const { url } = await startAgentServer();
    const client = await connect(`${url}/agent`);
    const { socket } = client;

    expect(await client.next("hello")).toMatchObject({ type: "hello" });

    socket.send(JSON.stringify({ type: "retrieveThreads", requestId: "threads-1" }));
    expect(await client.next("threads")).toMatchObject({
      type: "threads",
      requestId: "threads-1",
      groups: [],
    });

    socket.send(JSON.stringify({
      type: "sendMessage",
      requestId: "send-1",
      path: "Projects/app",
      content: [{ type: "text", content: "Build the UI" }],
    }));

    const runStart = await client.next("run_start");
    expect(runStart).toMatchObject({ type: "run_start", requestId: "send-1" });

    const events = await client.collectUntil("run_end");
    expect(events.map((message) => message.type)).toContain("event");
    expect(events.filter((message) => message.type === "event").map((message) => message.event.type)).toEqual([
      "agent_start",
      "turn_start",
      "thread_created",
      "message_start",
      "message_end",
      "message_start",
      "message_update",
      "message_end",
      "thread_updated",
      "turn_end",
      "agent_end",
    ]);

    socket.send(JSON.stringify({ type: "getThread", requestId: "thread-1", threadId: runStart.threadId }));
    expect(await client.next("thread")).toMatchObject({
      type: "thread",
      requestId: "thread-1",
      thread: {
        id: runStart.threadId,
        startPath: "Projects/app",
        lastPath: "Projects/app",
        messageCount: 2,
      },
    });

    socket.send(JSON.stringify({
      type: "sendMessage",
      requestId: "send-2",
      threadId: runStart.threadId,
      path: "Projects/app/src",
      content: [{ type: "text", content: "Continue from here" }],
    }));

    await client.next("run_start");
    await client.collectUntil("run_end");

    socket.send(JSON.stringify({ type: "getThread", requestId: "thread-2", threadId: runStart.threadId }));
    expect(await client.next("thread")).toMatchObject({
      type: "thread",
      requestId: "thread-2",
      thread: {
        id: runStart.threadId,
        startPath: "Projects/app",
        lastPath: "Projects/app/src",
        messageCount: 4,
      },
    });
  });

  it("returns structured errors for invalid messages and missing threads", async () => {
    const { url } = await startAgentServer();
    const client = await connect(`${url}/agent`);
    const { socket } = client;

    await client.next("hello");

    socket.send(JSON.stringify({
      type: "sendMessage",
      requestId: "bad-1",
      path: "",
      content: "hello",
    }));
    expect(await client.next("error")).toMatchObject({
      type: "error",
      code: "INVALID_MESSAGE",
    });

    socket.send(JSON.stringify({ type: "getThread", requestId: "missing-1", threadId: "missing" }));
    expect(await client.next("error")).toMatchObject({
      type: "error",
      requestId: "missing-1",
      code: "THREAD_NOT_FOUND",
    });
  });
});

const startAgentServer = async (): Promise<{ readonly server: Server; readonly url: string }> => {
  const server = createServer();
  openServers.push(server);

  attachAgentWebSocketServer(server, {
    harness: new MockAgentHarness(),
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
  readonly next: <TType extends AgentServerMessage["type"]>(
    type: TType,
  ) => Promise<Extract<AgentServerMessage, { readonly type: TType }>>;
  readonly collectUntil: <TType extends AgentServerMessage["type"]>(
    type: TType,
  ) => Promise<AgentServerMessage[]>;
}

const connect = async (url: string): Promise<WebSocketClient> => {
  const socket = new WebSocket(url);
  const messages: AgentServerMessage[] = [];
  const waiters: Array<(message: AgentServerMessage) => boolean> = [];

  socket.on("message", (data) => {
    const message = JSON.parse(Buffer.from(data).toString("utf8")) as AgentServerMessage;
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
    next: async (type) => waitForMessage(messages, waiters, type),
    collectUntil: async (type) => {
      const collected: AgentServerMessage[] = [];

      for (;;) {
        const message = await waitForAnyMessage(messages, waiters);
        collected.push(message);

        if (message.type === type) {
          return collected;
        }
      }
    },
  };
};

const waitForMessage = async <TType extends AgentServerMessage["type"]>(
  messages: AgentServerMessage[],
  waiters: Array<(message: AgentServerMessage) => boolean>,
  type: TType,
): Promise<Extract<AgentServerMessage, { readonly type: TType }>> => {
  const existingIndex = messages.findIndex((message) => message.type === type);

  if (existingIndex >= 0) {
    return messages.splice(existingIndex, 1)[0] as Extract<AgentServerMessage, { readonly type: TType }>;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const waiterIndex = waiters.indexOf(waiter);

      if (waiterIndex >= 0) {
        waiters.splice(waiterIndex, 1);
      }

      reject(new Error(`Timed out waiting for ${type}`));
    }, 5000);
    const waiter = (message: AgentServerMessage): boolean => {
      if (message.type !== type) {
        return false;
      }

      clearTimeout(timer);
      resolve(message as Extract<AgentServerMessage, { readonly type: TType }>);
      return true;
    };

    waiters.push(waiter);
  });
};

const waitForAnyMessage = async (
  messages: AgentServerMessage[],
  waiters: Array<(message: AgentServerMessage) => boolean>,
): Promise<AgentServerMessage> => {
  if (messages.length > 0) {
    return messages.splice(0, 1)[0] as AgentServerMessage;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const waiterIndex = waiters.indexOf(waiter);

      if (waiterIndex >= 0) {
        waiters.splice(waiterIndex, 1);
      }

      reject(new Error("Timed out waiting for any agent message"));
    }, 5000);
    const waiter = (message: AgentServerMessage): boolean => {
      clearTimeout(timer);
      resolve(message);
      return true;
    };

    waiters.push(waiter);
  });
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
