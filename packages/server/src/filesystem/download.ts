import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";

import { FilesystemError, toFilesystemError } from "./errors.js";
import { ensureWithinRoot, resolveClientPath } from "./paths.js";
import type { FilesystemRoot } from "./types.js";

type ZipEntry = {
  readonly name: string;
  readonly data: Buffer;
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
      "content-type": "application/zip",
      "content-length": String(archive.byteLength),
      "content-disposition": contentDisposition("download.zip"),
    });
    response.end(archive);
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
      "content-type": "application/octet-stream",
      "content-length": String(targetStats.size),
      "content-disposition": contentDisposition(targetName),
    });
    createReadStream(targetPath).pipe(response);
    return;
  }

  if (targetStats.isDirectory()) {
    const archiveName = `${targetName}.zip`;
    const archive = await createDirectoryZip(root.absolutePath, targetPath, targetName);
    response.writeHead(200, {
      "content-type": "application/zip",
      "content-length": String(archive.byteLength),
      "content-disposition": contentDisposition(archiveName),
    });
    response.end(archive);
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

  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({
    code: filesystemError.code,
    message: filesystemError.message,
  }));
};

const createDirectoryZip = async (
  rootPath: string,
  directoryPath: string,
  zipRootName: string,
): Promise<Buffer> => {
  const entries = await collectZipEntries(rootPath, directoryPath, zipRootName);
  return encodeZip(entries);
};

const createMultiPathZip = async (
  rootPath: string,
  targetPaths: readonly string[],
): Promise<Buffer> => {
  const entries: ZipEntry[] = [];

  for (const targetPath of targetPaths) {
    const zipName = basename(targetPath);

    if (zipName.length === 0) {
      throw new FilesystemError("INVALID_PATH", "Cannot download root with other items");
    }

    entries.push(...await collectZipEntries(rootPath, targetPath, zipName));
  }

  return encodeZip(entries);
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
      data: Buffer.alloc(0),
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
      data: await readFile(targetPath),
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

const encodeZip = (entries: readonly ZipEntry[]): Buffer => {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const { date, time } = toDosDateTime(entry.updatedAt);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(entry.data.byteLength, 18);
    localHeader.writeUInt32LE(entry.data.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(entry.data.byteLength, 20);
    centralHeader.writeUInt32LE(entry.data.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(entry.isDirectory ? 0x00100000 : 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.byteLength + name.byteLength + entry.data.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
};

const toDosDateTime = (date: Date): { readonly date: number; readonly time: number } => {
  const year = Math.max(1980, date.getFullYear());

  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
};

const crc32 = (data: Buffer): number => {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
};

const createCrc32Table = (): number[] => {
  const table: number[] = [];

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
};

const contentDisposition = (filename: string): string => {
  const fallback = filename.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};

const CRC32_TABLE = createCrc32Table();
