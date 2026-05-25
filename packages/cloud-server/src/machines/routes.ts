import { createHash } from "node:crypto";

import { Hono } from "hono";

import { createOpaqueToken, hashToken } from "../auth/tokens.js";
import type { CloudServerConfig } from "../config.js";
import type { CloudStore, ComputerRecord, ComputerStatus } from "../db/types.js";
import { serializeFeedbackReport } from "../feedback/serialization.js";
import {
  buildFeedbackArchiveStorageKey,
  type FeedbackArchiveStorage,
} from "../feedback/storage.js";
import { authenticateMachineBearer } from "./auth.js";
import {
  buildReleaseCheckResponse,
  DEFAULT_RELEASE_CHANNEL,
  DEFAULT_RELEASE_PLATFORM,
} from "../releases/routes.js";
import { badRequest, forbidden, notFound, unauthorized } from "../shared/errors.js";
import { serializeComputer } from "../shared/serialization.js";
import { readJsonBody, stringField } from "../shared/validation.js";
import type { ComputerProvisioner } from "../provisioning/types.js";

export const createMachineRoutes = (
  store: CloudStore,
  config: CloudServerConfig,
  feedbackArchiveStorage: FeedbackArchiveStorage,
  provisioner: ComputerProvisioner,
): Hono => {
  const app = new Hono();

  app.post("/register", async (context) => {
    const body = await readJsonBody(context.req.raw);
    const computerId = stringField(body, "computerId", { required: true }) ?? "";
    const bootstrapToken = stringField(body, "bootstrapToken", { required: true }) ?? "";
    const machineServerVersion = stringField(body, "machineServerVersion", { maxLength: 120 }) ?? null;
    const bootstrapVersion = stringField(body, "bootstrapVersion", { maxLength: 120 }) ?? null;
    const capabilities = readCapabilities(body["capabilities"]);
    const bootstrapTokenHash = hashToken(bootstrapToken, config.sessionSecret);
    const identity = await store.getMachineIdentityByBootstrapTokenHash(bootstrapTokenHash);

    if (identity === null || identity.revokedAt !== null || identity.computerId !== computerId) {
      throw unauthorized("Invalid machine bootstrap token");
    }

    const machineToken = createOpaqueToken();
    const now = new Date();
    const activated = await store.activateMachineIdentity({
      identityId: identity.id,
      tokenHash: hashToken(machineToken, config.sessionSecret),
      activatedAt: now,
    });

    if (activated === null) {
      throw unauthorized("Invalid machine bootstrap token");
    }

    const computer = await store.updateComputerById({
      computerId,
      status: "online",
      capabilities,
      machineHealth: buildMachineHealth(body, {
        machineServerVersion,
        bootstrapVersion,
        reportedAt: now,
      }),
      machineServerVersion,
      lastHeartbeatAt: now,
    });

    if (computer === null) {
      throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
    }

    return context.json({
      machine: {
        computerId,
        token: machineToken,
        heartbeatIntervalSeconds: 30,
      },
      computer: serializeComputer(computer),
    }, 201);
  });

  app.post("/heartbeat", async (context) => {
    const machine = await authenticateMachineBearer(store, config, context.req.header("authorization"));
    const body = await readJsonBody(context.req.raw);
    const status = readMachineStatus(body["status"]);
    const capabilities = readCapabilities(body["capabilities"]);
    const machineServerVersion = stringField(body, "machineServerVersion", { maxLength: 120 }) ?? undefined;
    const bootstrapVersion = stringField(body, "bootstrapVersion", { maxLength: 120 }) ?? null;
    const now = new Date();
    await store.touchMachineIdentity({ identityId: machine.id, lastUsedAt: now });
    const existingComputer = await store.getComputerById(machine.computerId);

    if (existingComputer === null) {
      throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
    }

    const machineHealth = buildMachineHealth(body, {
      machineServerVersion: machineServerVersion ?? null,
      bootstrapVersion,
      reportedAt: now,
    }, existingComputer.machineHealth);
    const computer = await store.updateComputerById({
      computerId: machine.computerId,
      status: existingComputer.status === "sleeping" ? "sleeping" : status,
      capabilities,
      machineHealth,
      machineServerVersion,
      lastHeartbeatAt: now,
    });

    if (computer === null) {
      throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
    }

    const update = await buildMachineServerUpdate(store, {
      channel: DEFAULT_RELEASE_CHANNEL,
      currentVersion: machineServerVersion ?? computer.machineServerVersion,
    });

    const autoSleptComputer = await maybeAutoSleepIdleComputer({
      store,
      provisioner,
      config,
      computer,
      machineHealth,
      now,
    });

    return context.json({ computer: serializeComputer(autoSleptComputer ?? computer), update });
  });

  app.get("/update-check", async (context) => {
    const machine = await authenticateMachineBearer(store, config, context.req.header("authorization"));
    const computer = await store.getComputerById(machine.computerId);

    if (computer === null) {
      throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
    }

    const update = await buildMachineServerUpdate(store, {
      channel: readQueryString(context.req.query("channel"), DEFAULT_RELEASE_CHANNEL) ?? DEFAULT_RELEASE_CHANNEL,
      currentVersion: readQueryString(context.req.query("currentVersion"), computer.machineServerVersion),
    });

    return context.json({
      computer: serializeComputer(computer),
      update,
    });
  });

  app.post("/feedback/:feedbackId/archive", async (context) => {
    const machine = await authenticateMachineBearer(store, config, context.req.header("authorization"));
    const feedbackId = context.req.param("feedbackId");
    const report = await store.getFeedbackReportById(feedbackId);

    if (report === null) {
      throw notFound("FEEDBACK_NOT_FOUND", "Feedback report not found");
    }

    if (report.computerId !== machine.computerId) {
      throw forbidden("Machine is not allowed to upload this feedback archive");
    }

    const contentType = context.req.header("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/zip")) {
      throw badRequest("INVALID_ARCHIVE", "Feedback archive must be application/zip");
    }

    const maxArchiveBytes = config.feedbackArchiveMaxBytes ?? 100 * 1024 * 1024;
    const contentLength = readContentLength(context.req.header("content-length"));
    if (contentLength !== null && contentLength > maxArchiveBytes) {
      await markFeedbackArchiveUploadFailed(store, feedbackId, "Feedback archive exceeded maximum upload size");
      return context.json({
        error: {
          code: "ARCHIVE_TOO_LARGE",
          message: "Feedback archive exceeded maximum upload size",
        },
      }, 413);
    }

    const archive = Buffer.from(await context.req.arrayBuffer());
    if (archive.byteLength > maxArchiveBytes) {
      await markFeedbackArchiveUploadFailed(store, feedbackId, "Feedback archive exceeded maximum upload size");
      return context.json({
        error: {
          code: "ARCHIVE_TOO_LARGE",
          message: "Feedback archive exceeded maximum upload size",
        },
      }, 413);
    }

    const computedSha256 = createHash("sha256").update(archive).digest("hex");
    const reportedSha256 = context.req.header("x-heysnap-feedback-sha256")?.trim().toLowerCase();
    if (reportedSha256 !== undefined && reportedSha256.length > 0 && reportedSha256 !== computedSha256) {
      await markFeedbackArchiveUploadFailed(store, feedbackId, "Feedback archive SHA-256 mismatch");
      throw badRequest("ARCHIVE_HASH_MISMATCH", "Feedback archive SHA-256 mismatch");
    }

    const fileCount = readNonNegativeIntegerHeader(context.req.header("x-heysnap-feedback-file-count"), "file count");
    const machineContext = readMachineContextHeader(context.req.header("x-heysnap-feedback-machine-context"));
    const archiveStorageKey = buildFeedbackArchiveStorageKey(config, {
      feedbackId,
      computerId: report.computerId,
    });

    try {
      await feedbackArchiveStorage.putArchive({
        key: archiveStorageKey,
        body: archive,
        contentType: "application/zip",
      });

      const completed = await store.completeFeedbackReportArchive({
        feedbackId,
        machineIdentityId: machine.id,
        archiveStorageKey,
        archiveSha256: computedSha256,
        archiveBytes: archive.byteLength,
        fileCount,
        machineContext,
      });

      if (completed === null) {
        throw notFound("FEEDBACK_NOT_FOUND", "Feedback report not found");
      }

      await store.touchMachineIdentity({ identityId: machine.id, lastUsedAt: new Date() });

      return context.json({ feedback: serializeFeedbackReport(completed) });
    } catch (error) {
      await markFeedbackArchiveUploadFailed(
        store,
        feedbackId,
        error instanceof Error ? error.message : "Failed to store feedback archive",
      );
      throw error;
    }
  });

  return app;
};

const readCapabilities = (value: unknown): string[] => {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return [];
  }

  return value;
};

const readMachineStatus = (value: unknown): Extract<ComputerStatus, "online" | "idle" | "failed"> => {
  if (value === "idle" || value === "failed") {
    return value;
  }

  return "online";
};

const VALID_UPDATE_STATES = new Set(["idle", "checking", "downloading", "installed", "deferred", "failed"]);

const buildMachineHealth = (
  body: Record<string, unknown>,
  fallback: {
    readonly machineServerVersion: string | null;
    readonly bootstrapVersion: string | null;
    readonly reportedAt: Date;
  },
  previousHealth?: unknown,
): Record<string, unknown> => {
  const previous = readObject(previousHealth) ?? {};
  const machineServerVersion = stringField(body, "machineServerVersion", { maxLength: 120 }) ??
    fallback.machineServerVersion;
  const bootstrapVersion = stringField(body, "bootstrapVersion", { maxLength: 120 }) ??
    fallback.bootstrapVersion;
  const updateState = typeof body["updateState"] === "string" && VALID_UPDATE_STATES.has(body["updateState"])
    ? body["updateState"]
    : undefined;
  const lastUpdateError = typeof body["lastUpdateError"] === "string"
    ? body["lastUpdateError"]
    : body["lastUpdateError"] === null ? null : undefined;
  const safeToRestart = typeof body["safeToRestart"] === "boolean" ? body["safeToRestart"] : undefined;
  const safeToSleep = typeof body["safeToSleep"] === "boolean" ? body["safeToSleep"] : undefined;
  const lastActivityAt = typeof body["lastActivityAt"] === "string" && body["lastActivityAt"].trim().length <= 120
    ? body["lastActivityAt"].trim()
    : undefined;
  const activeSessions = readActiveSessions(body["activeSessions"]);
  const heartbeatSafeToSleep = isMachineSafeToSleep({
    safeToSleep,
    safeToRestart,
    activeSessions,
  });
  const previousIdleSince = typeof previous["idleSince"] === "string" ? previous["idleSince"] : undefined;
  const idleSince = heartbeatSafeToSleep ? previousIdleSince ?? fallback.reportedAt.toISOString() : undefined;

  return {
    reportedAt: fallback.reportedAt.toISOString(),
    ...(machineServerVersion !== null ? { machineServerVersion } : {}),
    ...(bootstrapVersion !== null ? { bootstrapVersion } : {}),
    ...(safeToRestart !== undefined ? { safeToRestart } : {}),
    ...(safeToSleep !== undefined ? { safeToSleep } : {}),
    ...(lastActivityAt !== undefined ? { lastActivityAt } : {}),
    ...(activeSessions !== undefined ? { activeSessions } : {}),
    ...(idleSince !== undefined ? { idleSince } : {}),
    ...(updateState !== undefined ? { updateState } : {}),
    ...(lastUpdateError !== undefined ? { lastUpdateError } : {}),
  };
};

const readActiveSessions = (value: unknown): Record<string, unknown> | number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  return readObject(value);
};

const readObject = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
};

const maybeAutoSleepIdleComputer = async (
  input: {
    readonly store: CloudStore;
    readonly provisioner: ComputerProvisioner;
    readonly config: CloudServerConfig;
    readonly computer: ComputerRecord;
    readonly machineHealth: Record<string, unknown>;
    readonly now: Date;
  },
) => {
  const idleSleepSeconds = input.config.machineIdleSleepSeconds ?? 0;

  if (
    idleSleepSeconds <= 0 ||
    input.computer.kind !== "cloud" ||
    !["online", "idle"].includes(input.computer.status) ||
    !isMachineSafeToSleep(input.machineHealth)
  ) {
    return null;
  }

  const idleReference = readIsoDate(input.machineHealth["lastActivityAt"]) ??
    readIsoDate(input.machineHealth["idleSince"]);

  if (idleReference === null) {
    return null;
  }

  const idleMs = input.now.getTime() - idleReference.getTime();

  if (idleMs < idleSleepSeconds * 1000) {
    return null;
  }

  const idleSeconds = Math.max(0, Math.floor(idleMs / 1000));
  const autoSleep = {
    status: "requested",
    reason: "idle_timeout",
    requestedAt: input.now.toISOString(),
    idleSeconds,
    thresholdSeconds: idleSleepSeconds,
  };

  try {
    const providerMetadata = await input.provisioner.stopComputer(input.computer);
    return await input.store.updateComputerById({
      computerId: input.computer.id,
      status: "sleeping",
      providerMetadata,
      machineHealth: {
        ...input.machineHealth,
        autoSleep,
      },
    });
  } catch (error) {
    const failedAutoSleep = {
      ...autoSleep,
      status: "failed",
      error: error instanceof Error ? error.message : "Failed to stop idle computer",
    };
    console.error(`Failed to auto-sleep computer ${input.computer.id}`, error);
    await input.store.updateComputerById({
      computerId: input.computer.id,
      machineHealth: {
        ...input.machineHealth,
        autoSleep: failedAutoSleep,
      },
    });
    return null;
  }
};

const isMachineSafeToSleep = (health: {
  readonly safeToSleep?: unknown;
  readonly safeToRestart?: unknown;
  readonly activeSessions?: unknown;
}): boolean => {
  if (typeof health.safeToSleep === "boolean") {
    return health.safeToSleep;
  }

  if (health.safeToRestart !== true) {
    return false;
  }

  const activeTotal = readActiveSessionTotal(health.activeSessions);
  return activeTotal === undefined || activeTotal === 0;
};

const readActiveSessionTotal = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  const activeSessions = readObject(value);
  const total = activeSessions?.["total"];

  return typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : undefined;
};

const readIsoDate = (value: unknown): Date | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const date = new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
};

const buildMachineServerUpdate = async (
  store: CloudStore,
  input: {
    readonly channel: string;
    readonly currentVersion: string | null;
  },
) => {
  const manifest = await store.getReleaseManifest({
    target: "machine-server",
    channel: input.channel,
    platform: DEFAULT_RELEASE_PLATFORM,
  });

  return buildReleaseCheckResponse(manifest, input.currentVersion);
};

const readQueryString = (value: string | undefined, fallback: string | null): string | null => {
  if (value === undefined) {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? fallback : trimmed;
};

const readContentLength = (value: string | undefined): number | null => {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const readNonNegativeIntegerHeader = (value: string | undefined, label: string): number => {
  if (value === undefined || value.trim().length === 0) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw badRequest("INVALID_ARCHIVE_METADATA", `Feedback archive ${label} must be a non-negative integer`);
  }

  return parsed;
};

const readMachineContextHeader = (value: string | undefined): Record<string, unknown> => {
  if (value === undefined || value.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

const markFeedbackArchiveUploadFailed = async (
  store: CloudStore,
  feedbackId: string,
  errorMessage: string,
): Promise<void> => {
  await store.markFeedbackReportCommentOnly({
    feedbackId,
    errorMessage: errorMessage.slice(0, 1_000),
  });
};
