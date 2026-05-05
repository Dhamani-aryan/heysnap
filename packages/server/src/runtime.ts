import { createServer, type Server } from "node:http";
import { basename, resolve } from "node:path";

import { attachAgentWebSocketServer } from "./agent/websocket.js";
import { CodexAgentHarness } from "./agent/harnesses/codex/codex-agent-harness.js";
import { attachFilesystemWebSocketServer } from "./filesystem/websocket.js";
import { resolveFilesystemRoot } from "./filesystem/paths.js";
import type { FilesystemRoot } from "./filesystem/types.js";

export interface StartServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly filesystemRoot?: string | FilesystemRoot;
  readonly codexBin?: string;
}

export interface LocalServerUrls {
  readonly healthUrl: string;
  readonly filesystemWebSocketUrl: string;
  readonly agentWebSocketUrl: string;
}

export interface RunningServer {
  readonly server: Server;
  readonly port: number;
  readonly host: string;
  readonly filesystemRoot: FilesystemRoot;
  readonly urls: LocalServerUrls;
  getStatus(): MachineServerStatus;
  stop(): Promise<void>;
}

export interface MachineServerStatus {
  readonly ok: true;
  readonly version: string;
  readonly activeSessions: {
    readonly filesystem: number;
    readonly agent: number;
    readonly total: number;
  };
  readonly safeToRestart: boolean;
}

export const startServer = async (options: StartServerOptions = {}): Promise<RunningServer> => {
  const filesystemRoot = normalizeFilesystemRoot(options.filesystemRoot);
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 4000;
  const version = process.env.MACHINE_SERVER_VERSION?.trim() || "development";
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.url === "/status") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(getStatus()));
      return;
    }

    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ank1015 server");
  });

  const filesystemSocketServer = attachFilesystemWebSocketServer(server, {
    root: filesystemRoot,
  });
  const agentSocketServer = attachAgentWebSocketServer(server, {
    harness: new CodexAgentHarness({
      filesystemRoot: filesystemRoot.absolutePath,
      codexBin: options.codexBin ?? process.env.CODEX_BIN,
    }),
  });

  await listen(server, requestedPort, host);

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : requestedPort;
  const localBaseUrl = `http://127.0.0.1:${String(port)}`;
  const localWebSocketBaseUrl = `ws://127.0.0.1:${String(port)}`;
  const getStatus = (): MachineServerStatus => {
    const filesystem = filesystemSocketServer.clients.size;
    const agent = agentSocketServer.clients.size;
    const total = filesystem + agent;

    return {
      ok: true,
      version,
      activeSessions: {
        filesystem,
        agent,
        total,
      },
      safeToRestart: total === 0,
    };
  };

  return {
    server,
    port,
    host,
    filesystemRoot,
    urls: {
      healthUrl: `${localBaseUrl}/health`,
      filesystemWebSocketUrl: `${localWebSocketBaseUrl}/filesystem`,
      agentWebSocketUrl: `${localWebSocketBaseUrl}/agent`,
    },
    getStatus,
    async stop() {
      await Promise.all([
        closeWebSocketServer(filesystemSocketServer),
        closeWebSocketServer(agentSocketServer),
      ]);
      await closeServer(server);
    },
  };
};

const normalizeFilesystemRoot = (root: string | FilesystemRoot | undefined): FilesystemRoot => {
  if (root === undefined) {
    return resolveFilesystemRoot();
  }

  if (typeof root !== "string") {
    return root;
  }

  const absolutePath = resolve(root);
  return {
    absolutePath,
    name: basename(absolutePath) || absolutePath,
  };
};

const listen = (server: Server, port: number, host: string): Promise<void> =>
  new Promise((resolveListen, rejectListen) => {
    const handleError = (error: Error) => {
      server.off("listening", handleListening);
      rejectListen(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolveListen();
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, host);
  });

const closeWebSocketServer = (socketServer: { close(callback?: (error?: Error) => void): void }): Promise<void> =>
  new Promise((resolveClose, rejectClose) => {
    socketServer.close((error) => {
      if (error !== undefined) {
        rejectClose(error);
        return;
      }

      resolveClose();
    });
  });

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error !== undefined) {
        rejectClose(error);
        return;
      }

      resolveClose();
    });
  });
