import { createServer, type Server } from "node:http";
import { basename, resolve } from "node:path";

import {
  bindPreviewWebSocketServer,
  createPreviewService,
  type PreviewServiceOptions,
} from "@ank1015-app/previewer";
import { WebSocketServer } from "ws";

import { CodexAgentHarness } from "./agent/harnesses/codex/codex-agent-harness.js";
import { ensureCodexUserConfig } from "./agent/harnesses/codex/config.js";
import { HeysnapAgentHarness } from "./agent/harnesses/heysnap/heysnap-agent-harness.js";
import { PiAgentHarness } from "./agent/harnesses/pi/pi-agent-harness.js";
import { ensurePiUserConfig } from "./agent/harnesses/pi/config.js";
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
import { handleFilesystemUploadRequest } from "./filesystem/upload.js";
import { createFeedbackHttpService } from "./feedback/http.js";
import { resolveFilesystemRoot } from "./filesystem/paths.js";
import type { FilesystemRoot } from "./filesystem/types.js";
import { attachWebSocketUpgradeRoute } from "./websocket/upgrade-router.js";

export interface FilesystemPreviewerOptions extends Omit<
  PreviewServiceOptions,
  "allowAbsolutePaths" | "basePath" | "resolvePath" | "rootPath"
> {
  readonly basePath?: string;
}

export interface StartServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly filesystemRoot?: string | FilesystemRoot;
  readonly codexBin?: string;
  readonly version?: string;
  readonly filesystemPreviewer?: FilesystemPreviewerOptions;
}

export interface LocalServerUrls {
  readonly healthUrl: string;
  readonly filesystemWebSocketUrl: string;
  readonly filesystemPreviewBaseUrl: string;
  readonly filesystemPreviewWebSocketUrl: string;
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
  readonly lastActivityAt: string;
  readonly activeSessions: {
    readonly filesystem: number;
    readonly filesystemPreview: number;
    readonly browserControl: number;
    readonly agent: number;
    readonly total: number;
  };
  readonly safeToRestart: boolean;
  readonly safeToSleep: boolean;
}

export const startServer = async (options: StartServerOptions = {}): Promise<RunningServer> => {
  const filesystemRoot = normalizeFilesystemRoot(options.filesystemRoot);
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 4000;
  const version = options.version?.trim() || process.env.MACHINE_SERVER_VERSION?.trim() || "development";
  let lastActivityAt = new Date();
  const markActivity = (): void => {
    lastActivityAt = new Date();
  };
  await Promise.all([
    ensureCodexUserConfig(),
    ensurePiUserConfig(),
  ]);
  const capabilities = new AgentCapabilitiesService();
  await capabilities.initialize();
  const agentHarness = new HeysnapAgentHarness({
    codex: new CodexAgentHarness({
      filesystemRoot: filesystemRoot.absolutePath,
      codexBin: options.codexBin,
    }),
    pi: new PiAgentHarness({
      filesystemRoot: filesystemRoot.absolutePath,
    }),
  });
  const agentHttpService = createAgentHttpService({ harness: agentHarness, onActivity: markActivity });
  const capabilitiesHttpService = createCapabilitiesHttpService({ service: capabilities });
  const feedbackHttpService = createFeedbackHttpService({ version });
  const browserControlService = createBrowserControlService({
    filesystemRootPath: filesystemRoot.absolutePath,
    onActivity: markActivity,
  });
  const filesystemPreviewService = createPreviewService({
    ...options.filesystemPreviewer,
    basePath: options.filesystemPreviewer?.basePath ?? "/preview",
    rootPath: filesystemRoot.absolutePath,
    allowAbsolutePaths: false,
  });
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const isStatusRequest = requestUrl.pathname === "/health" || requestUrl.pathname === "/status";

    if (!isStatusRequest) {
      markActivity();
    }

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

    if (requestUrl.pathname.startsWith("/feedback")) {
      void feedbackHttpService.handleRequest(request, response)
        .then((handled) => {
          if (handled) {
            return;
          }

          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
        });
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

    if (requestUrl.pathname.startsWith("/filesystem/uploads")) {
      void handleFilesystemUploadRequest(request, response, filesystemRoot).catch((error) => {
        if (response.headersSent) {
          response.destroy(error instanceof Error ? error : undefined);
          return;
        }

        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({
          code: "UPLOAD_FAILED",
          message: error instanceof Error ? error.message : "Filesystem upload failed",
        }));
      });
      return;
    }

    if (isPathUnderBasePath(requestUrl.pathname, filesystemPreviewService.basePath)) {
      void filesystemPreviewService.handleRequest(request, response)
        .then((handled) => {
          if (handled) {
            return;
          }

          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
        })
        .catch((error) => {
          if (response.headersSent) {
            response.destroy(error instanceof Error ? error : undefined);
            return;
          }

          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({
            error: error instanceof Error ? error.message : "Preview request failed",
          }));
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
    onActivity: markActivity,
  });
  attachBrowserControlWebSocketServer(server, browserControlService);
  const filesystemPreviewSocketServer = new WebSocketServer({ noServer: true });
  filesystemPreviewSocketServer.on("connection", (webSocket) => {
    markActivity();
    webSocket.on("message", markActivity);
  });
  bindPreviewWebSocketServer(filesystemPreviewSocketServer, filesystemPreviewService);
  attachWebSocketUpgradeRoute(server, filesystemPreviewService.websocketPath, filesystemPreviewSocketServer);

  await listen(server, requestedPort, host);

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : requestedPort;
  const localBaseUrl = `http://127.0.0.1:${String(port)}`;
  const localWebSocketBaseUrl = `ws://127.0.0.1:${String(port)}`;
  const getStatus = (): MachineServerStatus => {
    const filesystem = filesystemSocketServer.clients.size;
    const filesystemPreview = filesystemPreviewSocketServer.clients.size;
    const browserControl = browserControlService.socketServer.clients.size;
    const agent = agentHttpService.runManager.getActiveRunCount();
    const total = filesystem + filesystemPreview + browserControl + agent;
    const safeToSleep = agent === 0 && browserControl === 0;

    return {
      ok: true,
      version,
      lastActivityAt: lastActivityAt.toISOString(),
      activeSessions: {
        filesystem,
        filesystemPreview,
        browserControl,
        agent,
        total,
      },
      safeToRestart: total === 0,
      safeToSleep,
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
      filesystemPreviewBaseUrl: `${localBaseUrl}${filesystemPreviewService.basePath}`,
      filesystemPreviewWebSocketUrl: `${localWebSocketBaseUrl}${filesystemPreviewService.websocketPath}`,
      agentBaseUrl: `${localBaseUrl}/agent`,
      capabilitiesBaseUrl: `${localBaseUrl}/capabilities`,
    },
    getStatus,
    async stop() {
      await Promise.all([
        closeWebSocketServer(filesystemSocketServer),
        closeWebSocketServer(filesystemPreviewSocketServer),
        closeWebSocketServer(browserControlService.socketServer),
      ]);
      await closeServer(server);
    },
  };
};

const isPathUnderBasePath = (pathname: string, basePath: string): boolean =>
  basePath === "/"
    ? true
    : pathname === basePath || pathname.startsWith(`${basePath}/`);

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
    server.closeIdleConnections();
  });
