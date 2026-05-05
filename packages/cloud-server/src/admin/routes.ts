import { timingSafeEqual } from "node:crypto";

import { Hono } from "hono";

import type { AuthService } from "../auth/service.js";
import type { CloudServerConfig } from "../config.js";
import type { CloudStore } from "../db/types.js";
import type { ComputerProvisioner } from "../provisioning/types.js";
import { serializeReleaseManifest, readReleaseChannel, readReleasePlatform } from "../releases/routes.js";
import type { AppVariables } from "../shared/context.js";
import { notFound, unauthorized } from "../shared/errors.js";
import { serializeComputer, serializeUser } from "../shared/serialization.js";
import { readJsonBody, stringField } from "../shared/validation.js";

export const createAdminRoutes = (
  store: CloudStore,
  authService: AuthService,
  config: CloudServerConfig,
  provisioner: ComputerProvisioner,
): Hono<{ Variables: AppVariables }> => {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("*", async (context, next) => {
    const token = readBearerToken(context.req.header("authorization"));

    if (token === null || !safeTokenEquals(token, config.adminToken)) {
      throw unauthorized("Admin access required");
    }

    await next();
  });

  app.post("/users", async (context) => {
    const body = await readJsonBody(context.req.raw);
    const user = await authService.createUser({
      email: stringField(body, "email", { required: true, maxLength: 320 }) ?? "",
      password: stringField(body, "password", { required: true, maxLength: 1024 }) ?? "",
    });

    return context.json({
      user: serializeUser({
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }),
    }, 201);
  });

  app.get("/overview", async (context) => {
    const [users, computers, releases] = await Promise.all([
      store.listUsers(),
      store.listComputers(),
      store.listReleaseManifests(),
    ]);

    return context.json({
      stats: {
        users: users.length,
        computers: computers.length,
        cloudComputers: computers.filter((computer) => computer.kind === "cloud").length,
        localComputers: computers.filter((computer) => computer.kind === "local").length,
        activeComputers: computers.filter((computer) => computer.status === "online" || computer.status === "idle").length,
      },
      users: users.map((user) => ({
        ...serializeUser(user),
        computerCount: computers.filter((computer) => computer.ownerUserId === user.id).length,
      })),
      computers: computers.map((computer) => ({
        ...serializeComputer(computer),
        ownerEmail: users.find((user) => user.id === computer.ownerUserId)?.email ?? null,
      })),
      releases: releases.map(serializeReleaseManifest),
    });
  });

  app.get("/users", async (context) => {
    const [users, computers] = await Promise.all([
      store.listUsers(),
      store.listComputers(),
    ]);

    return context.json({
      users: users.map((user) => ({
        ...serializeUser(user),
        computers: computers
          .filter((computer) => computer.ownerUserId === user.id)
          .map(serializeComputer),
      })),
    });
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
      })),
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
    const manifest = await store.upsertReleaseManifest({
      target: "machine-server",
      channel: readReleaseChannel(body),
      platform: readReleasePlatform(body),
      version: stringField(body, "version", { required: true, maxLength: 120 }) ?? "",
      downloadUrl: null,
      signatureUrl: null,
      dockerImage: stringField(body, "dockerImage", { required: true, maxLength: 2000 }) ?? "",
      notes: stringField(body, "notes", { maxLength: 4000 }) ?? null,
      metadata: readMetadata(body["metadata"]),
      releasedAt: readReleasedAt(body["releasedAt"]),
    });

    return context.json({ release: serializeReleaseManifest(manifest) }, 201);
  });

  return app;
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
