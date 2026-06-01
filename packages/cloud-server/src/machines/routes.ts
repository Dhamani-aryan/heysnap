import { Hono } from "hono";

import { createOpaqueToken, hashToken } from "../auth/tokens.js";
import type { CloudServerConfig } from "../config.js";
import type { CloudStore, ComputerRecord, ComputerStatus } from "../db/types.js";
import { authenticateMachineBearer } from "./auth.js";
import {
  buildReleaseCheckResponse,
  DEFAULT_RELEASE_CHANNEL,
  DEFAULT_RELEASE_PLATFORM,
} from "../releases/routes.js";
import { badRequest, notFound, unauthorized } from "../shared/errors.js";
import { logger } from "../shared/logger.js";
import { serializeComputer } from "../shared/serialization.js";
import { readJsonBody, stringField } from "../shared/validation.js";
import type { ComputerProvisioner } from "../provisioning/types.js";

export const createMachineRoutes = (
  store: CloudStore,
  config: CloudServerConfig,
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
    logger.info({
      event: "machine.heartbeat",
      computerId: machine.computerId,
      machineIdentityId: machine.id,
      reportedStatus: status,
      storedStatus: (autoSleptComputer ?? computer).status,
      machineServerVersion: machineServerVersion ?? computer.machineServerVersion,
      safeToRestart: readBoolean(body["safeToRestart"]),
      safeToSleep: readBoolean(body["safeToSleep"]),
      lastActivityAt: readOptionalString(body["lastActivityAt"], 80),
      activeSessions: isRecord(body["activeSessions"]) ? body["activeSessions"] : undefined,
      updateState: readOptionalString(body["updateState"], 120),
      lastUpdateError: readOptionalString(body["lastUpdateError"], 500),
      autoSlept: autoSleptComputer !== null,
    }, "Machine heartbeat received");

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

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const readOptionalString = (value: unknown, maxLength: number): string | undefined =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
