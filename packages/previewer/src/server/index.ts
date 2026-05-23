import { createServer, type Server } from "node:http";

import { WebSocketServer } from "ws";

import {
  bindPreviewWebSocketServer,
  createPreviewService,
  type PreviewServiceOptions,
} from "./service.js";

export {
  PreviewService,
  bindPreviewWebSocketServer,
  createPreviewService,
  type PreviewServiceOptions,
} from "./service.js";
export {
  createDefaultPreviewPathResolver,
  normalizeBasePath,
  stripBasePath,
  type PreviewPathResolver,
  type PreviewPathResolverOptions,
  type ResolvePreviewPathInput,
  type ResolvedPreviewPath,
} from "./paths.js";
export type {
  PreviewClientMessage,
  PreviewFile,
  PreviewHtml,
  PreviewItem,
  PreviewServerMessage,
  PreviewWorkbook,
} from "../protocol.js";

export interface RunningPreviewServer {
  readonly server: Server;
  readonly socketServer: WebSocketServer;
  readonly url: string;
  readonly basePath: string;
  readonly websocketPath: string;
  stop(): Promise<void>;
}

export interface StartPreviewServerOptions extends PreviewServiceOptions {
  readonly port?: number;
  readonly host?: string;
}

export const startPreviewServer = async (
  options: StartPreviewServerOptions = {},
): Promise<RunningPreviewServer> => {
  const service = createPreviewService(options);
  const socketServer = new WebSocketServer({ noServer: true });
  bindPreviewWebSocketServer(socketServer, service);

  const server = createServer((request, response) => {
    void service.handleRequest(request, response).then((handled) => {
      if (handled) {
        return;
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }).catch((error) => {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Preview server error");
    });
  });

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");

    if (requestUrl.pathname !== service.websocketPath) {
      socket.destroy();
      return;
    }

    socketServer.handleUpgrade(request, socket, head, (webSocket) => {
      socketServer.emit("connection", webSocket, request);
    });
  });

  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 4719;
  await listen(server, requestedPort, host);
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : requestedPort;
  const url = `http://${host}:${String(port)}${service.basePath}`;

  return {
    server,
    socketServer,
    url,
    basePath: service.basePath,
    websocketPath: service.websocketPath,
    async stop() {
      await Promise.all([
        closeWebSocketServer(socketServer),
        closeServer(server),
      ]);
    },
  };
};

const listen = (server: Server, port: number, host: string): Promise<void> =>
  new Promise((resolveListen, rejectListen) => {
    const handleError = (error: Error): void => {
      server.off("listening", handleListening);
      rejectListen(error);
    };
    const handleListening = (): void => {
      server.off("error", handleError);
      resolveListen();
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, host);
  });

const closeWebSocketServer = (socketServer: WebSocketServer): Promise<void> =>
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
