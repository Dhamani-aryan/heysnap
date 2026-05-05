import { Hono } from "hono";

import { createOpaqueToken, hashToken } from "../auth/tokens.js";
import type { CloudServerConfig } from "../config.js";
import type { CloudStore, ComputerStatus } from "../db/types.js";
import {
  buildReleaseCheckResponse,
  DEFAULT_RELEASE_CHANNEL,
  DEFAULT_RELEASE_PLATFORM,
} from "../releases/routes.js";
import { notFound, unauthorized } from "../shared/errors.js";
import { serializeComputer } from "../shared/serialization.js";
import { readJsonBody, stringField } from "../shared/validation.js";

export const createMachineRoutes = (
  store: CloudStore,
  config: CloudServerConfig,
): Hono => {
  const app = new Hono();

  app.post("/register", async (context) => {
    const body = await readJsonBody(context.req.raw);
    const computerId = stringField(body, "computerId", { required: true }) ?? "";
    const bootstrapToken = stringField(body, "bootstrapToken", { required: true }) ?? "";
    const machineServerVersion = stringField(body, "machineServerVersion", { maxLength: 120 }) ?? null;
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
    const machine = await authenticateMachine(store, config, context.req.header("authorization"));
    const body = await readJsonBody(context.req.raw);
    const status = readMachineStatus(body["status"]);
    const capabilities = readCapabilities(body["capabilities"]);
    const machineServerVersion = stringField(body, "machineServerVersion", { maxLength: 120 }) ?? undefined;
    const now = new Date();
    await store.touchMachineIdentity({ identityId: machine.id, lastUsedAt: now });
    const computer = await store.updateComputerById({
      computerId: machine.computerId,
      status,
      capabilities,
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

    return context.json({ computer: serializeComputer(computer), update });
  });

  app.get("/update-check", async (context) => {
    const machine = await authenticateMachine(store, config, context.req.header("authorization"));
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

const authenticateMachine = async (
  store: CloudStore,
  config: CloudServerConfig,
  authorization: string | undefined,
) => {
  const token = readBearerToken(authorization);

  if (token === undefined) {
    throw unauthorized("Machine token required");
  }

  const identity = await store.getMachineIdentityByTokenHash(hashToken(token, config.sessionSecret));

  if (identity === null || identity.revokedAt !== null) {
    throw unauthorized("Invalid machine token");
  }

  return identity;
};

const readBearerToken = (authorization: string | undefined): string | undefined => {
  if (authorization === undefined) {
    return undefined;
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || token === undefined || token.trim().length === 0) {
    return undefined;
  }

  return token.trim();
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
