import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

describe("filesystem HTTP uploads", () => {
  it("uploads a file in sequential chunks and completes atomically", async () => {
    const root = await createRoot();
    await mkdir(join(root, "target"));
    const server = await startTestServer(root);

    const created = await createUpload(server, {
      path: "target",
      items: [
        { type: "directory", relativePath: "Project", updatedAt: "2026-05-26T10:00:00.000Z" },
        { type: "file", relativePath: "Project/greeting.txt", size: 11, updatedAt: "2026-05-26T10:00:00.000Z" },
      ],
    });

    expect(created.files).toEqual([{ fileId: "0", relativePath: "Project/greeting.txt", size: 11 }]);

    const firstChunk = await uploadChunk(server, created.uploadId, "0", 0, "hello ");
    expect(firstChunk).toMatchObject({
      fileId: "0",
      offset: 0,
      bytesReceived: 6,
      size: 11,
      done: false,
    });

    const secondChunk = await uploadChunk(server, created.uploadId, "0", 6, "world");
    expect(secondChunk).toMatchObject({
      fileId: "0",
      offset: 6,
      bytesReceived: 11,
      done: true,
    });

    const completeResponse = await fetch(uploadSessionUrl(server, created.uploadId), { method: "POST" });
    const completeBody = await completeResponse.json() as { readonly entries: Array<{ readonly path: string }> };

    expect(completeResponse.status).toBe(200);
    expect(completeBody.entries.map((entry) => entry.path)).toEqual([
      "target/Project",
      "target/Project/greeting.txt",
    ]);
    await expect(readFile(join(root, "target", "Project", "greeting.txt"), "utf8")).resolves.toBe("hello world");
  });

  it("rejects path traversal and duplicate target paths when creating sessions", async () => {
    const root = await createRoot();
    await mkdir(join(root, "target"));
    const server = await startTestServer(root);

    const traversal = await fetch(uploadBaseUrl(server), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "target",
        items: [{ type: "file", relativePath: "../escape.txt", size: 1 }],
      }),
    });
    expect(traversal.status).toBe(400);
    await expect(traversal.json()).resolves.toMatchObject({ code: "INVALID_UPLOAD_PATH" });

    const duplicate = await fetch(uploadBaseUrl(server), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "target",
        items: [
          { type: "file", relativePath: "same.txt", size: 1 },
          { type: "file", relativePath: "same.txt", size: 1 },
        ],
      }),
    });
    expect(duplicate.status).toBe(400);
    await expect(duplicate.json()).resolves.toMatchObject({ code: "DUPLICATE_UPLOAD_PATH" });
  });

  it("checks target availability when creating and completing sessions", async () => {
    const root = await createRoot();
    await mkdir(join(root, "target"));
    await writeFile(join(root, "target", "exists.txt"), "already here");
    const server = await startTestServer(root);

    const unavailable = await fetch(uploadBaseUrl(server), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "target",
        items: [{ type: "file", relativePath: "exists.txt", size: 1 }],
      }),
    });
    expect(unavailable.status).toBe(400);
    await expect(unavailable.json()).resolves.toMatchObject({ code: "PATH_EXISTS" });

    const created = await createUpload(server, {
      path: "target",
      items: [{ type: "file", relativePath: "race.txt", size: 4 }],
    });
    await uploadChunk(server, created.uploadId, "0", 0, "race");
    await writeFile(join(root, "target", "race.txt"), "claimed");

    const complete = await fetch(uploadSessionUrl(server, created.uploadId), { method: "POST" });
    expect(complete.status).toBe(400);
    await expect(complete.json()).resolves.toMatchObject({ code: "PATH_EXISTS" });
    await deleteUpload(server, created.uploadId);
  });

  it("rejects wrong offsets, oversized chunks, incomplete complete, and missing sessions", async () => {
    const root = await createRoot();
    await mkdir(join(root, "target"));
    const server = await startTestServer(root);

    const created = await createUpload(server, {
      path: "target",
      items: [{ type: "file", relativePath: "data.bin", size: 4 * 1024 * 1024 + 1 }],
    });

    const wrongOffset = await fetch(uploadChunkUrl(server, created.uploadId, "0", 1), {
      method: "PATCH",
      headers: { "content-type": "application/octet-stream" },
      body: "x",
    });
    expect(wrongOffset.status).toBe(409);
    await expect(wrongOffset.json()).resolves.toMatchObject({ code: "UPLOAD_OFFSET_MISMATCH" });

    const tooLarge = await fetch(uploadChunkUrl(server, created.uploadId, "0", 0), {
      method: "PATCH",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.alloc(4 * 1024 * 1024 + 1),
    });
    expect(tooLarge.status).toBe(413);
    await expect(tooLarge.json()).resolves.toMatchObject({ code: "UPLOAD_CHUNK_TOO_LARGE" });

    const incomplete = await fetch(uploadSessionUrl(server, created.uploadId), { method: "POST" });
    expect(incomplete.status).toBe(400);
    await expect(incomplete.json()).resolves.toMatchObject({ code: "UPLOAD_INCOMPLETE" });
    await deleteUpload(server, created.uploadId);

    const missing = await fetch(uploadChunkUrl(server, "missing-upload", "0", 0), {
      method: "PATCH",
      headers: { "content-type": "application/octet-stream" },
      body: "x",
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  });
});

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ank1015-upload-"));
  tempRoots.push(root);
  return root;
};

const startTestServer = async (filesystemRoot: string): Promise<RunningServer> => {
  const server = await startServer({ port: 0, filesystemRoot });
  openServers.push(server);
  return server;
};

const createUpload = async (
  server: RunningServer,
  body: unknown,
): Promise<{
  readonly uploadId: string;
  readonly files: Array<{ readonly fileId: string; readonly relativePath: string; readonly size: number }>;
}> => {
  const response = await fetch(uploadBaseUrl(server), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  expect(response.status).toBe(201);
  return await response.json() as {
    readonly uploadId: string;
    readonly files: Array<{ readonly fileId: string; readonly relativePath: string; readonly size: number }>;
  };
};

const uploadChunk = async (
  server: RunningServer,
  uploadId: string,
  fileId: string,
  offset: number,
  body: BodyInit,
): Promise<unknown> => {
  const response = await fetch(uploadChunkUrl(server, uploadId, fileId, offset), {
    method: "PATCH",
    headers: { "content-type": "application/octet-stream" },
    body,
  });

  expect(response.status).toBe(200);
  return await response.json() as unknown;
};

const deleteUpload = async (server: RunningServer, uploadId: string): Promise<void> => {
  await fetch(uploadSessionUrl(server, uploadId), { method: "DELETE" });
};

const uploadBaseUrl = (server: RunningServer): string =>
  server.urls.healthUrl.replace("/health", "/filesystem/uploads");

const uploadSessionUrl = (server: RunningServer, uploadId: string): string =>
  `${uploadBaseUrl(server)}/${encodeURIComponent(uploadId)}`;

const uploadChunkUrl = (
  server: RunningServer,
  uploadId: string,
  fileId: string,
  offset: number,
): string =>
  `${uploadSessionUrl(server, uploadId)}/files/${encodeURIComponent(fileId)}?offset=${String(offset)}`;
