import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";
import { ZipFile } from "yazl";

import { FilesystemError, toFilesystemError } from "./errors.js";
import { ensureWithinRoot, resolveClientPath } from "./paths.js";
import type { FilesystemRoot } from "./types.js";

type ZipEntry = {
  readonly name: string;
  readonly absolutePath: string;
  readonly updatedAt: Date;
  readonly isDirectory: boolean;
};

export const handleFilesystemDownloadRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  root: FilesystemRoot,
): Promise<void> => {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  const rawPaths = requestUrl.searchParams.getAll("path");
  const targetPathInputs = rawPaths.length === 0 ? [undefined] : rawPaths;
  const targetPaths = targetPathInputs.map((rawPath) => resolveClientPath(root.absolutePath, rawPath));

  if (targetPaths.length > 1) {
    const archive = await createMultiPathZip(root.absolutePath, targetPaths);
    response.writeHead(200, {
      ...filesystemDownloadCorsHeaders,
      "content-type": "application/zip",
      "content-disposition": contentDisposition("download.zip"),
    });
    pipeDownloadStream(response, archive.outputStream);
    archive.end();
    return;
  }

  const targetPath = targetPaths[0];

  if (targetPath === undefined) {
    throw new FilesystemError("INVALID_PATH", "Path is required");
  }

  const targetStats = await getStats(targetPath);
  const targetName = basename(targetPath) || root.name;

  if (targetStats.isFile()) {
    response.writeHead(200, {
      ...filesystemDownloadCorsHeaders,
      "content-type": "application/octet-stream",
      "content-length": String(targetStats.size),
      "content-disposition": contentDisposition(targetName),
    });
    pipeDownloadStream(response, createReadStream(targetPath));
    return;
  }

  if (targetStats.isDirectory()) {
    const archiveName = `${targetName}.zip`;
    const archive = await createDirectoryZip(root.absolutePath, targetPath, targetName);
    response.writeHead(200, {
      ...filesystemDownloadCorsHeaders,
      "content-type": "application/zip",
      "content-disposition": contentDisposition(archiveName),
    });
    pipeDownloadStream(response, archive.outputStream);
    archive.end();
    return;
  }

  throw new FilesystemError("UNSUPPORTED_ENTRY", "Unsupported entry type");
};

export const sendFilesystemDownloadError = (
  response: ServerResponse,
  error: unknown,
): void => {
  const filesystemError = toFilesystemError(error);
  const status = filesystemError.code === "PATH_NOT_FOUND" ? 404 : 400;

  response.writeHead(status, {
    ...filesystemDownloadCorsHeaders,
    "content-type": "application/json",
  });
  response.end(JSON.stringify({
    code: filesystemError.code,
    message: filesystemError.message,
  }));
};

export const filesystemDownloadCorsHeaders = {
  "access-control-allow-headers": "Range",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "Content-Disposition, Content-Length, Content-Range",
} as const;

const createDirectoryZip = async (
  rootPath: string,
  directoryPath: string,
  zipRootName: string,
): Promise<ZipFile> => {
  const entries = await collectZipEntries(rootPath, directoryPath, zipRootName);
  return createZip(entries);
};

const createMultiPathZip = async (
  rootPath: string,
  targetPaths: readonly string[],
): Promise<ZipFile> => {
  const entries: ZipEntry[] = [];

  for (const targetPath of targetPaths) {
    const zipName = basename(targetPath);

    if (zipName.length === 0) {
      throw new FilesystemError("INVALID_PATH", "Cannot download root with other items");
    }

    entries.push(...await collectZipEntries(rootPath, targetPath, zipName));
  }

  return createZip(entries);
};

const getStats = async (targetPath: string): Promise<Awaited<ReturnType<typeof stat>>> => {
  try {
    return await stat(targetPath);
  } catch {
    throw new FilesystemError("PATH_NOT_FOUND", "Path not found");
  }
};

const collectZipEntries = async (
  rootPath: string,
  targetPath: string,
  zipPath: string,
): Promise<ZipEntry[]> => {
  const entryStats = await lstat(targetPath);
  const resolvedStats = entryStats.isSymbolicLink() ? await getSafeSymlinkStats(rootPath, targetPath) : entryStats;
  const updatedAt = entryStats.mtime;

  if (resolvedStats.isDirectory()) {
    const entries: ZipEntry[] = [{
      name: `${zipPath.replace(/\/+$/u, "")}/`,
      absolutePath: targetPath,
      updatedAt,
      isDirectory: true,
    }];
    const children = await readdir(targetPath, { withFileTypes: true });

    for (const child of children) {
      entries.push(...await collectZipEntries(rootPath, join(targetPath, child.name), `${zipPath}/${child.name}`));
    }

    return entries;
  }

  if (resolvedStats.isFile()) {
    return [{
      name: zipPath,
      absolutePath: targetPath,
      updatedAt,
      isDirectory: false,
    }];
  }

  return [];
};

const getSafeSymlinkStats = async (
  rootPath: string,
  entryPath: string,
): Promise<Awaited<ReturnType<typeof stat>>> => {
  ensureWithinRoot(await realpath(rootPath), await realpath(entryPath));
  return stat(entryPath);
};

const createZip = (entries: readonly ZipEntry[]): ZipFile => {
  const zip = new ZipFile();

  for (const entry of entries) {
    if (entry.isDirectory) {
      zip.addEmptyDirectory(entry.name, { mtime: entry.updatedAt });
      continue;
    }

    zip.addFile(entry.absolutePath, entry.name, { mtime: entry.updatedAt });
  }

  return zip;
};

const pipeDownloadStream = (response: ServerResponse, stream: NodeJS.ReadableStream): void => {
  const destroyStream = (): void => {
    if (!response.writableEnded) {
      (stream as { destroy?: () => void }).destroy?.();
    }
  };

  response.on("close", destroyStream);
  stream.on("error", (error) => {
    response.destroy(error);
  });
  stream.on("end", () => {
    response.removeListener("close", destroyStream);
  });
  stream.pipe(response);
};

const contentDisposition = (filename: string): string => {
  const fallback = filename.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};
