import { randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, rm, rename, stat, utimes, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path, { dirname, join } from "node:path";

import { FilesystemError, toFilesystemError } from "./errors.js";
import { ensureWithinRoot, resolveClientPath, toClientPath, validateEntryName } from "./paths.js";
import { FilesystemService } from "./service.js";
import type {
  FilesystemEntry,
  FilesystemRoot,
  FilesystemUploadChunkResponse,
  FilesystemUploadCompleteResponse,
  FilesystemUploadCreateRequest,
  FilesystemUploadCreateResponse,
  FilesystemUploadItem,
} from "./types.js";

const UPLOAD_TEMP_DIRECTORY_NAME = ".heysnap-upload-sessions";
const UPLOAD_SESSION_TTL_MS = 30 * 60 * 1000;
export const FILESYSTEM_UPLOAD_CHUNK_LIMIT_BYTES = 4 * 1024 * 1024;

export const filesystemUploadCorsHeaders = {
  "access-control-allow-headers": "Content-Type, Content-Length",
  "access-control-allow-methods": "POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "Content-Length",
} as const;

export const handleFilesystemUploadRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  root: FilesystemRoot,
): Promise<boolean> => {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (!requestUrl.pathname.startsWith("/filesystem/uploads")) {
    return false;
  }

  await cleanupExpiredUploadSessions();

  if (request.method === "OPTIONS") {
    response.writeHead(204, filesystemUploadCorsHeaders);
    response.end();
    return true;
  }

  try {
    if (request.method === "POST" && requestUrl.pathname === "/filesystem/uploads") {
      const input = parseUploadCreateRequest(await readJsonBody(request, 1024 * 1024));
      sendJson(response, 201, await createUploadSession(root, input));
      return true;
    }

    const fileMatch = /^\/filesystem\/uploads\/([^/]+)\/files\/([^/]+)$/.exec(requestUrl.pathname);
    if (request.method === "PATCH" && fileMatch !== null) {
      const contentLength = readContentLength(request);
      if (contentLength !== undefined && contentLength > FILESYSTEM_UPLOAD_CHUNK_LIMIT_BYTES) {
        throw new UploadHttpError("UPLOAD_CHUNK_TOO_LARGE", "Upload chunks cannot exceed 4 MiB.", 413);
      }

      const body = await readBody(request, FILESYSTEM_UPLOAD_CHUNK_LIMIT_BYTES);
      const uploadId = decodeURIComponent(fileMatch[1] ?? "");
      const fileId = decodeURIComponent(fileMatch[2] ?? "");
      const offset = readOffset(requestUrl);
      sendJson(response, 200, await writeUploadChunk({ uploadId, fileId, offset, body }));
      return true;
    }

    const sessionMatch = /^\/filesystem\/uploads\/([^/]+)$/.exec(requestUrl.pathname);
    if (sessionMatch !== null) {
      const uploadId = decodeURIComponent(sessionMatch[1] ?? "");

      if (request.method === "POST") {
        sendJson(response, 200, await completeUploadSession(root, uploadId));
        return true;
      }

      if (request.method === "DELETE") {
        await deleteUploadSession(uploadId);
        response.writeHead(204, filesystemUploadCorsHeaders);
        response.end();
        return true;
      }
    }

    sendJson(response, 404, { code: "NOT_FOUND", message: "Filesystem upload endpoint not found." });
    return true;
  } catch (error) {
    sendUploadError(response, error);
    return true;
  }
};

const uploadSessions = new Map<string, UploadSession>();

interface UploadSession {
  readonly uploadId: string;
  readonly rootPath: string;
  readonly directoryPath: string;
  readonly tempDir: string;
  readonly expiresAtMs: number;
  readonly directories: UploadDirectoryItem[];
  readonly files: UploadFileState[];
  readonly filesById: Map<string, UploadFileState>;
}

interface UploadDirectoryItem {
  readonly relativePath: string;
  readonly targetPath: string;
  readonly updatedAt?: string;
}

interface UploadFileState {
  readonly fileId: string;
  readonly relativePath: string;
  readonly targetPath: string;
  readonly tempPath: string;
  readonly size: number;
  readonly updatedAt?: string;
  bytesReceived: number;
}

const createUploadSession = async (
  root: FilesystemRoot,
  input: FilesystemUploadCreateRequest,
): Promise<FilesystemUploadCreateResponse> => {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new FilesystemError("INVALID_UPLOAD", "At least one upload item is required.");
  }

  const directoryPath = resolveClientPath(root.absolutePath, input.path);
  const directoryStats = await stat(directoryPath).catch(() => {
    throw new FilesystemError("PATH_NOT_FOUND", "Upload target directory was not found.");
  });

  if (!directoryStats.isDirectory()) {
    throw new FilesystemError("NOT_DIRECTORY", "Upload target path is not a directory.");
  }

  const directories: UploadDirectoryItem[] = [];
  const files: UploadFileState[] = [];
  const targetPaths: string[] = [];
  const uploadId = randomUUID();
  const tempDir = join(root.absolutePath, UPLOAD_TEMP_DIRECTORY_NAME, uploadId);

  for (const item of input.items) {
    const relativePath = validateUploadRelativePath(item.relativePath);
    const targetPath = join(directoryPath, ...relativePath.split("/"));
    ensureWithinRoot(root.absolutePath, targetPath);
    ensureWithinRoot(directoryPath, targetPath);
    targetPaths.push(targetPath);

    if (item.type === "directory") {
      directories.push({ relativePath, targetPath, updatedAt: item.updatedAt });
      continue;
    }

    if (!Number.isSafeInteger(item.size) || item.size < 0) {
      throw new FilesystemError("INVALID_UPLOAD_SIZE", "Upload file size must be a non-negative safe integer.");
    }

    const fileId = String(files.length);
    files.push({
      fileId,
      relativePath,
      targetPath,
      tempPath: join(tempDir, fileId),
      size: item.size,
      updatedAt: item.updatedAt,
      bytesReceived: 0,
    });
  }

  if (new Set(targetPaths).size !== targetPaths.length) {
    throw new FilesystemError("DUPLICATE_UPLOAD_PATH", "Upload contains duplicate file paths.");
  }

  await Promise.all(targetPaths.map(ensurePathAvailable));
  await mkdir(tempDir, { recursive: true });

  const expiresAtMs = Date.now() + UPLOAD_SESSION_TTL_MS;
  const session: UploadSession = {
    uploadId,
    rootPath: root.absolutePath,
    directoryPath,
    tempDir,
    expiresAtMs,
    directories,
    files,
    filesById: new Map(files.map((file) => [file.fileId, file])),
  };
  uploadSessions.set(uploadId, session);

  return {
    uploadId,
    expiresAt: new Date(expiresAtMs).toISOString(),
    files: files.map((file) => ({
      fileId: file.fileId,
      relativePath: file.relativePath,
      size: file.size,
    })),
  };
};

const writeUploadChunk = async (
  input: {
    readonly uploadId: string;
    readonly fileId: string;
    readonly offset: number;
    readonly body: Buffer;
  },
): Promise<FilesystemUploadChunkResponse> => {
  const session = await getUploadSession(input.uploadId);
  const file = session.filesById.get(input.fileId);

  if (file === undefined) {
    throw new FilesystemError("UPLOAD_FILE_NOT_FOUND", "Upload file was not found.");
  }

  if (input.offset !== file.bytesReceived) {
    throw new UploadHttpError("UPLOAD_OFFSET_MISMATCH", "Upload chunk offset does not match the received byte count.", 409);
  }

  if (input.body.byteLength > FILESYSTEM_UPLOAD_CHUNK_LIMIT_BYTES) {
    throw new UploadHttpError("UPLOAD_CHUNK_TOO_LARGE", "Upload chunks cannot exceed 4 MiB.", 413);
  }

  if (file.bytesReceived + input.body.byteLength > file.size) {
    throw new UploadHttpError("UPLOAD_CHUNK_TOO_LARGE", "Upload chunk exceeds the declared file size.", 413);
  }

  if (input.body.byteLength > 0 || file.size === 0) {
    if (file.bytesReceived === 0) {
      await writeFile(file.tempPath, input.body, { flag: "wx" }).catch(async (error: unknown) => {
        if (isNodeError(error) && error.code === "EEXIST" && file.bytesReceived === 0) {
          throw new UploadHttpError("UPLOAD_OFFSET_MISMATCH", "Upload chunk was already written.", 409);
        }

        throw error;
      });
    } else {
      await appendFile(file.tempPath, input.body);
    }
  }

  file.bytesReceived += input.body.byteLength;

  return {
    fileId: file.fileId,
    offset: input.offset,
    bytesReceived: file.bytesReceived,
    size: file.size,
    done: file.bytesReceived === file.size,
  };
};

const completeUploadSession = async (
  root: FilesystemRoot,
  uploadId: string,
): Promise<FilesystemUploadCompleteResponse> => {
  const session = await getUploadSession(uploadId);

  if (session.rootPath !== root.absolutePath) {
    throw new FilesystemError("UPLOAD_NOT_FOUND", "Upload session was not found.");
  }

  try {
    for (const file of session.files) {
      if (file.bytesReceived !== file.size) {
        throw new FilesystemError("UPLOAD_INCOMPLETE", "Upload cannot complete before every file is fully received.");
      }
    }

    await Promise.all(
      [...session.directories.map((item) => item.targetPath), ...session.files.map((file) => file.targetPath)]
        .map(ensurePathAvailable),
    );

    const uploadedEntries: FilesystemEntry[] = [];
    const service = new FilesystemService({ rootPath: root.absolutePath });

    for (const directory of [...session.directories].sort((left, right) => getPathDepth(left.relativePath) - getPathDepth(right.relativePath))) {
      await mkdir(directory.targetPath, { recursive: false });
      await applyUpdatedAt(directory.targetPath, directory.updatedAt);
      uploadedEntries.push(await service.getEntry(toClientPath(root.absolutePath, directory.targetPath)));
    }

    for (const file of session.files) {
      if (file.size === 0 && file.bytesReceived === 0) {
        await writeFile(file.tempPath, "", { flag: "wx" });
      }

      await mkdir(dirname(file.targetPath), { recursive: true });
      await rename(file.tempPath, file.targetPath);
      await applyUpdatedAt(file.targetPath, file.updatedAt);
      uploadedEntries.push(await service.getEntry(toClientPath(root.absolutePath, file.targetPath)));
    }

    uploadSessions.delete(uploadId);
    await rm(session.tempDir, { recursive: true, force: true });

    return { entries: uploadedEntries };
  } catch (error) {
    await deleteUploadSession(uploadId);
    throw error;
  }
};

const deleteUploadSession = async (uploadId: string): Promise<void> => {
  const session = uploadSessions.get(uploadId);
  uploadSessions.delete(uploadId);

  if (session !== undefined) {
    await rm(session.tempDir, { recursive: true, force: true });
  }
};

const getUploadSession = async (uploadId: string): Promise<UploadSession> => {
  const session = uploadSessions.get(uploadId);

  if (session === undefined) {
    throw new FilesystemError("UPLOAD_NOT_FOUND", "Upload session was not found.");
  }

  if (session.expiresAtMs <= Date.now()) {
    await deleteUploadSession(uploadId);
    throw new FilesystemError("UPLOAD_EXPIRED", "Upload session expired.");
  }

  return session;
};

const cleanupExpiredUploadSessions = async (): Promise<void> => {
  const now = Date.now();
  for (const session of uploadSessions.values()) {
    if (session.expiresAtMs <= now) {
      await deleteUploadSession(session.uploadId);
    }
  }
};

const parseUploadCreateRequest = (body: unknown): FilesystemUploadCreateRequest => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new FilesystemError("INVALID_UPLOAD", "Upload request body must be a JSON object.");
  }

  const record = body as Record<string, unknown>;
  const items = record["items"];

  if (!Array.isArray(items)) {
    throw new FilesystemError("INVALID_UPLOAD", "Upload request items must be an array.");
  }

  return {
    path: typeof record["path"] === "string" ? record["path"] : undefined,
    items: items.map(parseUploadItem),
  };
};

const parseUploadItem = (value: unknown): FilesystemUploadItem => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FilesystemError("INVALID_UPLOAD", "Upload item must be a JSON object.");
  }

  const item = value as Record<string, unknown>;
  const type = item["type"];
  const relativePath = item["relativePath"];
  const updatedAt = item["updatedAt"];

  if (type !== "file" && type !== "directory") {
    throw new FilesystemError("INVALID_UPLOAD", "Upload item type must be file or directory.");
  }

  if (typeof relativePath !== "string") {
    throw new FilesystemError("INVALID_UPLOAD_PATH", "Upload item relativePath is required.");
  }

  if (updatedAt !== undefined && typeof updatedAt !== "string") {
    throw new FilesystemError("INVALID_UPLOAD", "Upload item updatedAt must be a string.");
  }

  if (type === "directory") {
    return { type, relativePath, updatedAt };
  }

  const size = item["size"];
  if (typeof size !== "number") {
    throw new FilesystemError("INVALID_UPLOAD_SIZE", "Upload file size is required.");
  }

  return { type, relativePath, size, updatedAt };
};

const readOffset = (requestUrl: URL): number => {
  const offset = Number(requestUrl.searchParams.get("offset") ?? "0");

  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new FilesystemError("INVALID_UPLOAD_OFFSET", "Upload offset must be a non-negative integer.");
  }

  return offset;
};

const validateUploadRelativePath = (rawPath: string): string => {
  if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
    throw new FilesystemError("INVALID_UPLOAD_PATH", "Upload path is required.");
  }

  if (rawPath.includes("\0") || rawPath.startsWith("/") || rawPath.includes("\\")) {
    throw new FilesystemError("INVALID_UPLOAD_PATH", "Upload path must be relative.");
  }

  const normalizedPath = path.posix.normalize(rawPath);

  if (normalizedPath === "." || normalizedPath.startsWith("../") || normalizedPath === "..") {
    throw new FilesystemError("INVALID_UPLOAD_PATH", "Upload path cannot leave the target folder.");
  }

  const firstSegment = normalizedPath.split("/")[0];
  if (firstSegment === UPLOAD_TEMP_DIRECTORY_NAME) {
    throw new FilesystemError("INVALID_UPLOAD_PATH", "Upload path uses a reserved directory name.");
  }

  normalizedPath.split("/").forEach(validateEntryName);
  return normalizedPath;
};

const readJsonBody = async (request: IncomingMessage, limitBytes: number): Promise<unknown> => {
  const body = await readBody(request, limitBytes);

  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new FilesystemError("INVALID_JSON", "Request body must be valid JSON.");
  }
};

const readBody = async (request: IncomingMessage, limitBytes: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let rejected = false;

    request.on("data", (chunk: Buffer) => {
      if (rejected) {
        return;
      }

      byteLength += chunk.byteLength;
      if (byteLength > limitBytes) {
        rejected = true;
        reject(new UploadHttpError("UPLOAD_CHUNK_TOO_LARGE", "Request body is too large.", 413));
        return;
      }

      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const readContentLength = (request: IncomingMessage): number | undefined => {
  const rawValue = request.headers["content-length"];
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const ensurePathAvailable = async (targetPath: string): Promise<void> => {
  try {
    await lstat(targetPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  throw new FilesystemError("PATH_EXISTS", "An item with that name already exists.");
};

const applyUpdatedAt = async (targetPath: string, rawUpdatedAt: string | undefined): Promise<void> => {
  if (rawUpdatedAt === undefined) {
    return;
  }

  const updatedAt = new Date(rawUpdatedAt);
  if (!Number.isNaN(updatedAt.getTime())) {
    await utimes(targetPath, updatedAt, updatedAt);
  }
};

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, {
    ...filesystemUploadCorsHeaders,
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
};

const sendUploadError = (response: ServerResponse, error: unknown): void => {
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : undefined);
    return;
  }

  if (error instanceof UploadHttpError) {
    sendJson(response, error.status, { code: error.code, message: error.message });
    return;
  }

  const filesystemError = toFilesystemError(error);
  const status = filesystemError.code === "PATH_NOT_FOUND" || filesystemError.code === "UPLOAD_NOT_FOUND"
    ? 404
    : 400;
  sendJson(response, status, { code: filesystemError.code, message: filesystemError.message });
};

class UploadHttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const getPathDepth = (relativePath: string): number =>
  relativePath.split("/").length;

const isNodeError = (value: unknown): value is NodeJS.ErrnoException =>
  value instanceof Error && "code" in value;
