import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildFilesystemUploadUrl,
  FILESYSTEM_UPLOAD_CHUNK_SIZE_BYTES,
  uploadBrowserSourcesToFilesystem,
  type FilesystemBrowserUploadProgress,
} from "../../src/components/filesystem";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("filesystem upload helpers", () => {
  it("builds upload URLs from filesystem websocket URLs while preserving gateway access tokens", () => {
    expect(
      buildFilesystemUploadUrl(
        "wss://api.example.com/gateway/computers/cmp_123/filesystem?accessToken=token&path=src&showHidden=true&v=2",
      ),
    ).toBe("https://api.example.com/gateway/computers/cmp_123/filesystem/uploads?accessToken=token");
  });

  it("uploads browser files as metadata first, then sequential chunks, then complete", async () => {
    const fileBytes = new Uint8Array(FILESYSTEM_UPLOAD_CHUNK_SIZE_BYTES + 3);
    fileBytes.fill(7);
    const file = createTestFile([fileBytes], "big.bin", Date.parse("2026-05-26T10:00:00.000Z"));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);

      if (init?.method === "POST" && url === "https://api.example.com/filesystem/uploads") {
        return jsonResponse(201, {
          uploadId: "upload-1",
          expiresAt: "2026-05-26T10:30:00.000Z",
          files: [{ fileId: "file-1", relativePath: "big.bin", size: file.size }],
        });
      }

      if (init?.method === "PATCH" && url.endsWith("/upload-1/files/file-1?offset=0")) {
        return jsonResponse(200, {
          fileId: "file-1",
          offset: 0,
          bytesReceived: FILESYSTEM_UPLOAD_CHUNK_SIZE_BYTES,
          size: file.size,
          done: false,
        });
      }

      if (init?.method === "PATCH" && url.endsWith(`/upload-1/files/file-1?offset=${String(FILESYSTEM_UPLOAD_CHUNK_SIZE_BYTES)}`)) {
        return jsonResponse(200, {
          fileId: "file-1",
          offset: FILESYSTEM_UPLOAD_CHUNK_SIZE_BYTES,
          bytesReceived: file.size,
          size: file.size,
          done: true,
        });
      }

      if (init?.method === "POST" && url === "https://api.example.com/filesystem/uploads/upload-1") {
        return jsonResponse(200, { entries: [] });
      }

      throw new Error(`Unexpected fetch ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const progress: FilesystemBrowserUploadProgress[] = [];

    await uploadBrowserSourcesToFilesystem({
      uploadUrl: "https://api.example.com/filesystem/uploads",
      directoryPath: "target",
      sources: [{ type: "file", relativePath: "big.bin", file }],
      onProgress: (nextProgress) => progress.push(nextProgress),
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      path: "target",
      items: [{
        type: "file",
        relativePath: "big.bin",
        size: file.size,
        updatedAt: "2026-05-26T10:00:00.000Z",
      }],
    });
    await expect(readBlobBodyLength(fetchMock.mock.calls[1]?.[1]?.body)).resolves.toBe(FILESYSTEM_UPLOAD_CHUNK_SIZE_BYTES);
    await expect(readBlobBodyLength(fetchMock.mock.calls[2]?.[1]?.body)).resolves.toBe(3);
    expect(progress.at(0)).toMatchObject({ phase: "preparing", completedBytes: 0, totalBytes: file.size });
    expect(progress.at(-1)).toMatchObject({ phase: "uploading", completedBytes: file.size, totalBytes: file.size });
  });

  it("deletes the upload session when a chunk fails", async () => {
    const file = createTestFile(["hello"], "hello.txt");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);

      if (init?.method === "POST" && url === "https://api.example.com/filesystem/uploads") {
        return jsonResponse(201, {
          uploadId: "upload-1",
          expiresAt: "2026-05-26T10:30:00.000Z",
          files: [{ fileId: "file-1", relativePath: "hello.txt", size: file.size }],
        });
      }

      if (init?.method === "PATCH") {
        return jsonResponse(500, { message: "chunk failed" });
      }

      if (init?.method === "DELETE" && url === "https://api.example.com/filesystem/uploads/upload-1") {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadBrowserSourcesToFilesystem({
      uploadUrl: "https://api.example.com/filesystem/uploads",
      directoryPath: "",
      sources: [{ type: "file", relativePath: "hello.txt", file }],
    })).rejects.toThrow("chunk failed");

    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(["POST", "PATCH", "DELETE"]);
  });
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const readBlobBodyLength = async (body: BodyInit | null | undefined): Promise<number> => {
  expect(body).toBeInstanceOf(Blob);
  return (await (body as Blob).arrayBuffer()).byteLength;
};

const createTestFile = (parts: BlobPart[], name: string, lastModified = Date.now()): File => {
  const blob = new Blob(parts);

  Object.defineProperties(blob, {
    lastModified: { value: lastModified },
    name: { value: name },
  });

  return blob as File;
};
