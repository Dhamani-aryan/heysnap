import { createServer, type Server } from "node:http";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { AgentCapabilitiesService } from "../src/capabilities/service.js";
import { attachCapabilitiesWebSocketServer } from "../src/capabilities/websocket.js";
import type { CapabilitiesCatalog, CapabilityPaths, CapabilityServerMessage } from "../src/capabilities/types.js";

let openServers: Server[] = [];
let openSockets: WebSocket[] = [];
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(openSockets.map((socket) => closeSocket(socket)));
  openSockets = [];
  await Promise.all(openServers.map((server) => closeServer(server)));
  openServers = [];
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("capabilities websocket", () => {
  it("lists capabilities and toggles skills", async () => {
    const { url } = await startCapabilitiesServer();
    const client = await connect(`${url}/capabilities`);
    const { socket } = client;

    expect(await client.next("hello")).toMatchObject({ type: "hello" });

    socket.send(JSON.stringify({ type: "listCapabilities", requestId: "list-1" }));
    expect(await client.next("capabilities")).toMatchObject({
      type: "capabilities",
      requestId: "list-1",
      capabilities: {
        tools: [{ id: "fake", installState: "installed" }],
        skills: [{ id: "fake-skill", active: false }],
      },
    });

    socket.send(JSON.stringify({ type: "setSkillActive", requestId: "skill-1", skillId: "fake-skill", active: true }));
    expect(await client.next("operationStarted")).toMatchObject({ type: "operationStarted", requestId: "skill-1" });
    expect(await client.next("operationCompleted")).toMatchObject({
      type: "operationCompleted",
      requestId: "skill-1",
      capabilities: {
        skills: [{ id: "fake-skill", active: true }],
      },
    });
  });

  it("rejects unknown tools", async () => {
    const { url } = await startCapabilitiesServer();
    const client = await connect(`${url}/capabilities`);
    const { socket } = client;

    await client.next("hello");
    socket.send(JSON.stringify({ type: "installTool", requestId: "bad-1", toolId: "missing" }));
    await client.next("operationStarted");
    expect(await client.next("operationFailed")).toMatchObject({
      type: "operationFailed",
      requestId: "bad-1",
      code: "TOOL_NOT_FOUND",
    });
  });

  it("sends input to interactive tool connections and disconnects tools", async () => {
    const { url } = await startCapabilitiesServer(createCatalog({
      status: { command: "fake-tool", args: ["status"] },
      connect: { command: "fake-tool", args: ["login"], interactive: "tty" },
      disconnect: { command: "fake-tool", args: ["logout"] },
    }));
    const client = await connect(`${url}/capabilities`);
    const { socket } = client;

    await client.next("hello");
    socket.send(JSON.stringify({ type: "connectTool", requestId: "connect-1", toolId: "fake" }));
    const started = await client.next("operationStarted");
    expect(started).toMatchObject({
      type: "operationStarted",
      requestId: "connect-1",
      operation: "connectTool",
      targetId: "fake",
    });
    socket.send(JSON.stringify({
      type: "sendToolInput",
      requestId: "input-1",
      operationId: started.operationId,
      input: "ok-code\n",
    }));
    expect(await client.next("operationCompleted")).toMatchObject({
      type: "operationCompleted",
      requestId: "connect-1",
      capabilities: {
        tools: [{ id: "fake", connectionState: "connected" }],
      },
    });

    socket.send(JSON.stringify({ type: "disconnectTool", requestId: "disconnect-1", toolId: "fake" }));
    await client.next("operationStarted");
    expect(await client.next("operationCompleted")).toMatchObject({
      type: "operationCompleted",
      requestId: "disconnect-1",
      capabilities: {
        tools: [{ id: "fake", connectionState: "disconnected" }],
      },
    });
  });
});

const startCapabilitiesServer = async (
  catalog: CapabilitiesCatalog = createCatalog(),
): Promise<{ readonly server: Server; readonly url: string }> => {
  const { root, paths } = await createTempPaths();
  const toolBin = join(root, "bin", "fake-tool");
  await mkdir(join(root, "bin"), { recursive: true });
  await writeFile(toolBin, `#!/bin/sh
if [ "$1" = "status" ]; then
  if [ -f "$HOME/fake-connected" ]; then
    exit 0
  fi
  echo "not logged in" >&2
  exit 1
fi
if [ "$1" = "login" ]; then
  echo "https://example.com/device"
  read -r code
  if [ "$code" = "ok-code" ]; then
    : > "$HOME/fake-connected"
    exit 0
  fi
  echo "bad code" >&2
  exit 1
fi
if [ "$1" = "logout" ]; then
  /bin/rm -f "$HOME/fake-connected"
  exit 0
fi
echo fake-tool 1.0
`);
  await chmod(toolBin, 0o755);
  const resolvedCatalog: CapabilitiesCatalog = {
    ...catalog,
    tools: catalog.tools.map((tool) => tool.command === "fake-tool"
      ? {
          ...tool,
          connect: tool.connect === undefined ? undefined : { ...tool.connect, command: toolBin },
        }
      : tool),
  };
  const service = new AgentCapabilitiesService({
    catalog: resolvedCatalog,
    paths,
    env: { PATH: join(root, "bin"), HOME: root },
  });
  await service.initialize();
  const server = createServer();
  openServers.push(server);

  attachCapabilitiesWebSocketServer(server, { service });

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
  readonly next: <TType extends CapabilityServerMessage["type"]>(
    type: TType,
  ) => Promise<Extract<CapabilityServerMessage, { readonly type: TType }>>;
}

const connect = async (url: string): Promise<WebSocketClient> => {
  const socket = new WebSocket(url);
  const messages: CapabilityServerMessage[] = [];
  const waiters: Array<(message: CapabilityServerMessage) => boolean> = [];

  socket.on("message", (data) => {
    const message = JSON.parse(Buffer.from(data).toString("utf8")) as CapabilityServerMessage;
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
  };
};

const waitForMessage = async <TType extends CapabilityServerMessage["type"]>(
  messages: CapabilityServerMessage[],
  waiters: Array<(message: CapabilityServerMessage) => boolean>,
  type: TType,
): Promise<Extract<CapabilityServerMessage, { readonly type: TType }>> => {
  const existingIndex = messages.findIndex((message) => message.type === type);

  if (existingIndex >= 0) {
    return messages.splice(existingIndex, 1)[0] as Extract<CapabilityServerMessage, { readonly type: TType }>;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const waiterIndex = waiters.indexOf(waiter);

      if (waiterIndex >= 0) {
        waiters.splice(waiterIndex, 1);
      }

      reject(new Error(`Timed out waiting for ${type}`));
    }, 5000);
    const waiter = (message: CapabilityServerMessage): boolean => {
      if (message.type !== type) {
        return false;
      }

      clearTimeout(timer);
      resolve(message as Extract<CapabilityServerMessage, { readonly type: TType }>);
      return true;
    };

    waiters.push(waiter);
  });
};

const closeSocket = (socket: WebSocket): Promise<void> =>
  new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }

    socket.once("close", () => resolve());
    socket.close();
  });

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const createTempPaths = async (): Promise<{ readonly root: string; readonly paths: CapabilityPaths }> => {
  const root = await mkdtemp(join(tmpdir(), "ank1015-capabilities-ws-"));
  tempRoots.push(root);
  return {
    root,
    paths: {
      stateFile: join(root, "state.json"),
      toolsRoot: join(root, "tools"),
      toolsBinDir: join(root, "tools", "bin"),
      skillsCatalogDir: join(root, "skills", "catalog"),
      activeSkillsDir: join(root, "active-skills"),
    },
  };
};

const createCatalog = (
  overrides: Partial<CapabilitiesCatalog["tools"][number]> = {},
): CapabilitiesCatalog => ({
  version: "test",
  codexToolId: "fake",
  tools: [{
    id: "fake",
    label: "Fake Tool",
    command: "fake-tool",
    desiredVersion: "1.0",
    installStrategy: { type: "existing" },
    versionCommand: { command: "fake-tool" },
    ...overrides,
  }],
  skills: [{
    id: "fake-skill",
    label: "Fake Skill",
    version: "1.0",
    description: "Fake skill",
    files: { "SKILL.md": "# Fake" },
  }],
});
