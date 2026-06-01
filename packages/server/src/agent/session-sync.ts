import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { logger, errorToLog } from "../shared/logger.js";

export type AgentSessionSyncHarness = "codex" | "pi";

export interface AgentSessionSyncFile {
  readonly harness: AgentSessionSyncHarness;
  readonly nativeThreadId: string;
  readonly threadId: string;
  readonly path: string;
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly sourceMtime: Date;
  readonly sourcePath: string;
  readonly sourceCreatedAt: Date | null;
  readonly sourceUpdatedAt: Date;
}

export interface DiscoverAgentSessionFilesOptions {
  readonly home?: string;
  readonly codexHome?: string;
  readonly now?: Date;
  readonly stableFileAgeMs?: number;
}

export interface StartAgentSessionStartupSyncOptions extends AgentSessionSyncOnceOptions {
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

export interface AgentSessionSyncOnceOptions {
  readonly cloudServerPublicUrl: string;
  readonly tokenFile: string;
  readonly home?: string;
  readonly codexHome?: string;
  readonly stableFileAgeMs?: number;
  readonly tokenWaitTimeoutMs?: number;
  readonly tokenWaitIntervalMs?: number;
  readonly fetchFn?: typeof fetch;
}

export interface AgentSessionSyncResult {
  readonly status: "synced" | "disabled";
  readonly discoveredCount: number;
  readonly uploadedCount: number;
  readonly skippedCount: number;
}

interface SyncPlanResponse {
  readonly uploads?: readonly SyncPlanUpload[];
}

interface SyncPlanUpload {
  readonly harness?: unknown;
  readonly nativeThreadId?: unknown;
  readonly sha256?: unknown;
}

const DEFAULT_STABLE_FILE_AGE_MS = 5_000;
const DEFAULT_TOKEN_WAIT_TIMEOUT_MS = 60_000;
const DEFAULT_TOKEN_WAIT_INTERVAL_MS = 1_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 10_000;

export const startAgentSessionStartupSync = (options: StartAgentSessionStartupSyncOptions): void => {
  void runAgentSessionStartupSync(options).catch((error) => {
    logger.warn({
      event: "agent_sessions.sync.gave_up",
      err: errorToLog(error),
    }, "Agent session startup sync gave up");
  });
};

export const runAgentSessionStartupSync = async (
  options: StartAgentSessionStartupSyncOptions,
): Promise<AgentSessionSyncResult> => {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await syncAgentSessionsOnce(options);
      logger.info({
        event: "agent_sessions.sync.complete",
        status: result.status,
        discoveredCount: result.discoveredCount,
        uploadedCount: result.uploadedCount,
        skippedCount: result.skippedCount,
      }, "Agent session startup sync finished");
      return result;
    } catch (error) {
      lastError = error;
      logger.warn({
        event: "agent_sessions.sync.failed",
        attempt,
        maxAttempts,
        err: errorToLog(error),
      }, "Agent session startup sync failed");

      if (attempt < maxAttempts) {
        await delay(retryDelayMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Agent session startup sync failed");
};

export const syncAgentSessionsOnce = async (
  options: AgentSessionSyncOnceOptions,
): Promise<AgentSessionSyncResult> => {
  const fetchFn = options.fetchFn ?? fetch;
  const token = await readMachineTokenWithWait(options.tokenFile, {
    timeoutMs: options.tokenWaitTimeoutMs ?? DEFAULT_TOKEN_WAIT_TIMEOUT_MS,
    intervalMs: options.tokenWaitIntervalMs ?? DEFAULT_TOKEN_WAIT_INTERVAL_MS,
  });
  const files = await discoverAgentSessionFiles(options);

  if (files.length === 0) {
    return {
      status: "synced",
      discoveredCount: 0,
      uploadedCount: 0,
      skippedCount: 0,
    };
  }

  const planResponse = await fetchFn(buildCloudUrl(options.cloudServerPublicUrl, "/machines/agent-sessions/sync-plan"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      files: files.map((file) => ({
        harness: file.harness,
        nativeThreadId: file.nativeThreadId,
        threadId: file.threadId,
        relativePath: file.relativePath,
        sizeBytes: file.sizeBytes,
        sourceMtime: file.sourceMtime.toISOString(),
        sha256: file.sha256,
      })),
    }),
  });

  if (isStorageDisabledResponse(planResponse)) {
    return {
      status: "disabled",
      discoveredCount: files.length,
      uploadedCount: 0,
      skippedCount: files.length,
    };
  }

  await assertOkResponse(planResponse, "Agent session sync plan failed");
  const plan = await planResponse.json() as SyncPlanResponse;
  const requestedUploads = new Set(readPlanUploads(plan).map(uploadKey));
  let uploadedCount = 0;

  for (const file of files) {
    if (!requestedUploads.has(uploadKey(file))) {
      continue;
    }

    const uploadResponse = await uploadAgentSessionFile({
      cloudServerPublicUrl: options.cloudServerPublicUrl,
      token,
      file,
      fetchFn,
    });

    if (isStorageDisabledResponse(uploadResponse)) {
      return {
        status: "disabled",
        discoveredCount: files.length,
        uploadedCount,
        skippedCount: files.length - uploadedCount,
      };
    }

    await assertOkResponse(uploadResponse, "Agent session file upload failed");
    uploadedCount += uploadResponse.status === 201 ? 1 : 0;
  }

  return {
    status: "synced",
    discoveredCount: files.length,
    uploadedCount,
    skippedCount: files.length - requestedUploads.size,
  };
};

export const discoverAgentSessionFiles = async (
  options: DiscoverAgentSessionFilesOptions = {},
): Promise<AgentSessionSyncFile[]> => {
  const home = options.home?.trim() || homedir();
  const codexHome = options.codexHome?.trim() || join(home, ".codex");
  const now = options.now ?? new Date();
  const stableFileAgeMs = options.stableFileAgeMs ?? DEFAULT_STABLE_FILE_AGE_MS;
  const [codexFiles, piFiles] = await Promise.all([
    discoverHarnessFiles({
      harness: "codex",
      root: join(codexHome, "sessions"),
      now,
      stableFileAgeMs,
    }),
    discoverHarnessFiles({
      harness: "pi",
      root: join(home, ".pi", "agent", "sessions"),
      now,
      stableFileAgeMs,
    }),
  ]);

  return [...codexFiles, ...piFiles]
    .sort((left, right) => right.sourceMtime.getTime() - left.sourceMtime.getTime());
};

export const readMachineTokenWithWait = async (
  tokenFile: string,
  options: {
    readonly timeoutMs: number;
    readonly intervalMs: number;
  },
): Promise<string> => {
  const deadline = Date.now() + options.timeoutMs;

  while (true) {
    try {
      const token = (await readFile(tokenFile, "utf8")).trim();

      if (token.length > 0) {
        return token;
      }
    } catch {
      // Registration may still be exchanging the bootstrap token for a machine token.
    }

    if (Date.now() >= deadline) {
      throw new Error(`Machine token file is not ready: ${tokenFile}`);
    }

    await delay(options.intervalMs);
  }
};

const discoverHarnessFiles = async (input: {
  readonly harness: AgentSessionSyncHarness;
  readonly root: string;
  readonly now: Date;
  readonly stableFileAgeMs: number;
}): Promise<AgentSessionSyncFile[]> => {
  const paths = await findJsonlFiles(input.root);
  const files = await Promise.all(paths.map((path) => readSessionFile(path, input)));

  return files.filter((file): file is AgentSessionSyncFile => file !== null);
};

const findJsonlFiles = async (root: string): Promise<string[]> => {
  let entries;

  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      return findJsonlFiles(path);
    }

    return entry.isFile() && entry.name.endsWith(".jsonl") ? [path] : [];
  }));

  return files.flat();
};

const readSessionFile = async (
  path: string,
  input: {
    readonly harness: AgentSessionSyncHarness;
    readonly root: string;
    readonly now: Date;
    readonly stableFileAgeMs: number;
  },
): Promise<AgentSessionSyncFile | null> => {
  try {
    const before = await stat(path);

    if (input.now.getTime() - before.mtimeMs < input.stableFileAgeMs) {
      return null;
    }

    const firstLine = await readFirstLine(path);
    const firstRecord = parseJsonRecord(firstLine);
    const nativeThreadId = input.harness === "codex"
      ? readCodexThreadId(firstRecord, path)
      : readPiThreadId(firstRecord);

    if (nativeThreadId === null) {
      return null;
    }

    const sha256 = await hashFile(path);
    const after = await stat(path);

    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      return null;
    }

    const sourceCreatedAt = readSourceCreatedAt(firstRecord);
    const sourceMtime = after.mtime;

    return {
      harness: input.harness,
      nativeThreadId,
      threadId: input.harness === "pi" ? `pi:${encodeURIComponent(nativeThreadId)}` : nativeThreadId,
      path,
      relativePath: relative(input.root, path),
      sizeBytes: after.size,
      sha256,
      sourceMtime,
      sourcePath: path,
      sourceCreatedAt,
      sourceUpdatedAt: sourceMtime,
    };
  } catch (error) {
    logger.warn({
      event: "agent_sessions.file_skipped",
      path,
      err: errorToLog(error),
    }, "Skipping unreadable agent session file");
    return null;
  }
};

const readFirstLine = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const stream = createReadStream(path, { encoding: "utf8" });
    let buffer = "";

    stream.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");

      if (newlineIndex !== -1) {
        stream.destroy();
        resolve(buffer.slice(0, newlineIndex));
      }
    });
    stream.once("error", reject);
    stream.once("end", () => resolve(buffer));
  });

const hashFile = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });

const parseJsonRecord = (line: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(line) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const readCodexThreadId = (record: Record<string, unknown> | null, path: string): string | null => {
  const payload = readRecord(record?.["payload"]);
  const payloadId = readString(payload?.["id"]);

  if (record?.["type"] === "session_meta" && payloadId !== null) {
    return payloadId;
  }

  const filenameMatch = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/iu
    .exec(path);
  return filenameMatch?.[1] ?? null;
};

const readPiThreadId = (record: Record<string, unknown> | null): string | null => {
  const id = readString(record?.["id"]);
  return record?.["type"] === "session" ? id : null;
};

const readSourceCreatedAt = (record: Record<string, unknown> | null): Date | null => {
  const payload = readRecord(record?.["payload"]);
  const rawTimestamp = readString(payload?.["timestamp"]) ?? readString(record?.["timestamp"]);

  if (rawTimestamp === null) {
    return null;
  }

  const timestamp = new Date(rawTimestamp);
  return Number.isFinite(timestamp.getTime()) ? timestamp : null;
};

const readRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const uploadAgentSessionFile = async (input: {
  readonly cloudServerPublicUrl: string;
  readonly token: string;
  readonly file: AgentSessionSyncFile;
  readonly fetchFn: typeof fetch;
}): Promise<Response> => {
  const url = new URL(buildCloudUrl(input.cloudServerPublicUrl, "/machines/agent-sessions/objects"));
  url.searchParams.set("harness", input.file.harness);
  url.searchParams.set("nativeThreadId", input.file.nativeThreadId);
  url.searchParams.set("threadId", input.file.threadId);
  url.searchParams.set("sha256", input.file.sha256);
  url.searchParams.set("sizeBytes", String(input.file.sizeBytes));
  url.searchParams.set("sourceMtime", input.file.sourceMtime.toISOString());
  url.searchParams.set("sourcePath", input.file.sourcePath);
  url.searchParams.set("relativePath", input.file.relativePath);

  if (input.file.sourceCreatedAt !== null) {
    url.searchParams.set("sourceCreatedAt", input.file.sourceCreatedAt.toISOString());
  }

  url.searchParams.set("sourceUpdatedAt", input.file.sourceUpdatedAt.toISOString());

  return input.fetchFn(url, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/x-ndjson",
      "content-length": String(input.file.sizeBytes),
    },
    body: createReadStream(input.file.path) as unknown as RequestInit["body"],
    duplex: "half",
  } as RequestInit & { readonly duplex: "half" });
};

const readPlanUploads = (plan: SyncPlanResponse): SyncPlanUploadKey[] => {
  if (!Array.isArray(plan.uploads)) {
    return [];
  }

  return plan.uploads.flatMap((upload) => {
    if (
      (upload.harness === "codex" || upload.harness === "pi") &&
      typeof upload.nativeThreadId === "string" &&
      typeof upload.sha256 === "string"
    ) {
      return [{
        harness: upload.harness,
        nativeThreadId: upload.nativeThreadId,
        sha256: upload.sha256,
      }];
    }

    return [];
  });
};

interface SyncPlanUploadKey {
  readonly harness: AgentSessionSyncHarness;
  readonly nativeThreadId: string;
  readonly sha256: string;
}

const uploadKey = (input: SyncPlanUploadKey): string =>
  `${input.harness}:${input.nativeThreadId}:${input.sha256}`;

const buildCloudUrl = (cloudServerPublicUrl: string, path: string): string =>
  `${cloudServerPublicUrl.trim().replace(/\/+$/u, "")}${path}`;

const isStorageDisabledResponse = (response: Response): boolean =>
  response.status === 503;

const assertOkResponse = async (response: Response, fallbackMessage: string): Promise<void> => {
  if (response.ok) {
    return;
  }

  let message = fallbackMessage;

  try {
    const body = await response.json() as { readonly error?: { readonly message?: string } };
    message = body.error?.message ?? message;
  } catch {
    // Keep fallback.
  }

  throw new Error(`${message} (${String(response.status)})`);
};
