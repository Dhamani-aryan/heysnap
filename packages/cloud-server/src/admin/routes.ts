import { timingSafeEqual } from "node:crypto";

import { Hono } from "hono";

import { calculateAiUsageCost } from "../ai-usage/pricing.js";
import type { AuthService } from "../auth/service.js";
import type { CloudServerConfig } from "../config.js";
import type {
  AiUsageBreakdownRow,
  AiUsageBucket,
  AiUsageBucketGranularity,
  AiUsageGroupBy,
  AiUsagePayloadRecord,
  AiUsageRequestRecord,
  AiUsageStatus,
  AiUsageSummary,
  AgentSessionHarness,
  AgentSessionThreadRecord,
  AgentSessionVersionRecord,
  CloudStore,
  ComputerAccessSessionRecord,
  ComputerRecord,
  MachineIdentityRecord,
  SessionRecord,
} from "../db/types.js";
import type { TunnelStatusRegistry } from "../gateway/tunnel.js";
import type { AgentSessionObjectStorage } from "../agent-sessions/storage.js";
import { toStartComputerError } from "../provisioning/errors.js";
import type { ComputerProvisioner } from "../provisioning/types.js";
import {
  serializeReleaseManifest,
  readReleaseChannel,
  readReleasePlatform,
} from "../releases/routes.js";
import type { AppVariables } from "../shared/context.js";
import { badRequest, notFound, serviceUnavailable, unauthorized } from "../shared/errors.js";
import { clearSleepMachineHealth } from "../shared/machine-health.js";
import { serializeComputer, serializeUser } from "../shared/serialization.js";
import { readJsonBody, stringField } from "../shared/validation.js";

export const createAdminRoutes = (
  store: CloudStore,
  authService: AuthService,
  config: CloudServerConfig,
  provisioner: ComputerProvisioner,
  tunnelRegistry: TunnelStatusRegistry,
  agentSessionStorage?: AgentSessionObjectStorage,
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
      releases: releases
        .filter((release) => release.target === "machine-server")
        .map(serializeReleaseManifest),
    });
  });

  app.get("/ai-usage", async (context) => {
    const [usageRows, users, computers] = await Promise.all([
      store.listAiUsageRequests({
        userId: readOptionalQueryString(context.req.query("userId")),
        computerId: readOptionalQueryString(context.req.query("computerId")),
        provider: readOptionalQueryString(context.req.query("provider")),
        status: readAiUsageStatus(context.req.query("status")),
        model: readOptionalQueryString(context.req.query("model")),
        from: readOptionalDate(context.req.query("from")),
        before: readOptionalDate(context.req.query("before")),
        limit: readLimit(context.req.query("limit")),
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
      provider: readOptionalQueryString(context.req.query("provider")),
      model: readOptionalQueryString(context.req.query("model")),
      status: readAiUsageStatus(context.req.query("status")),
      from: readOptionalDate(context.req.query("from")),
      to: readOptionalDate(context.req.query("to")),
    });

    return context.json({ summary: serializeAiUsageSummary(summary) });
  });

  app.get("/ai-usage/buckets", async (context) => {
    const buckets = await store.bucketAiUsageRequests({
      userId: readOptionalQueryString(context.req.query("userId")),
      computerId: readOptionalQueryString(context.req.query("computerId")),
      provider: readOptionalQueryString(context.req.query("provider")),
      model: readOptionalQueryString(context.req.query("model")),
      status: readAiUsageStatus(context.req.query("status")),
      from: readOptionalDate(context.req.query("from")),
      to: readOptionalDate(context.req.query("to")),
      bucket: readBucketGranularity(context.req.query("bucket")),
    });

    return context.json({ buckets: buckets.map(serializeAiUsageBucket) });
  });

  app.get("/ai-usage/breakdown", async (context) => {
    const groupBy = readAiUsageGroupBy(context.req.query("groupBy"));
    const [groups, users, computers] = await Promise.all([
      store.groupAiUsageRequests({
        groupBy,
        userId: readOptionalQueryString(context.req.query("userId")),
        computerId: readOptionalQueryString(context.req.query("computerId")),
        provider: readOptionalQueryString(context.req.query("provider")),
        model: readOptionalQueryString(context.req.query("model")),
        status: readAiUsageStatus(context.req.query("status")),
        from: readOptionalDate(context.req.query("from")),
        to: readOptionalDate(context.req.query("to")),
        limit: readBreakdownLimit(context.req.query("limit")),
      }),
      groupBy === "user" ? store.listUsers() : Promise.resolve([]),
      groupBy === "computer" ? store.listComputers() : Promise.resolve([]),
    ]);

    return context.json({
      groupBy,
      groups: groups.map((row) => serializeAiUsageBreakdownRow(row, groupBy, users, computers)),
    });
  });

  app.get("/users/:userId/ai-usage", async (context) => {
    const userId = context.req.param("userId");
    const user = await store.getUserById(userId);

    if (user === null) {
      throw notFound("USER_NOT_FOUND", "User not found");
    }

    const from = readOptionalDate(context.req.query("from"));
    const to = readOptionalDate(context.req.query("to"));
    const bucket = readBucketGranularity(context.req.query("bucket"));
    const breakdownLimit = readBreakdownLimit(context.req.query("breakdownLimit"));
    const [summary, buckets, modelBreakdown, computerBreakdown, computers] = await Promise.all([
      store.summarizeAiUsageRequests({ userId, from, to }),
      store.bucketAiUsageRequests({ userId, from, to, bucket }),
      store.groupAiUsageRequests({ userId, from, to, groupBy: "model", limit: breakdownLimit }),
      store.groupAiUsageRequests({ userId, from, to, groupBy: "computer", limit: breakdownLimit }),
      store.listComputers(),
    ]);

    return context.json({
      summary: serializeAiUsageSummary(summary),
      buckets: buckets.map(serializeAiUsageBucket),
      breakdown: {
        models: modelBreakdown.map((row) => serializeAiUsageBreakdownRow(row, "model", [], [])),
        computers: computerBreakdown.map((row) =>
          serializeAiUsageBreakdownRow(row, "computer", [], computers),
        ),
      },
    });
  });

  app.get("/computers/:computerId/ai-usage", async (context) => {
    const computerId = context.req.param("computerId");
    const computer = await store.getComputerById(computerId);

    if (computer === null) {
      throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
    }

    const from = readOptionalDate(context.req.query("from"));
    const to = readOptionalDate(context.req.query("to"));
    const bucket = readBucketGranularity(context.req.query("bucket"));
    const breakdownLimit = readBreakdownLimit(context.req.query("breakdownLimit"));
    const [summary, buckets, modelBreakdown, userBreakdown, users] = await Promise.all([
      store.summarizeAiUsageRequests({ computerId, from, to }),
      store.bucketAiUsageRequests({ computerId, from, to, bucket }),
      store.groupAiUsageRequests({ computerId, from, to, groupBy: "model", limit: breakdownLimit }),
      store.groupAiUsageRequests({ computerId, from, to, groupBy: "user", limit: breakdownLimit }),
      store.listUsers(),
    ]);

    return context.json({
      summary: serializeAiUsageSummary(summary),
      buckets: buckets.map(serializeAiUsageBucket),
      breakdown: {
        models: modelBreakdown.map((row) => serializeAiUsageBreakdownRow(row, "model", [], [])),
        users: userBreakdown.map((row) => serializeAiUsageBreakdownRow(row, "user", users, [])),
      },
    });
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

  app.get("/agent-sessions", async (context) => {
    const [threads, users, computers] = await Promise.all([
      store.listAgentSessionThreads({
        userId: readOptionalQueryString(context.req.query("userId")),
        computerId: readOptionalQueryString(context.req.query("computerId")),
        harness: readAgentSessionHarness(context.req.query("harness")),
        limit: readLimit(context.req.query("limit")),
      }),
      store.listUsers(),
      store.listComputers(),
    ]);

    return context.json({
      sessions: threads.map((thread) => serializeAgentSessionThreadAdmin(thread, users, computers)),
    });
  });

  app.get("/agent-sessions/:sessionId/versions", async (context) => {
    const thread = await store.getAgentSessionThreadById(context.req.param("sessionId"));

    if (thread === null) {
      throw notFound("AGENT_SESSION_NOT_FOUND", "Agent session not found");
    }

    const versions = await store.listAgentSessionVersions(thread.id);

    return context.json({
      session: serializeAgentSessionThreadAdmin(thread, await store.listUsers(), await store.listComputers()),
      versions: versions.map(serializeAgentSessionVersionAdmin),
    });
  });

  app.get("/agent-sessions/:sessionId/raw", async (context) => {
    if (agentSessionStorage === undefined) {
      throw serviceUnavailable(
        "AGENT_SESSION_STORAGE_DISABLED",
        "Agent session storage is not configured",
      );
    }

    const thread = await store.getAgentSessionThreadById(context.req.param("sessionId"));

    if (thread === null || thread.latestObjectKey === null) {
      throw notFound("AGENT_SESSION_NOT_FOUND", "Agent session not found");
    }

    const bytes = await agentSessionStorage.getObject({ key: thread.latestObjectKey });

    return new Response(bytes, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="${thread.harness}-${safeFilenameSegment(thread.nativeThreadId)}.jsonl"`,
      },
    });
  });

  app.post("/users", async (context) => {
    const body = await readJsonBody(context.req.raw);
    const user = await authService.createUser({
      email: stringField(body, "email", { required: true, maxLength: 320 }) ?? "",
      username: stringField(body, "username", { required: true, maxLength: 40 }) ?? "",
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

  app.patch("/users/:userId/model-access", async (context) => {
    const body = await readJsonBody(context.req.raw);
    const allowPiModels = booleanField(body, "allowPiModels", { required: true }) ?? false;
    const user = await store.updateUserModelAccess({
      userId: context.req.param("userId"),
      allowPiModels,
    });

    if (user === null) {
      throw notFound("USER_NOT_FOUND", "User not found");
    }

    return context.json({ user: serializeUser(user) });
  });

  app.patch("/users/:userId/browser-stream-access", async (context) => {
    const body = await readJsonBody(context.req.raw);
    const allowBrowserStream = booleanField(body, "allowBrowserStream", { required: true }) ?? false;
    const user = await store.updateUserBrowserStreamAccess({
      userId: context.req.param("userId"),
      allowBrowserStream,
    });

    if (user === null) {
      throw notFound("USER_NOT_FOUND", "User not found");
    }

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
    let providerMetadata: Record<string, unknown>;

    try {
      providerMetadata = await provisioner.startComputer(computer);
    } catch (error) {
      throw toStartComputerError(error);
    }

    const updated = await store.updateComputerById({
      computerId: computer.id,
      status: "starting",
      providerMetadata,
      machineHealth: clearSleepMachineHealth(computer.machineHealth),
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
      machineHealth: clearSleepMachineHealth(computer.machineHealth),
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

const booleanField = (
  input: Record<string, unknown>,
  key: string,
  options: { readonly required?: boolean } = {},
): boolean | undefined => {
  const value = input[key];

  if (value === undefined) {
    if (options.required === true) {
      throw badRequest("INVALID_BODY", `${key} is required`);
    }

    return undefined;
  }

  if (typeof value !== "boolean") {
    throw badRequest("INVALID_BODY", `${key} must be a boolean`);
  }

  return value;
};

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
) => {
  const costBreakdown = calculateAiUsageCost(usage);

  return {
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
    estimatedCostUsd: costBreakdown?.totalUsd ?? null,
    costBreakdown,
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
  };
};

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

const serializeAgentSessionThreadAdmin = (
  thread: AgentSessionThreadRecord,
  users: ReadonlyArray<{ readonly id: string; readonly email: string; readonly username: string }>,
  computers: ReadonlyArray<{ readonly id: string; readonly name: string }>,
) => {
  const user = users.find((candidate) => candidate.id === thread.userId);

  return {
    id: thread.id,
    userId: thread.userId,
    username: user?.username ?? null,
    userEmail: user?.email ?? null,
    computerId: thread.computerId,
    computerName: computers.find((computer) => computer.id === thread.computerId)?.name ?? null,
    machineIdentityId: thread.machineIdentityId,
    harness: thread.harness,
    nativeThreadId: thread.nativeThreadId,
    threadId: thread.threadId,
    sourcePath: thread.sourcePath,
    relativePath: thread.relativePath,
    latestVersionId: thread.latestVersionId,
    latestSha256: thread.latestSha256,
    latestObjectKey: thread.latestObjectKey,
    latestSizeBytes: thread.latestSizeBytes,
    latestMtime: thread.latestMtime?.toISOString() ?? null,
    sourceCreatedAt: thread.sourceCreatedAt?.toISOString() ?? null,
    sourceUpdatedAt: thread.sourceUpdatedAt?.toISOString() ?? null,
    firstSyncedAt: thread.firstSyncedAt.toISOString(),
    lastSyncedAt: thread.lastSyncedAt.toISOString(),
    metadata: thread.metadata,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  };
};

const serializeAgentSessionVersionAdmin = (version: AgentSessionVersionRecord) => ({
  id: version.id,
  agentSessionThreadId: version.agentSessionThreadId,
  userId: version.userId,
  computerId: version.computerId,
  machineIdentityId: version.machineIdentityId,
  harness: version.harness,
  nativeThreadId: version.nativeThreadId,
  threadId: version.threadId,
  sha256: version.sha256,
  objectBucket: version.objectBucket,
  objectKey: version.objectKey,
  sizeBytes: version.sizeBytes,
  sourceMtime: version.sourceMtime.toISOString(),
  sourcePath: version.sourcePath,
  relativePath: version.relativePath,
  sourceCreatedAt: version.sourceCreatedAt?.toISOString() ?? null,
  sourceUpdatedAt: version.sourceUpdatedAt?.toISOString() ?? null,
  metadata: version.metadata,
  uploadedAt: version.uploadedAt.toISOString(),
  createdAt: version.createdAt.toISOString(),
});

const serializeAiUsageSummary = (summary: AiUsageSummary) => ({
  requestCount: summary.requestCount,
  estimatedCostUsd: summary.estimatedCostUsd,
  inputTokens: summary.inputTokens,
  outputTokens: summary.outputTokens,
  cachedInputTokens: summary.cachedInputTokens,
  reasoningOutputTokens: summary.reasoningOutputTokens,
  totalTokens: summary.totalTokens,
  successCount: summary.successCount,
  failedCount: summary.failedCount,
  abortedCount: summary.abortedCount,
  startedCount: summary.startedCount,
  avgDurationMs: summary.avgDurationMs,
  p50DurationMs: summary.p50DurationMs,
  p95DurationMs: summary.p95DurationMs,
  distinctUsers: summary.distinctUsers,
  distinctComputers: summary.distinctComputers,
  distinctModels: summary.distinctModels,
});

const serializeAiUsageBucket = (bucket: AiUsageBucket) => ({
  bucketStart: bucket.bucketStart.toISOString(),
  requestCount: bucket.requestCount,
  estimatedCostUsd: bucket.estimatedCostUsd,
  inputTokens: bucket.inputTokens,
  outputTokens: bucket.outputTokens,
  cachedInputTokens: bucket.cachedInputTokens,
  reasoningOutputTokens: bucket.reasoningOutputTokens,
  totalTokens: bucket.totalTokens,
  successCount: bucket.successCount,
  failedCount: bucket.failedCount,
});

const serializeAiUsageBreakdownRow = (
  row: AiUsageBreakdownRow,
  groupBy: AiUsageGroupBy,
  users: ReadonlyArray<{ readonly id: string; readonly email: string }>,
  computers: ReadonlyArray<{ readonly id: string; readonly name: string }>,
) => ({
  key: row.key,
  label: resolveBreakdownLabel(row.key, groupBy, users, computers),
  requestCount: row.requestCount,
  estimatedCostUsd: row.estimatedCostUsd,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  cachedInputTokens: row.cachedInputTokens,
  reasoningOutputTokens: row.reasoningOutputTokens,
  totalTokens: row.totalTokens,
  successCount: row.successCount,
  failedCount: row.failedCount,
});

const resolveBreakdownLabel = (
  key: string,
  groupBy: AiUsageGroupBy,
  users: ReadonlyArray<{ readonly id: string; readonly email: string }>,
  computers: ReadonlyArray<{ readonly id: string; readonly name: string }>,
): string => {
  switch (groupBy) {
    case "user":
      return users.find((user) => user.id === key)?.email ?? key;
    case "computer":
      return computers.find((computer) => computer.id === key)?.name ?? key;
    default:
      return key;
  }
};

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

const readAgentSessionHarness = (value: string | undefined): AgentSessionHarness | undefined => {
  const trimmed = value?.trim();

  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }

  return trimmed === "codex" || trimmed === "pi" ? trimmed : undefined;
};

const readLimit = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 50;
  }

  return Math.min(parsed, 200);
};

const readBreakdownLimit = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 10;
  }

  return Math.min(parsed, 100);
};

const VALID_AI_USAGE_STATUSES: ReadonlySet<AiUsageStatus> = new Set([
  "started",
  "succeeded",
  "failed",
  "aborted",
]);

const readAiUsageStatus = (value: string | undefined): AiUsageStatus | undefined => {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  return VALID_AI_USAGE_STATUSES.has(trimmed as AiUsageStatus)
    ? (trimmed as AiUsageStatus)
    : undefined;
};

const readBucketGranularity = (value: string | undefined): AiUsageBucketGranularity => {
  return value === "hour" ? "hour" : "day";
};

const VALID_AI_USAGE_GROUP_BY: ReadonlySet<AiUsageGroupBy> = new Set([
  "provider",
  "model",
  "status",
  "user",
  "computer",
]);

const readAiUsageGroupBy = (value: string | undefined): AiUsageGroupBy => {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return "model";
  }
  return VALID_AI_USAGE_GROUP_BY.has(trimmed as AiUsageGroupBy)
    ? (trimmed as AiUsageGroupBy)
    : "model";
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

const safeFilenameSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/gu, "_").slice(0, 120) || "thread";

const safeTokenEquals = (actual: string, expected: string): boolean => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
};
