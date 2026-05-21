import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer as createViteServer } from "vite";
import { WebSocketServer } from "ws";

import {
  bindPreviewWebSocketServer,
  createPreviewService,
} from "./server/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4719);
const basePath = process.env.PREVIEW_BASE_PATH ?? "/preview";
const previewRoot = process.env.PREVIEW_ROOT ?? process.cwd();
const allowAbsolutePaths = process.env.PREVIEW_ALLOW_ABSOLUTE !== "false";

const service = createPreviewService({
  basePath,
  rootPath: previewRoot,
  allowAbsolutePaths,
});
const socketServer = new WebSocketServer({ noServer: true });
bindPreviewWebSocketServer(socketServer, service);

const viteServer = await createViteServer({
  root: packageRoot,
  server: {
    middlewareMode: true,
  },
  appType: "custom",
});

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (requestUrl.pathname.startsWith(`${service.basePath}/api/`)) {
    void service.handleRequest(request, response).catch((error) => {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Preview server error");
    });
    return;
  }

  viteServer.middlewares(request, response, async () => {
    try {
      const html = await readFile(resolve(packageRoot, "index.html"), "utf8");
      const transformed = await viteServer.transformIndexHtml(requestUrl.pathname, html);
      const body = injectPreviewBasePath(transformed, service.basePath);

      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Preview dev server error");
    }
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

await new Promise<void>((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(port, host, () => {
    server.off("error", rejectListen);
    resolveListen();
  });
});

const url = buildDevUrl(`http://${host}:${String(port)}${service.basePath}`);
console.log(`previewer playground: ${url}`);
console.log(`preview root: ${previewRoot}`);

if (process.env.PREVIEWER_OPEN !== "false") {
  openBrowser(url);
}

const shutdown = (): void => {
  void Promise.all([
    new Promise<void>((resolveClose) => server.close(() => resolveClose())),
    new Promise<void>((resolveClose) => socketServer.close(() => resolveClose())),
    viteServer.close(),
  ]).finally(() => {
    process.exit(0);
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

function buildDevUrl(baseUrl: string): string {
  const url = new URL(baseUrl);

  if (process.env.PREVIEW_PATH !== undefined && process.env.PREVIEW_PATH.trim().length > 0) {
    url.searchParams.set("path", process.env.PREVIEW_PATH.trim());
  }

  if (process.env.PREVIEW_HTML_ROOT !== undefined && process.env.PREVIEW_HTML_ROOT.trim().length > 0) {
    url.searchParams.set("root", process.env.PREVIEW_HTML_ROOT.trim());
  }

  return url.toString();
}

function injectPreviewBasePath(indexHtml: string, basePath: string): string {
  const normalized = basePath.replace(/\/+$/u, "") || "/";
  const baseHref = normalized === "/" ? "/" : `${normalized}/`;
  return indexHtml
    .replaceAll("%HEYSNAP_PREVIEWER_BASE_PATH%", normalized)
    .replaceAll("%HEYSNAP_PREVIEWER_BASE_HREF%", baseHref);
}

function openBrowser(url: string): void {
  if (process.platform !== "darwin") {
    return;
  }

  const child = spawn("open", [url], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
