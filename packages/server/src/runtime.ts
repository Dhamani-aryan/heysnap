import { createServer, type Server } from "node:http";
import { basename, resolve } from "node:path";

import { CodexAgentHarness } from "./agent/harnesses/codex/codex-agent-harness.js";
import { ensureCodexUserConfig } from "./agent/harnesses/codex/config.js";
import { createAgentHttpService } from "./agent/http.js";
import {
  attachBrowserControlWebSocketServer,
  createBrowserControlService,
} from "./browser-control/service.js";
import { createCapabilitiesHttpService } from "./capabilities/http.js";
import { AgentCapabilitiesService } from "./capabilities/service.js";
import { attachFilesystemWebSocketServer } from "./filesystem/websocket.js";
import {
  filesystemDownloadCorsHeaders,
  handleFilesystemDownloadRequest,
  sendFilesystemDownloadError,
} from "./filesystem/download.js";
import {
  handleFilesystemPreviewRequest,
  sendFilesystemPreviewError,
  type FilesystemPreviewOptions,
} from "./filesystem/preview.js";
import {
  filesystemXlsxCorsHeaders,
  handleFilesystemXlsxRequest,
  sendFilesystemXlsxError,
  type FilesystemXlsxOptions,
} from "./filesystem/xlsx.js";
import { resolveFilesystemRoot } from "./filesystem/paths.js";
import type { FilesystemRoot } from "./filesystem/types.js";

export interface StartServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly filesystemRoot?: string | FilesystemRoot;
  readonly codexBin?: string;
  readonly version?: string;
  readonly filesystemPreview?: FilesystemPreviewOptions;
  readonly filesystemXlsx?: FilesystemXlsxOptions;
}

export interface LocalServerUrls {
  readonly healthUrl: string;
  readonly filesystemWebSocketUrl: string;
  readonly agentBaseUrl: string;
  readonly capabilitiesBaseUrl: string;
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
    readonly browserControl: number;
    readonly agent: number;
    readonly total: number;
  };
  readonly safeToRestart: boolean;
}

export const startServer = async (options: StartServerOptions = {}): Promise<RunningServer> => {
  const filesystemRoot = normalizeFilesystemRoot(options.filesystemRoot);
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 4000;
  const version = options.version?.trim() || process.env.MACHINE_SERVER_VERSION?.trim() || "development";
  await ensureCodexUserConfig();
  const capabilities = new AgentCapabilitiesService();
  await capabilities.initialize();
  const agentHarness = new CodexAgentHarness({
    filesystemRoot: filesystemRoot.absolutePath,
    codexBin: options.codexBin ?? process.env.CODEX_BIN ?? capabilities.getCodexBin(),
  });
  const agentHttpService = createAgentHttpService({ harness: agentHarness });
  const capabilitiesHttpService = createCapabilitiesHttpService({ service: capabilities });
  const browserControlService = createBrowserControlService({
    filesystemRootPath: filesystemRoot.absolutePath,
  });
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");

    if (requestUrl.pathname.startsWith("/browser-control")) {
      void browserControlService.handleRequest(request, response);
      return;
    }

    if (requestUrl.pathname.startsWith("/capabilities")) {
      void capabilitiesHttpService.handleRequest(request, response);
      return;
    }

    if (requestUrl.pathname.startsWith("/agent")) {
      void agentHttpService.handleRequest(request, response);
      return;
    }

    if (requestUrl.pathname === "/filesystem/download") {
      if (request.method === "OPTIONS") {
        response.writeHead(204, filesystemDownloadCorsHeaders);
        response.end();
        return;
      }

      void handleFilesystemDownloadRequest(request, response, filesystemRoot).catch((error) => {
        sendFilesystemDownloadError(response, error);
      });
      return;
    }

    if (requestUrl.pathname === "/filesystem/preview") {
      if (request.method === "OPTIONS") {
        response.writeHead(204, filesystemDownloadCorsHeaders);
        response.end();
        return;
      }

      void handleFilesystemPreviewRequest(request, response, filesystemRoot, options.filesystemPreview).catch((error) => {
        sendFilesystemPreviewError(response, error);
      });
      return;
    }

    if (requestUrl.pathname === "/filesystem/xlsx" || requestUrl.pathname.startsWith("/filesystem/xlsx-assets/")) {
      if (request.method === "OPTIONS") {
        response.writeHead(204, filesystemXlsxCorsHeaders);
        response.end();
        return;
      }

      void handleFilesystemXlsxRequest(request, response, filesystemRoot, options.filesystemXlsx).catch((error) => {
        sendFilesystemXlsxError(response, error);
      });
      return;
    }

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
  attachBrowserControlWebSocketServer(server, browserControlService);

  await listen(server, requestedPort, host);

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : requestedPort;
  const localBaseUrl = `http://127.0.0.1:${String(port)}`;
  const localWebSocketBaseUrl = `ws://127.0.0.1:${String(port)}`;
  const getStatus = (): MachineServerStatus => {
    const filesystem = filesystemSocketServer.clients.size;
    const browserControl = browserControlService.socketServer.clients.size;
    const agent = agentHttpService.runManager.getActiveRunCount();
    const total = filesystem + browserControl + agent;

    return {
      ok: true,
      version,
      activeSessions: {
        filesystem,
        browserControl,
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
      agentBaseUrl: `${localBaseUrl}/agent`,
      capabilitiesBaseUrl: `${localBaseUrl}/capabilities`,
    },
    getStatus,
    async stop() {
      await Promise.all([
        closeWebSocketServer(filesystemSocketServer),
        closeWebSocketServer(browserControlService.socketServer),
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
