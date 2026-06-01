import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

import { Hono } from "hono";

import type { CloudServerConfig } from "../config.js";
import type { AgentSessionHarness, CloudStore, MachineIdentityRecord } from "../db/types.js";
import { authenticateMachineBearer } from "../machines/auth.js";
import { badRequest, notFound, serviceUnavailable } from "../shared/errors.js";
import { readJsonBody } from "../shared/validation.js";
import type { AgentSessionObjectStorage } from "./storage.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_MANIFEST_FILES = 10_000;
const DEFAULT_STORAGE_PREFIX = "agent-sessions/";
const DEFAULT_MAX_FILE_BYTES = 536_870_912;
const JSONL_CONTENT_TYPE = "application/x-ndjson";

export const createAgentSessionMachineRoutes = (
  store: CloudStore,
  config: CloudServerConfig,
  storage: AgentSessionObjectStorage | undefined,
): Hono => {
  const app = new Hono();

  app.post("/sync-plan", async (context) => {
    requireStorage(storage);
    const machine = await authenticateMachineBearer(store, config, context.req.header("authorization"));
    const computer = await readMachineComputer(store, machine);
    const body = await readJsonBody(context.req.raw);
    const files = readManifestFiles(body["files"]);
    const uploads = [];

    for (const file of files) {
      const existing = await store.getAgentSessionVersionByContent({
        computerId: computer.id,
        harness: file.harness,
        nativeThreadId: file.nativeThreadId,
        sha256: file.sha256,
      });

      if (existing === null) {
        uploads.push({
          harness: file.harness,
          nativeThreadId: file.nativeThreadId,
          threadId: file.threadId,
          sha256: file.sha256,
        });
      }
    }

    return context.json({
      uploads,
      knownCount: files.length - uploads.length,
      uploadCount: uploads.length,
    });
  });

  app.put("/objects", async (context) => {
    const objectStorage = requireStorage(storage);
    const machine = await authenticateMachineBearer(store, config, context.req.header("authorization"));
    const computer = await readMachineComputer(store, machine);
    const metadata = readUploadMetadata(context.req.raw);
    const contentLength = readContentLength(context.req.raw);
    const maxFileBytes = config.agentSessionMaxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

    if (contentLength !== undefined && contentLength > maxFileBytes) {
      throw badRequest("AGENT_SESSION_FILE_TOO_LARGE", "Agent session file is too large");
    }

    const temp = await writeRequestBodyToTempFile(context.req.raw, maxFileBytes);

    try {
      if (temp.sizeBytes !== metadata.sizeBytes) {
        throw badRequest("AGENT_SESSION_SIZE_MISMATCH", "Agent session upload size does not match metadata");
      }

      if (temp.sha256 !== metadata.sha256) {
        throw badRequest("AGENT_SESSION_SHA_MISMATCH", "Agent session upload sha256 does not match metadata");
      }

      const existing = await store.getAgentSessionVersionByContent({
        computerId: computer.id,
        harness: metadata.harness,
        nativeThreadId: metadata.nativeThreadId,
        sha256: metadata.sha256,
      });

      if (existing !== null) {
        return context.json({
          uploaded: false,
          version: serializeVersionSummary(existing),
        });
      }

      const objectKey = buildAgentSessionObjectKey({
        prefix: config.agentSessionStoragePrefix ?? DEFAULT_STORAGE_PREFIX,
        userId: computer.ownerUserId,
        computerId: computer.id,
        harness: metadata.harness,
        nativeThreadId: metadata.nativeThreadId,
        sha256: metadata.sha256,
      });

      await objectStorage.putObject({
        key: objectKey,
        filePath: temp.filePath,
        sizeBytes: temp.sizeBytes,
        contentType: JSONL_CONTENT_TYPE,
        metadata: {
          userId: computer.ownerUserId,
          computerId: computer.id,
          harness: metadata.harness,
          sha256: metadata.sha256,
        },
      });

      const result = await store.upsertAgentSessionUpload({
        userId: computer.ownerUserId,
        computerId: computer.id,
        machineIdentityId: machine.id,
        harness: metadata.harness,
        nativeThreadId: metadata.nativeThreadId,
        threadId: metadata.threadId,
        sha256: metadata.sha256,
        objectBucket: objectStorage.bucket,
        objectKey,
        sizeBytes: temp.sizeBytes,
        sourceMtime: metadata.sourceMtime,
        sourcePath: metadata.sourcePath,
        relativePath: metadata.relativePath,
        sourceCreatedAt: metadata.sourceCreatedAt,
        sourceUpdatedAt: metadata.sourceUpdatedAt,
        metadata: metadata.metadata,
      });

      return context.json({
        uploaded: result.created,
        thread: serializeThreadSummary(result.thread),
        version: serializeVersionSummary(result.version),
      }, result.created ? 201 : 200);
    } finally {
      await rm(temp.directory, { recursive: true, force: true });
    }
  });

  return app;
};

export const buildAgentSessionObjectKey = (input: {
  readonly prefix: string;
  readonly userId: string;
  readonly computerId: string;
  readonly harness: AgentSessionHarness;
  readonly nativeThreadId: string;
  readonly sha256: string;
}): string => {
  const encodedThreadId = encodeURIComponent(input.nativeThreadId);
  return `${input.prefix}users/${input.userId}/computers/${input.computerId}/${input.harness}/threads/${encodedThreadId}/sha256/${input.sha256}.jsonl`;
};

const requireStorage = (
  storage: AgentSessionObjectStorage | undefined,
): AgentSessionObjectStorage => {
  if (storage === undefined) {
    throw serviceUnavailable(
      "AGENT_SESSION_STORAGE_DISABLED",
      "Agent session storage is not configured",
    );
  }

  return storage;
};

const readMachineComputer = async (store: CloudStore, machine: MachineIdentityRecord) => {
  const computer = await store.getComputerById(machine.computerId);

  if (computer === null) {
    throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
  }

  return computer;
};

const readManifestFiles = (value: unknown): ManifestFile[] => {
  if (!Array.isArray(value)) {
    throw badRequest("INVALID_BODY", "files must be an array");
  }

  if (value.length > MAX_MANIFEST_FILES) {
    throw badRequest("AGENT_SESSION_MANIFEST_TOO_LARGE", "Agent session manifest has too many files");
  }

  return value.map((entry, index) => readManifestFile(entry, `files[${String(index)}]`));
};

interface ManifestFile {
  readonly harness: AgentSessionHarness;
  readonly nativeThreadId: string;
  readonly threadId: string;
  readonly sha256: string;
}

const readManifestFile = (value: unknown, label: string): ManifestFile => {
  const record = readRecord(value, label);
  return {
    harness: readHarness(record["harness"], `${label}.harness`),
    nativeThreadId: readString(record["nativeThreadId"], `${label}.nativeThreadId`, 1, 500),
    threadId: readString(record["threadId"], `${label}.threadId`, 1, 800),
    sha256: readSha256(record["sha256"], `${label}.sha256`),
  };
};

interface UploadMetadata {
  readonly harness: AgentSessionHarness;
  readonly nativeThreadId: string;
  readonly threadId: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly sourceMtime: Date;
  readonly sourcePath: string | null;
  readonly relativePath: string;
  readonly sourceCreatedAt: Date | null;
  readonly sourceUpdatedAt: Date | null;
  readonly metadata: Record<string, unknown>;
}

const readUploadMetadata = (request: Request): UploadMetadata => {
  const url = new URL(request.url);
  return {
    harness: readHarness(url.searchParams.get("harness"), "harness"),
    nativeThreadId: readString(url.searchParams.get("nativeThreadId"), "nativeThreadId", 1, 500),
    threadId: readString(url.searchParams.get("threadId"), "threadId", 1, 800),
    sha256: readSha256(url.searchParams.get("sha256"), "sha256"),
    sizeBytes: readPositiveInteger(url.searchParams.get("sizeBytes"), "sizeBytes"),
    sourceMtime: readDate(url.searchParams.get("sourceMtime"), "sourceMtime"),
    sourcePath: readOptionalString(url.searchParams.get("sourcePath"), "sourcePath", 2000),
    relativePath: readString(url.searchParams.get("relativePath"), "relativePath", 1, 1200),
    sourceCreatedAt: readOptionalDate(url.searchParams.get("sourceCreatedAt"), "sourceCreatedAt"),
    sourceUpdatedAt: readOptionalDate(url.searchParams.get("sourceUpdatedAt"), "sourceUpdatedAt"),
    metadata: {},
  };
};

const writeRequestBodyToTempFile = async (
  request: Request,
  maxBytes: number,
): Promise<{
  readonly directory: string;
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}> => {
  const directory = await mkdtemp(join(tmpdir(), "heysnap-agent-session-"));
  const filePath = join(directory, "session.jsonl");
  const stream = createWriteStream(filePath, { flags: "wx" });
  const hash = createHash("sha256");
  let sizeBytes = 0;

  try {
    if (request.body !== null) {
      const reader = request.body.getReader();

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        sizeBytes += value.byteLength;

        if (sizeBytes > maxBytes) {
          throw badRequest("AGENT_SESSION_FILE_TOO_LARGE", "Agent session file is too large");
        }

        hash.update(value);

        if (!stream.write(Buffer.from(value))) {
          await once(stream, "drain");
        }
      }
    }

    await new Promise<void>((resolve, reject) => {
      stream.once("error", reject);
      stream.end(resolve);
    });

    return {
      directory,
      filePath,
      sizeBytes,
      sha256: hash.digest("hex"),
    };
  } catch (error) {
    stream.destroy();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};

const readContentLength = (request: Request): number | undefined => {
  const raw = request.headers.get("content-length");

  if (raw === null) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const readRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("INVALID_BODY", `${label} must be an object`);
  }

  return value as Record<string, unknown>;
};

const readHarness = (value: unknown, label: string): AgentSessionHarness => {
  if (value !== "codex" && value !== "pi") {
    throw badRequest("INVALID_BODY", `${label} must be codex or pi`);
  }

  return value;
};

const readString = (
  value: unknown,
  label: string,
  minLength: number,
  maxLength: number,
): string => {
  if (typeof value !== "string") {
    throw badRequest("INVALID_BODY", `${label} must be a string`);
  }

  const trimmed = value.trim();

  if (trimmed.length < minLength) {
    throw badRequest("INVALID_BODY", `${label} is required`);
  }

  if (trimmed.length > maxLength) {
    throw badRequest("INVALID_BODY", `${label} is too long`);
  }

  return trimmed;
};

const readOptionalString = (
  value: unknown,
  label: string,
  maxLength: number,
): string | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const trimmed = readString(value, label, 0, maxLength);
  return trimmed.length === 0 ? null : trimmed;
};

const readSha256 = (value: unknown, label: string): string => {
  const sha256 = readString(value, label, 64, 64).toLowerCase();

  if (!SHA256_PATTERN.test(sha256)) {
    throw badRequest("INVALID_BODY", `${label} must be a lowercase sha256 hex digest`);
  }

  return sha256;
};

const readPositiveInteger = (value: unknown, label: string): number => {
  const raw = readString(value, label, 1, 20);
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw badRequest("INVALID_BODY", `${label} must be a non-negative integer`);
  }

  return parsed;
};

const readDate = (value: unknown, label: string): Date => {
  const raw = readString(value, label, 1, 120);
  const date = new Date(raw);

  if (!Number.isFinite(date.getTime())) {
    throw badRequest("INVALID_BODY", `${label} must be a valid date`);
  }

  return date;
};

const readOptionalDate = (value: unknown, label: string): Date | null => {
  if (value === null || value === "") {
    return null;
  }

  return readDate(value, label);
};

const serializeThreadSummary = (thread: {
  readonly id: string;
  readonly threadId: string;
  readonly latestSha256: string | null;
}) => ({
  id: thread.id,
  threadId: thread.threadId,
  latestSha256: thread.latestSha256,
});

const serializeVersionSummary = (version: {
  readonly id: string;
  readonly sha256: string;
  readonly objectKey: string;
  readonly sizeBytes: number;
}) => ({
  id: version.id,
  sha256: version.sha256,
  objectKey: version.objectKey,
  sizeBytes: version.sizeBytes,
});
