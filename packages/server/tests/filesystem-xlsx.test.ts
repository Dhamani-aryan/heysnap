import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startServer, type RunningServer } from "../src/runtime.js";

const openServers: RunningServer[] = [];
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.stop()));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("filesystem xlsx", () => {
  it("parses xlsx files and serves extracted assets", async () => {
    const root = await createRoot();
    const assetRoot = await createRoot();
    await writeFile(join(root, "budget.xlsx"), "xlsx bytes");
    const server = await startTestServer(root, assetRoot);

    const response = await fetch(xlsxUrl(server, "budget.xlsx"));
    const body = await response.json() as {
      readonly workbook?: {
        readonly sheets?: Array<{
          readonly images?: Array<{ readonly assetPath?: string; readonly assetUrl?: string }>;
          readonly charts?: Array<{ readonly assetPath?: string }>;
        }>;
      };
    };
    const assetId = response.headers.get("x-heysnap-xlsx-asset-id");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(assetId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(body.workbook?.sheets?.[0]?.images?.[0]?.assetPath).toBe("media/image.png");
    expect(body.workbook?.sheets?.[0]?.images?.[0]?.assetUrl).toBeUndefined();
    expect(body.workbook?.sheets?.[0]?.charts?.[0]?.assetPath).toBeUndefined();

    const assetResponse = await fetch(xlsxAssetUrl(server, assetId ?? "", "media/image.png"));

    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toBe("image/png");
    expect(await assetResponse.text()).toBe("png bytes");
  });

  it("rejects non-xlsx files", async () => {
    const root = await createRoot();
    const assetRoot = await createRoot();
    await writeFile(join(root, "notes.txt"), "plain text");
    const server = await startTestServer(root, assetRoot);

    const response = await fetch(xlsxUrl(server, "notes.txt"));
    const body = await response.json() as { readonly code: string };

    expect(response.status).toBe(415);
    expect(body.code).toBe("UNSUPPORTED_PREVIEW_TYPE");
  });
});

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ank1015-xlsx-test-"));
  tempRoots.push(root);
  return root;
};

const startTestServer = async (filesystemRoot: string, assetRoot: string): Promise<RunningServer> => {
  const server = await startServer({
    port: 0,
    filesystemRoot,
    filesystemXlsx: {
      xlsxAssetRoot: assetRoot,
      convertXlsxToWorkbook: async ({ outputDirectory }) => {
        await mkdir(join(outputDirectory, "media"), { recursive: true });
        await writeFile(join(outputDirectory, "media", "image.png"), "png bytes");

        return {
          workbook: {
            sheets: [
              {
                name: "Sheet1",
                images: [{ assetPath: "media/image.png" }],
                charts: [{ assetPath: "media/chart.png", renderedAssetUrl: "http://example.test/chart.png" }],
              },
            ],
          },
        };
      },
    },
  });
  openServers.push(server);
  return server;
};

const xlsxUrl = (server: RunningServer, path: string): string => {
  const url = new URL(server.urls.healthUrl.replace("/health", "/filesystem/xlsx"));
  url.searchParams.set("path", path);
  return url.toString();
};

const xlsxAssetUrl = (server: RunningServer, assetId: string, assetPath: string): string =>
  server.urls.healthUrl.replace(
    "/health",
    `/filesystem/xlsx-assets/${encodeURIComponent(assetId)}/${assetPath.split("/").map(encodeURIComponent).join("/")}`,
  );
