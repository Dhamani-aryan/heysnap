import { createServer, type Server } from "node:http";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCapabilitiesHttpService } from "../src/capabilities/http.js";
import { AgentCapabilitiesService } from "../src/capabilities/service.js";
import type { CapabilitiesCatalog, CapabilityOperationSnapshot, CapabilityPaths } from "../src/capabilities/types.js";

let openServers: Server[] = [];
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(openServers.map((server) => closeServer(server)));
  openServers = [];
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 25,
  })));
});

describe("capabilities REST API", () => {
  it("lists capabilities with refreshed connector status", async () => {
    const { url } = await startCapabilitiesServer(createCatalog({
      status: { command: "fake-tool", args: ["status"] },
    }));

    const response = await fetch(`${url}/capabilities`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      capabilities: {
        tools: [{ id: "fake", installState: "installed", connectionState: "disconnected" }],
        skills: [{ id: "fake-skill", active: false }],
      },
    });
  });

  it("starts install operations and exposes completed snapshots", async () => {
    const { url } = await startCapabilitiesServer();

    const started = await postJson(`${url}/capabilities/tools/fake/install`);

    expect(started.status).toBe(202);
    const body = await started.json() as { readonly operation: CapabilityOperationSnapshot };
    expect(body.operation).toMatchObject({
      operation: "installTool",
      targetId: "fake",
      status: "running",
    });

    const completed = await waitForOperation(url, body.operation.id, "completed");
    expect(completed.capabilities).toMatchObject({
      tools: [{ id: "fake", installState: "installed" }],
    });
  });

  it("connects non-interactive tools with a blocking response and refreshes/disconnects", async () => {
    const { url } = await startCapabilitiesServer(createCatalog({
      status: { command: "fake-tool", args: ["status"] },
      connect: { command: "fake-tool", args: ["login-auto"] },
      disconnect: { command: "fake-tool", args: ["logout"] },
    }));

    const connect = await postJson(`${url}/capabilities/tools/fake/connect`);
    expect(connect.status).toBe(200);
    await expect(connect.json()).resolves.toMatchObject({
      capabilities: {
        tools: [{ id: "fake", connectionState: "connected" }],
      },
    });

    const refresh = await postJson(`${url}/capabilities/tools/fake/refresh-status`);
    expect(refresh.status).toBe(200);
    await expect(refresh.json()).resolves.toMatchObject({
      capabilities: {
        tools: [{ id: "fake", connectionState: "connected" }],
      },
    });

    const disconnect = await postJson(`${url}/capabilities/tools/fake/disconnect`);
    expect(disconnect.status).toBe(200);
    await expect(disconnect.json()).resolves.toMatchObject({
      capabilities: {
        tools: [{ id: "fake", connectionState: "disconnected" }],
      },
    });
  });

  it("accepts input for interactive connect operations", async () => {
    const { url } = await startCapabilitiesServer(createCatalog({
      status: { command: "fake-tool", args: ["status"] },
      connect: { command: "fake-tool", args: ["login"], interactive: "tty" },
      disconnect: { command: "fake-tool", args: ["logout"] },
    }));

    const started = await postJson(`${url}/capabilities/tools/fake/connect`);

    expect(started.status).toBe(202);
    const body = await started.json() as { readonly operation: CapabilityOperationSnapshot };
    expect(body.operation).toMatchObject({
      operation: "connectTool",
      targetId: "fake",
      status: "waiting_for_input",
    });
    const waiting = await waitForOperationMessage(url, body.operation.id, "https://example.com/device");
    expect(waiting.status).toBe("waiting_for_input");

    const input = await postJson(`${url}/capabilities/operations/${body.operation.id}/input`, { input: "ok-code\n" });
    expect(input.status).toBe(200);

    const completed = await waitForOperation(url, body.operation.id, "completed");
    expect(completed.capabilities).toMatchObject({
      tools: [{ id: "fake", connectionState: "connected" }],
    });
  });

  it("auto-accepts the GitHub credential prompt and exposes the device code", async () => {
    const { url } = await startCapabilitiesServer(createCatalog({
      id: "github",
      status: { command: "fake-tool", args: ["status"] },
      connect: { command: "fake-tool", args: ["github-login"], interactive: "tty" },
      disconnect: { command: "fake-tool", args: ["logout"] },
    }));

    const started = await postJson(`${url}/capabilities/tools/github/connect`);

    expect(started.status).toBe(202);
    const body = await started.json() as { readonly operation: CapabilityOperationSnapshot };
    expect(body.operation).toMatchObject({
      operation: "connectTool",
      targetId: "github",
    });

    const operation = await waitForOperationMessage(url, body.operation.id, "First copy your one-time code: ABCD-1234");
    expect(operation.messages.join("\n")).toContain("Authenticate Git with your GitHub credentials?");
    await expect(waitForOperation(url, body.operation.id, "completed")).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("returns client-safe errors", async () => {
    const { url } = await startCapabilitiesServer();

    const missingTool = await postJson(`${url}/capabilities/tools/missing/install`);
    expect(missingTool.status).toBe(404);
    await expect(missingTool.json()).resolves.toMatchObject({
      error: { code: "TOOL_NOT_FOUND" },
    });

    const unsupported = await postJson(`${url}/capabilities/tools/fake/disconnect`);
    expect(unsupported.status).toBe(409);
    await expect(unsupported.json()).resolves.toMatchObject({
      error: { code: "TOOL_DISCONNECT_UNSUPPORTED" },
    });

    const badInput = await postJson(`${url}/capabilities/operations/missing/input`, { input: "" });
    expect(badInput.status).toBe(400);

    const missingOperation = await fetch(`${url}/capabilities/operations/missing`);
    expect(missingOperation.status).toBe(404);
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
if [ "$1" = "login-auto" ]; then
  : > "$HOME/fake-connected"
  exit 0
fi
if [ "$1" = "github-login" ]; then
  printf 'Authenticate Git with your GitHub credentials? (Y/n) '
  read -r answer
  if [ "$answer" = "" ] || [ "$answer" = "Y" ] || [ "$answer" = "y" ]; then
    echo "First copy your one-time code: ABCD-1234"
    printf 'Press Enter to open github.com in your browser...'
    read -r open_browser
    exit 0
  fi
  echo "cancelled" >&2
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
          disconnect: tool.disconnect === undefined ? undefined : { ...tool.disconnect, command: toolBin },
          status: tool.status === undefined ? undefined : { ...tool.status, command: toolBin },
        }
      : tool),
  };
  const service = new AgentCapabilitiesService({
    catalog: resolvedCatalog,
    paths,
    env: { PATH: join(root, "bin"), HOME: root },
  });
  await service.initialize();
  const capabilitiesHttpService = createCapabilitiesHttpService({ service });
  const server = createServer((request, response) => {
    void capabilitiesHttpService.handleRequest(request, response).then((handled) => {
      if (!handled) {
        response.writeHead(404);
        response.end();
      }
    });
  });
  openServers.push(server);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }

  return {
    server,
    url: `http://127.0.0.1:${String(address.port)}`,
  };
};

const postJson = (url: string, body?: unknown): Promise<Response> =>
  fetch(url, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });

const waitForOperation = async (
  url: string,
  operationId: string,
  status: CapabilityOperationSnapshot["status"],
): Promise<CapabilityOperationSnapshot> => {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const response = await fetch(`${url}/capabilities/operations/${operationId}`);
    const body = await response.json() as { readonly operation: CapabilityOperationSnapshot };

    if (body.operation.status === status) {
      return body.operation;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for operation ${operationId} to reach ${status}`);
};

const waitForOperationMessage = async (
  url: string,
  operationId: string,
  message: string,
): Promise<CapabilityOperationSnapshot> => {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const response = await fetch(`${url}/capabilities/operations/${operationId}`);
    const body = await response.json() as { readonly operation: CapabilityOperationSnapshot };

    if (body.operation.messages.join("\n").includes(message)) {
      return body.operation;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for operation ${operationId} message ${message}`);
};

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
  const root = await mkdtemp(join(tmpdir(), "ank1015-capabilities-http-"));
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
    sourcePath: join(process.cwd(), "tests", "fixtures", "fake-skill"),
  }],
});
