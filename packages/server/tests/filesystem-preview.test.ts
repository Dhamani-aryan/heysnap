import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("filesystem preview", () => {
  it("serves pdf files inline", async () => {
    const root = await createRoot();
    await writeFile(join(root, "manual.pdf"), "%PDF manual");
    const server = await startTestServer(root);

    const response = await fetch(previewUrl(server, "manual.pdf"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe("inline; filename=\"manual.pdf\"");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toBe("%PDF manual");
  }, 15_000);

  it("converts xlsx files to PDF previews", async () => {
    const root = await createRoot();
    const sourcePath = join(root, "budget.xlsx");
    await writeFile(sourcePath, "xlsx bytes");
    const server = await startTestServer(root);

    const response = await fetch(previewUrl(server, "budget.xlsx"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe("inline; filename=\"budget.pdf\"");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toBe("%PDF fake");
  });

  it("converts pptx files to PDF previews", async () => {
    const root = await createRoot();
    const sourcePath = join(root, "deck.pptx");
    await writeFile(sourcePath, "pptx bytes");
    const server = await startTestServer(root);

    const response = await fetch(previewUrl(server, "deck.pptx"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe("inline; filename=\"deck.pdf\"");
    expect(await response.text()).toBe("%PDF fake");
  });

  it("answers preview preflight requests", async () => {
    const root = await createRoot();
    await writeFile(join(root, "budget.xlsx"), "xlsx bytes");
    const server = await startTestServer(root);

    const response = await fetch(previewUrl(server, "budget.xlsx"), { method: "OPTIONS" });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-headers")).toBe("Range");
  });

  it("rejects unsupported preview file types", async () => {
    const root = await createRoot();
    await writeFile(join(root, "notes.txt"), "plain text");
    const server = await startTestServer(root);

    const response = await fetch(previewUrl(server, "notes.txt"));
    const body = await response.json() as { readonly code: string };

    expect(response.status).toBe(415);
    expect(body.code).toBe("UNSUPPORTED_PREVIEW_TYPE");
  });
});

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ank1015-preview-"));
  tempRoots.push(root);
  return root;
};

const startTestServer = async (filesystemRoot: string): Promise<RunningServer> => {
  const server = await startServer({
    port: 0,
    filesystemRoot,
    filesystemPreview: {
      convertOfficeToPdf: async () => Buffer.from("%PDF fake"),
    },
  });
  openServers.push(server);
  return server;
};

const previewUrl = (server: RunningServer, path: string): string => {
  const url = new URL(server.urls.healthUrl.replace("/health", "/filesystem/preview"));
  url.searchParams.set("path", path);
  url.searchParams.set("format", "pdf");
  return url.toString();
};
