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

describe("filesystem download", () => {
  it("downloads a file as an attachment", async () => {
    const root = await createRoot();
    await writeFile(join(root, "hello.txt"), "hello download");
    const server = await startTestServer(root);

    const response = await fetch(downloadUrl(server, "hello.txt"));

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("content-disposition")).toContain("hello.txt");
    expect(await response.text()).toBe("hello download");
  });

  it("answers download preflight requests", async () => {
    const root = await createRoot();
    await writeFile(join(root, "hello.txt"), "hello download");
    const server = await startTestServer(root);

    const response = await fetch(downloadUrl(server, "hello.txt"), { method: "OPTIONS" });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-headers")).toBe("Range");
  });

  it("downloads a folder as a zip archive", async () => {
    const root = await createRoot();
    await mkdir(join(root, "Project", "src"), { recursive: true });
    await writeFile(join(root, "Project", "src", "index.txt"), "zip me");
    const server = await startTestServer(root);

    const response = await fetch(downloadUrl(server, "Project"));
    const archive = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain("Project.zip");
    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    expect(archive.toString("utf8")).toContain("Project/src/index.txt");
  });

  it("downloads multiple selected entries as a zip archive", async () => {
    const root = await createRoot();
    await mkdir(join(root, "Folder"));
    await writeFile(join(root, "Folder", "nested.txt"), "nested");
    await writeFile(join(root, "file.txt"), "file");
    const server = await startTestServer(root);

    const response = await fetch(downloadUrl(server, ["Folder", "file.txt"]));
    const archive = Buffer.from(await response.arrayBuffer());
    const archiveText = archive.toString("utf8");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("download.zip");
    expect(archiveText).toContain("Folder/nested.txt");
    expect(archiveText).toContain("file.txt");
  });
});

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ank1015-download-"));
  tempRoots.push(root);
  return root;
};

const startTestServer = async (filesystemRoot: string): Promise<RunningServer> => {
  const server = await startServer({ port: 0, filesystemRoot });
  openServers.push(server);
  return server;
};

const downloadUrl = (server: RunningServer, path: string | readonly string[]): string => {
  const url = new URL(server.urls.healthUrl.replace("/health", "/filesystem/download"));
  const paths = Array.isArray(path) ? path : [path];

  paths.forEach((currentPath) => {
    url.searchParams.append("path", currentPath);
  });

  return url.toString();
};
