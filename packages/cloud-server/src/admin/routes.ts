import { timingSafeEqual } from "node:crypto";

import { Hono } from "hono";

import type { AuthService } from "../auth/service.js";
import type { CloudServerConfig } from "../config.js";
import type {
  AiUsagePayloadRecord,
  AiUsageRequestRecord,
  AiUsageSummary,
  CloudStore,
  ComputerAccessSessionRecord,
  ComputerRecord,
  MachineIdentityRecord,
  SessionRecord,
} from "../db/types.js";
import type { TunnelStatusRegistry } from "../gateway/tunnel.js";
import type { ComputerProvisioner } from "../provisioning/types.js";
import {
  serializeReleaseManifest,
  readReleaseChannel,
  readReleasePlatform,
} from "../releases/routes.js";
import type { AppVariables } from "../shared/context.js";
import { badRequest, notFound, unauthorized } from "../shared/errors.js";
import { serializeComputer, serializeUser } from "../shared/serialization.js";
import { readJsonBody, stringField } from "../shared/validation.js";

export const createAdminRoutes = (
  store: CloudStore,
  authService: AuthService,
  config: CloudServerConfig,
  provisioner: ComputerProvisioner,
  tunnelRegistry: TunnelStatusRegistry,
): Hono<{ Variables: AppVariables }> => {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("*", async (context, next) => {
    const token = readBearerToken(context.req.header("authorization"));

    if (token === null || !safeTokenEquals(token, config.adminToken)) {
      throw unauthorized("Admin access required");
    }

    await next();
  });

  app.get("/auth-check", (context) => context.json({ ok: true }));
  app.post("/auth-check", (context) => context.json({ ok: true }));

  app.get("/overview", async (context) => {
    const [users, computers, releases] = await Promise.all([
      store.listUsers(),
      store.listComputers(),
      store.listReleaseManifests(),
    ]);

    return context.json({
      stats: buildStats(users, computers),
      users: users.map((user) => ({
        ...serializeUser(user),
        computerCount: computers.filter((computer) => computer.ownerUserId === user.id).length,
      })),
      computers: computers.map((computer) => ({
        ...serializeComputer(computer),
        ownerEmail: users.find((user) => user.id === computer.ownerUserId)?.email ?? null,
        tunnelConnected: tunnelRegistry.isConnected(computer.id),
      })),
      releases: releases.map(serializeReleaseManifest),
    });
  });

  app.get("/ai-usage", async (context) => {
    const [usageRows, users, computers] = await Promise.all([
      store.listAiUsageRequests({
        userId: readOptionalQueryString(context.req.query("userId")),
        computerId: readOptionalQueryString(context.req.query("computerId")),
        limit: readLimit(context.req.query("limit")),
        before: readOptionalDate(context.req.query("before")),
      }),
      store.listUsers(),
      store.listComputers(),
    ]);

    return context.json({
      usage: usageRows.map((usage) => serializeAiUsageRequestAdmin(usage, users, computers)),
    });
  });

  app.get("/ai-usage/summary", async (context) => {
    const summary = await store.summarizeAiUsageRequests({
      userId: readOptionalQueryString(context.req.query("userId")),
      computerId: readOptionalQueryString(context.req.query("computerId")),
      from: readOptionalDate(context.req.query("from")),
      to: readOptionalDate(context.req.query("to")),
    });

    return context.json({ summary: serializeAiUsageSummary(summary) });
  });

  app.get("/ai-usage/:usageId", async (context) => {
    const usage = await store.getAiUsageRequestById(context.req.param("usageId"));

    if (usage === null) {
      throw notFound("AI_USAGE_NOT_FOUND", "AI usage request not found");
    }

    const [users, computers, payload] = await Promise.all([
      store.listUsers(),
      store.listComputers(),
      store.getAiUsagePayloadByRequestId(usage.id),
    ]);

    return context.json({
      usage: {
        ...serializeAiUsageRequestAdmin(usage, users, computers),
        payload: payload === null ? null : serializeAiUsagePayload(payload),
      },
    });
  });

  app.post("/users", async (context) => {
    const body = await readJsonBody(context.req.raw);
    const user = await authService.createUser({
      email: stringField(body, "email", { required: true, maxLength: 320 }) ?? "",
      password: stringField(body, "password", { required: true, maxLength: 1024 }) ?? "",
    });

    return context.json({ user: serializeUser(user) }, 201);
  });

  app.get("/users", async (context) => {
    const [users, computers] = await Promise.all([
      store.listUsers(),
      store.listComputers(),
    ]);

    return context.json({
      users: users.map((user) => ({
        ...serializeUser(user),
        computerCount: computers.filter((computer) => computer.ownerUserId === user.id).length,
        computers: computers
          .filter((computer) => computer.ownerUserId === user.id)
          .map((computer) => ({
            ...serializeComputer(computer),
            tunnelConnected: tunnelRegistry.isConnected(computer.id),
          })),
      })),
    });
  });

  app.get("/users/:userId", async (context) => {
    const userId = context.req.param("userId");
    const user = await store.getUserById(userId);

    if (user === null) {
      throw notFound("USER_NOT_FOUND", "User not found");
    }

    const [computers, sessions] = await Promise.all([
      store.listComputersForUser(userId),
      store.listSessionsForUser(userId),
    ]);

    return context.json({
      user: serializeUser(user),
      computers: computers.map((computer) => ({
        ...serializeComputer(computer),
        tunnelConnected: tunnelRegistry.isConnected(computer.id),
      })),
      sessions: sessions.map(serializeSession),
    });
  });

  app.delete("/users/:userId", async (context) => {
    const userId = context.req.param("userId");
    const user = await store.getUserById(userId);

    if (user === null) {
      throw notFound("USER_NOT_FOUND", "User not found");
    }

    const computers = await store.listComputersForUser(userId);

    await Promise.all(computers.map(async (computer) => {
      try {
        await provisioner.terminateComputer(computer);
      } catch (error) {
        console.error(`failed to terminate computer ${computer.id}`, error);
      }
    }));

    const deleted = await store.deleteUserById(userId);

    if (!deleted) {
      throw notFound("USER_NOT_FOUND", "User not found");
    }

    return context.json({ ok: true });
  });

  app.post("/users/:userId/password", async (context) => {
    const body = await readJsonBody(context.req.raw);
    const user = await authService.setPassword({
      userId: context.req.param("userId"),
      password: stringField(body, "password", { required: true, maxLength: 1024 }) ?? "",
    });

    return context.json({ user: serializeUser(user) });
  });

  app.post("/users/:userId/sessions/revoke-all", async (context) => {
    const userId = context.req.param("userId");
    const user = await store.getUserById(userId);

    if (user === null) {
      throw notFound("USER_NOT_FOUND", "User not found");
    }

    const revokedCount = await store.revokeAllSessionsForUser(userId, new Date());

    return context.json({ revokedCount });
  });

  app.get("/computers", async (context) => {
    const [users, computers] = await Promise.all([
      store.listUsers(),
      store.listComputers(),
    ]);

    return context.json({
      computers: computers.map((computer) => ({
        ...serializeComputer(computer),
        ownerEmail: users.find((user) => user.id === computer.ownerUserId)?.email ?? null,
        tunnelConnected: tunnelRegistry.isConnected(computer.id),
      })),
    });
  });

  app.get("/computers/:computerId", async (context) => {
    const computerId = context.req.param("computerId");
    const computer = await store.getComputerById(computerId);

    if (computer === null) {
      throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
    }

    const [owner, identities, accessSessions] = await Promise.all([
      store.getUserById(computer.ownerUserId),
      store.listMachineIdentitiesForComputer(computerId),
      store.listAccessSessionsForComputer({ computerId, limit: 25 }),
    ]);

    return context.json({
      computer: {
        ...serializeComputer(computer),
        ownerEmail: owner?.email ?? null,
        tunnelConnected: tunnelRegistry.isConnected(computer.id),
      },
      identities: identities.map(serializeMachineIdentity),
      accessSessions: accessSessions.map(serializeAccessSessionAdmin),
    });
  });

  app.patch("/computers/:computerId", async (context) => {
    const body = await readJsonBody(context.req.raw);
    const name = stringField(body, "name", { required: true, maxLength: 120 }) ?? "";
    const computer = await store.renameComputerById({
      computerId: context.req.param("computerId"),
      name,
    });

    if (computer === null) {
      throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
    }

    return context.json({
      computer: {
        ...serializeComputer(computer),
        tunnelConnected: tunnelRegistry.isConnected(computer.id),
      },
    });
  });

  app.delete("/computers/:computerId", async (context) => {
    const computer = await store.getComputerById(context.req.param("computerId"));

    if (computer === null) {
      throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
    }

    await provisioner.terminateComputer(computer);
    const deleted = await store.deleteComputerById(computer.id);

    if (!deleted) {
      throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
    }

    return context.json({ ok: true });
  });

  app.post("/computers/:computerId/start", async (context) => {
    const computer = await readComputer(store, context.req.param("computerId"));
    const providerMetadata = await provisioner.startComputer(computer);
    const updated = await store.updateComputerById({
      computerId: computer.id,
      status: "starting",
      providerMetadata,
    });

    return context.json({
      computer: {
        ...serializeComputer(updated ?? computer),
        tunnelConnected: tunnelRegistry.isConnected(computer.id),
      },
    });
  });

  app.post("/computers/:computerId/stop", async (context) => {
    const computer = await readComputer(store, context.req.param("computerId"));
    const providerMetadata = await provisioner.stopComputer(computer);
    const updated = await store.updateComputerById({
      computerId: computer.id,
      status: "sleeping",
      providerMetadata,
    });

    return context.json({
      computer: {
        ...serializeComputer(updated ?? computer),
        tunnelConnected: tunnelRegistry.isConnected(computer.id),
      },
    });
  });

  app.post("/computers/:computerId/restart", async (context) => {
    const computer = await readComputer(store, context.req.param("computerId"));
    const providerMetadata = await provisioner.restartComputer(computer);
    const updated = await store.updateComputerById({
      computerId: computer.id,
      status: "starting",
      providerMetadata,
    });

    return context.json({
      computer: {
        ...serializeComputer(updated ?? computer),
        tunnelConnected: tunnelRegistry.isConnected(computer.id),
      },
    });
  });

  app.post("/computers/:computerId/identities/:identityId/revoke", async (context) => {
    const identity = await store.revokeMachineIdentity({
      identityId: context.req.param("identityId"),
      revokedAt: new Date(),
    });

    if (identity === null || identity.computerId !== context.req.param("computerId")) {
      throw notFound("MACHINE_IDENTITY_NOT_FOUND", "Machine identity not found");
    }

    return context.json({ identity: serializeMachineIdentity(identity) });
  });

  app.post("/releases/desktop", async (context) => {
    const body = await readJsonBody(context.req.raw);
    const manifest = await store.upsertReleaseManifest({
      target: "desktop",
      channel: readReleaseChannel(body),
      platform: stringField(body, "platform", { required: true, maxLength: 120 }) ?? "",
      version: stringField(body, "version", { required: true, maxLength: 120 }) ?? "",
      downloadUrl: stringField(body, "downloadUrl", { required: true, maxLength: 2000 }) ?? "",
      signatureUrl: stringField(body, "signatureUrl", { maxLength: 2000 }) ?? null,
      dockerImage: null,
      notes: stringField(body, "notes", { maxLength: 4000 }) ?? null,
      metadata: readMetadata(body["metadata"]),
      releasedAt: readReleasedAt(body["releasedAt"]),
    });

    return context.json({ release: serializeReleaseManifest(manifest) }, 201);
  });

  app.post("/releases/machine-server", async (context) => {
    const body = await readJsonBody(context.req.raw);
    const downloadUrl = optionalNonEmptyString(body, "downloadUrl", 2000);
    const dockerImage = optionalNonEmptyString(body, "dockerImage", 2000);

    if (downloadUrl === null && dockerImage === null) {
      throw badRequest(
        "MACHINE_SERVER_RELEASE_ARTIFACT_REQUIRED",
        "Machine server releases require downloadUrl or dockerImage.",
      );
    }

    const manifest = await store.upsertReleaseManifest({
      target: "machine-server",
      channel: readReleaseChannel(body),
      platform: readReleasePlatform(body),
      version: stringField(body, "version", { required: true, maxLength: 120 }) ?? "",
      downloadUrl,
      signatureUrl: null,
      dockerImage,
      notes: stringField(body, "notes", { maxLength: 4000 }) ?? null,
      metadata: readMetadata(body["metadata"]),
      releasedAt: readReleasedAt(body["releasedAt"]),
    });

    return context.json({ release: serializeReleaseManifest(manifest) }, 201);
  });

  app.delete("/releases/:releaseId", async (context) => {
    const deleted = await store.deleteReleaseManifest(context.req.param("releaseId"));

    if (!deleted) {
      throw notFound("RELEASE_NOT_FOUND", "Release not found");
    }

    return context.json({ ok: true });
  });

  return app;
};

const buildStats = (
  users: ReadonlyArray<{ readonly id: string; readonly createdAt: Date }>,
  computers: ReadonlyArray<ComputerRecord>,
) => ({
  users: users.length,
  computers: computers.length,
  cloudComputers: computers.filter((computer) => computer.kind === "cloud").length,
  localComputers: computers.filter((computer) => computer.kind === "local").length,
  activeComputers: computers.filter(
    (computer) => computer.status === "online" || computer.status === "idle",
  ).length,
  onlineComputers: computers.filter((computer) => computer.status === "online").length,
  idleComputers: computers.filter((computer) => computer.status === "idle").length,
  failedComputers: computers.filter((computer) => computer.status === "failed").length,
});

const readComputer = async (store: CloudStore, computerId: string): Promise<ComputerRecord> => {
  const computer = await store.getComputerById(computerId);

  if (computer === null) {
    throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
  }

  return computer;
};

const serializeSession = (session: SessionRecord) => ({
  id: session.id,
  userId: session.userId,
  expiresAt: session.expiresAt.toISOString(),
  revokedAt: session.revokedAt?.toISOString() ?? null,
  createdAt: session.createdAt.toISOString(),
  updatedAt: session.updatedAt.toISOString(),
});

const serializeMachineIdentity = (identity: MachineIdentityRecord) => ({
  id: identity.id,
  computerId: identity.computerId,
  hasBootstrapToken: identity.bootstrapTokenHash !== null,
  hasMachineToken: identity.tokenHash !== null,
  lastUsedAt: identity.lastUsedAt?.toISOString() ?? null,
  revokedAt: identity.revokedAt?.toISOString() ?? null,
  createdAt: identity.createdAt.toISOString(),
});

const serializeAccessSessionAdmin = (accessSession: ComputerAccessSessionRecord) => ({
  id: accessSession.id,
  userId: accessSession.userId,
  computerId: accessSession.computerId,
  expiresAt: accessSession.expiresAt.toISOString(),
  revokedAt: accessSession.revokedAt?.toISOString() ?? null,
  createdAt: accessSession.createdAt.toISOString(),
});

const serializeAiUsageRequestAdmin = (
  usage: AiUsageRequestRecord,
  users: ReadonlyArray<{ readonly id: string; readonly email: string }>,
  computers: ReadonlyArray<{ readonly id: string; readonly name: string }>,
) => ({
  id: usage.id,
  userId: usage.userId,
  userEmail: users.find((user) => user.id === usage.userId)?.email ?? null,
  computerId: usage.computerId,
  computerName: computers.find((computer) => computer.id === usage.computerId)?.name ?? null,
  machineIdentityId: usage.machineIdentityId,
  provider: usage.provider,
  model: usage.model,
  method: usage.method,
  upstreamPath: usage.upstreamPath,
  status: usage.status,
  httpStatus: usage.httpStatus,
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cachedInputTokens: usage.cachedInputTokens,
  reasoningOutputTokens: usage.reasoningOutputTokens,
  totalTokens: usage.totalTokens,
  startedAt: usage.startedAt.toISOString(),
  completedAt: usage.completedAt?.toISOString() ?? null,
  durationMs: usage.durationMs,
  errorMessage: usage.errorMessage,
  metadata: usage.metadata,
});

const serializeAiUsagePayload = (payload: AiUsagePayloadRecord) => ({
  id: payload.id,
  usageRequestId: payload.usageRequestId,
  requestHeaders: payload.requestHeaders,
  requestBody: payload.requestBody,
  requestBodyTruncated: payload.requestBodyTruncated,
  responseHeaders: payload.responseHeaders,
  responseBody: payload.responseBody,
  responseBodyTruncated: payload.responseBodyTruncated,
  createdAt: payload.createdAt.toISOString(),
});

const serializeAiUsageSummary = (summary: AiUsageSummary) => ({
  requestCount: summary.requestCount,
  inputTokens: summary.inputTokens,
  outputTokens: summary.outputTokens,
  cachedInputTokens: summary.cachedInputTokens,
  reasoningOutputTokens: summary.reasoningOutputTokens,
  totalTokens: summary.totalTokens,
});

const readMetadata = (value: unknown): unknown => {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value;
};

const readReleasedAt = (value: unknown): Date => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return new Date();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const readOptionalQueryString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

const readOptionalDate = (value: string | undefined): Date | undefined => {
  const trimmed = value?.trim();

  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const readLimit = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 50;
  }

  return Math.min(parsed, 200);
};

const optionalNonEmptyString = (
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null => {
  const value = stringField(body, key, { maxLength });

  if (value === undefined || value.length === 0) {
    return null;
  }

  return value;
};

const readBearerToken = (authorizationHeader: string | undefined): string | null => {
  if (authorizationHeader === undefined) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(/\s+/, 2);

  if (scheme?.toLowerCase() !== "bearer" || token === undefined || token.length === 0) {
    return null;
  }

  return token;
};

const safeTokenEquals = (actual: string, expected: string): boolean => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
};
