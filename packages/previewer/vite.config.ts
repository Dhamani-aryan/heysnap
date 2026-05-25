import { createReadStream, existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

export default defineConfig(({ mode }) => {
  if (mode === "server") {
    return {
      build: {
        ssr: true,
        outDir: "dist/server",
        target: "node20",
        rollupOptions: {
          input: {
            index: "src/server/index.ts",
            protocol: "src/protocol.ts",
          },
          output: { entryFileNames: "[name].js", format: "esm" },
          external: ["vite"],
        },
        emptyOutDir: true,
      },
    };
  }

  return {
    plugins: [react(), apryseWebViewerAssets()],
    base: "./",
    build: {
      outDir: "dist/client",
      emptyOutDir: true,
    },
  };
});

function apryseWebViewerAssets(): Plugin {
  const packageRoot = dirname(fileURLToPath(import.meta.url));
  const sourceRoot = resolve(packageRoot, "../../node_modules/@pdftron/webviewer/public");
  const outputRoot = resolve(packageRoot, "dist/client/lib/webviewer");
  const sourceRootPrefix = `${sourceRoot}/`;

  return {
    name: "heysnap-apryse-webviewer-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = new URL(request.url ?? "/", "http://localhost");
        const assetPath = getWebViewerAssetPath(requestUrl.pathname);

        if (assetPath === null) {
          next();
          return;
        }

        const filePath = resolve(sourceRoot, assetPath);

        if (!filePath.startsWith(sourceRootPrefix) || !existsSync(filePath)) {
          next();
          return;
        }

        const fileStats = statSync(filePath);
        if (!fileStats.isFile()) {
          next();
          return;
        }

        response.writeHead(200, {
          "cache-control": "no-store",
          "content-length": String(fileStats.size),
          "content-type": mimeForDevAsset(filePath),
        });
        createReadStream(filePath).pipe(response);
      });
    },
    async closeBundle() {
      const sourceStats = await stat(sourceRoot).catch(() => null);
      if (sourceStats === null || !sourceStats.isDirectory()) {
        throw new Error(
          "Apryse WebViewer assets were not found. Install @pdftron/webviewer first.",
        );
      }

      await rm(outputRoot, { recursive: true, force: true });
      await copyDirectory(sourceRoot, outputRoot);
    },
  };
}

async function copyDirectory(sourceRoot: string, outputRoot: string): Promise<void> {
  await mkdir(outputRoot, { recursive: true });

  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    const sourcePath = join(sourceRoot, entry.name);
    const outputPath = join(outputRoot, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, outputPath);
      continue;
    }

    if (entry.isFile()) {
      await copyFile(sourcePath, outputPath);
    }
  }
}

function getWebViewerAssetPath(pathname: string): string | null {
  const match = /^\/(?:.*\/)?lib\/webviewer\/(.+)$/u.exec(pathname);
  if (match === null) {
    return null;
  }

  return decodeURIComponent(match[1] ?? "");
}

function mimeForDevAsset(pathname: string): string {
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".wasm")) return "application/wasm";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".woff")) return "font/woff";
  if (pathname.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}
