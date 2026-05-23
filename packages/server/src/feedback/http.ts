import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { arch, homedir, platform, tmpdir } from "node:os";
import { join, relative } from "node:path";

import { ZipFile } from "yazl";

const SNAPSHOT_PATH = "/feedback/snapshot";
const MAX_COMMENT_LENGTH = 5_000;

export interface FeedbackHttpService {
  readonly handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
}

export const createFeedbackHttpService = (options: {
  readonly version: string;
}): FeedbackHttpService => ({
  handleRequest: async (request, response) => handleFeedbackHttpRequest(request, response, options),
});

export const createFeedbackSnapshotArchive = async (input: {
  readonly feedbackId: string;
  readonly comment: string;
  readonly threadId?: string | null;
  readonly cwd?: string | null;
  readonly createdAt?: string | null;
  readonly machineServerVersion: string;
  readonly now?: Date;
}): Promise<{
  readonly archivePath: string;
  readonly archiveBytes: number;
  readonly archiveSha256: string;
  readonly fileCount: number;
  readonly machineContext: Record<string, unknown>;
}> => {
  const now = input.now ?? new Date();
  const codexHome = resolveCodexHome();
  const sessionsPath = join(codexHome, "sessions");
  const collected = await collectSessionFiles(sessionsPath);
  const archivePath = join(tmpdir(), `heysnap-feedback-${input.feedbackId}-${randomUUID()}.zip`);
  await mkdir(tmpdir(), { recursive: true });

  const manifest = {
    version: 1,
    feedbackId: input.feedbackId,
    comment: input.comment,
    threadId: input.threadId ?? null,
    cwd: input.cwd ?? null,
    createdAt: input.createdAt ?? null,
    snapshotCreatedAt: now.toISOString(),
    machine: {
      machineServerVersion: input.machineServerVersion,
      computerId: process.env.ANK1015_COMPUTER_ID ?? null,
      platform: platform(),
      arch: arch(),
      nodeVersion: process.version,
    },
    codex: {
      codexHome,
      sessionsPath,
      sessionsPresent: collected.sessionsPresent,
    },
    archive: {
      format: "zip",
      fileCount: collected.files.length,
      totalSessionBytes: collected.totalBytes,
      skippedSymlinks: collected.skippedSymlinks,
      hashAlgorithm: "sha256",
      hashInput: "final zip bytes",
    },
    files: collected.files.map((file) => ({
      path: file.zipPath,
      bytes: file.size,
      modifiedAt: file.mtime.toISOString(),
    })),
  };

  await writeZipArchive(archivePath, collected.files, manifest, now);
  const archiveBytes = (await stat(archivePath)).size;
  const archiveSha256 = await sha256File(archivePath);
  const machineContext = {
    machineServerVersion: input.machineServerVersion,
    codexHome,
    sessionsPath,
    sessionsPresent: collected.sessionsPresent,
    fileCount: collected.files.length,
    totalSessionBytes: collected.totalBytes,
    skippedSymlinks: collected.skippedSymlinks,
    archiveBytes,
    archiveSha256,
    snapshotCreatedAt: now.toISOString(),
  };

  return {
    archivePath,
    archiveBytes,
    archiveSha256,
    fileCount: collected.files.length,
    machineContext,
  };
};

const handleFeedbackHttpRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    readonly version: string;
  },
): Promise<boolean> => {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (requestUrl.pathname !== SNAPSHOT_PATH) {
    return false;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  let snapshot: Awaited<ReturnType<typeof createFeedbackSnapshotArchive>> | null = null;

  try {
    const body = await readJsonBody(request);
    const feedbackId = requiredString(body, "feedbackId", 120);
    const comment = requiredString(body, "comment", MAX_COMMENT_LENGTH);
    const threadId = optionalString(body, "threadId", 240);
    const cwd = optionalString(body, "cwd", 4_096);
    const createdAt = optionalString(body, "createdAt", 120);

    snapshot = await createFeedbackSnapshotArchive({
      feedbackId,
      comment,
      threadId,
      cwd,
      createdAt,
      machineServerVersion: options.version,
    });

    await uploadFeedbackArchive({
      feedbackId,
      archivePath: snapshot.archivePath,
      archiveBytes: snapshot.archiveBytes,
      archiveSha256: snapshot.archiveSha256,
      fileCount: snapshot.fileCount,
      machineContext: snapshot.machineContext,
    });

    sendJson(response, 200, {
      ok: true,
      archive: {
        bytes: snapshot.archiveBytes,
        sha256: snapshot.archiveSha256,
        fileCount: snapshot.fileCount,
      },
    });
  } catch (error) {
    const status = error instanceof FeedbackSnapshotError ? error.status : 500;
    sendJson(response, status, {
      error: error instanceof Error ? error.message : "Feedback snapshot failed",
    });
  } finally {
    if (snapshot !== null) {
      await rm(snapshot.archivePath, { force: true }).catch(() => undefined);
    }
  }

  return true;
};

const uploadFeedbackArchive = async (input: {
  readonly feedbackId: string;
  readonly archivePath: string;
  readonly archiveBytes: number;
  readonly archiveSha256: string;
  readonly fileCount: number;
  readonly machineContext: Record<string, unknown>;
}): Promise<void> => {
  const cloudServerPublicUrl = process.env.CLOUD_SERVER_PUBLIC_URL?.trim();
  const tokenFile = process.env.ANK1015_MACHINE_TOKEN_FILE?.trim();

  if (cloudServerPublicUrl === undefined || cloudServerPublicUrl.length === 0) {
    throw new FeedbackSnapshotError(503, "CLOUD_SERVER_PUBLIC_URL is not configured");
  }

  if (tokenFile === undefined || tokenFile.length === 0) {
    throw new FeedbackSnapshotError(503, "ANK1015_MACHINE_TOKEN_FILE is not configured");
  }

  let token: string;
  try {
    token = (await readFile(tokenFile, "utf8")).trim();
  } catch {
    throw new FeedbackSnapshotError(503, "Machine token file could not be read");
  }

  if (token.length === 0) {
    throw new FeedbackSnapshotError(503, "Machine token file is empty");
  }

  const uploadUrl = new URL(`/machines/feedback/${encodeURIComponent(input.feedbackId)}/archive`, cloudServerPublicUrl);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/zip",
      "content-length": String(input.archiveBytes),
      "x-heysnap-feedback-sha256": input.archiveSha256,
      "x-heysnap-feedback-file-count": String(input.fileCount),
      "x-heysnap-feedback-machine-context": Buffer.from(JSON.stringify(input.machineContext), "utf8").toString("base64"),
    },
    body: createReadStream(input.archivePath) as unknown as RequestInit["body"],
    duplex: "half",
  } as RequestInit & { readonly duplex: "half" });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new FeedbackSnapshotError(
      response.status,
      message.trim().length > 0 ? message.trim().slice(0, 1_000) : "Feedback archive upload failed",
    );
  }
};

const collectSessionFiles = async (sessionsPath: string): Promise<{
  readonly sessionsPresent: boolean;
  readonly files: readonly SessionArchiveFile[];
  readonly totalBytes: number;
  readonly skippedSymlinks: number;
}> => {
  try {
    const rootStats = await lstat(sessionsPath);

    if (rootStats.isSymbolicLink()) {
      return { sessionsPresent: false, files: [], totalBytes: 0, skippedSymlinks: 1 };
    }

    if (!rootStats.isDirectory()) {
      return { sessionsPresent: false, files: [], totalBytes: 0, skippedSymlinks: 0 };
    }
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return { sessionsPresent: false, files: [], totalBytes: 0, skippedSymlinks: 0 };
    }
    throw error;
  }

  const files: SessionArchiveFile[] = [];
  const counters = { totalBytes: 0, skippedSymlinks: 0 };
  await collectSessionFilesRecursive(sessionsPath, sessionsPath, files, counters);

  return {
    sessionsPresent: true,
    files,
    totalBytes: counters.totalBytes,
    skippedSymlinks: counters.skippedSymlinks,
  };
};

const collectSessionFilesRecursive = async (
  rootPath: string,
  directoryPath: string,
  files: SessionArchiveFile[],
  counters: {
    totalBytes: number;
    skippedSymlinks: number;
  },
): Promise<void> => {
  const children = await readdir(directoryPath, { withFileTypes: true });

  for (const child of children) {
    const childPath = join(directoryPath, child.name);

    if (child.isSymbolicLink()) {
      counters.skippedSymlinks += 1;
      continue;
    }

    if (child.isDirectory()) {
      await collectSessionFilesRecursive(rootPath, childPath, files, counters);
      continue;
    }

    const childStats = await lstat(childPath);

    if (!childStats.isFile()) {
      continue;
    }

    counters.totalBytes += childStats.size;
    files.push({
      absolutePath: childPath,
      zipPath: toZipPath(join("sessions", relative(rootPath, childPath))),
      size: childStats.size,
      mtime: childStats.mtime,
    });
  }
};

const writeZipArchive = async (
  archivePath: string,
  files: readonly SessionArchiveFile[],
  manifest: unknown,
  timestamp: Date,
): Promise<void> => {
  const zip = new ZipFile();
  const output = createWriteStream(archivePath);
  const finished = new Promise<void>((resolveFinished, rejectFinished) => {
    output.on("finish", resolveFinished);
    output.on("error", rejectFinished);
    zip.outputStream.on("error", rejectFinished);
  });

  zip.outputStream.pipe(output);
  zip.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"), "feedback.json", {
    mtime: timestamp,
    mode: 0o100644,
    compress: false,
  });

  for (const file of files) {
    zip.addFile(file.absolutePath, file.zipPath, {
      mtime: file.mtime,
      mode: 0o100644,
    });
  }

  zip.end();
  await finished;
};

const sha256File = async (path: string): Promise<string> => {
  const hash = createHash("sha256");
  const stream = createReadStream(path);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
};

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Request body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new FeedbackSnapshotError(400, "Request body must be valid JSON");
  }
};

const requiredString = (body: Record<string, unknown>, key: string, maxLength: number): string => {
  const value = body[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FeedbackSnapshotError(400, `${key} is required`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new FeedbackSnapshotError(400, `${key} is too long`);
  }

  return trimmed;
};

const optionalString = (
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null => {
  const value = body[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new FeedbackSnapshotError(400, `${key} must be a string`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new FeedbackSnapshotError(400, `${key} is too long`);
  }

  return trimmed.length === 0 ? null : trimmed;
};

const resolveCodexHome = (): string =>
  process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");

const toZipPath = (path: string): string => path.split(/[\\/]/u).join("/");

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
};

const isNodeErrorWithCode = (error: unknown, code: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { readonly code?: unknown }).code === code;

interface SessionArchiveFile {
  readonly absolutePath: string;
  readonly zipPath: string;
  readonly size: number;
  readonly mtime: Date;
}

class FeedbackSnapshotError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FeedbackSnapshotError";
  }
}
