import { Hono } from "hono";

import type { AuthService } from "../auth/service.js";
import { createOpaqueToken, hashToken } from "../auth/tokens.js";
import type { CloudServerConfig } from "../config.js";
import type { CloudStore, ComputerRecord } from "../db/types.js";
import {
  DEFAULT_GATEWAY_ACCESS_SCOPES,
  type GatewayAccessScope,
  type GatewayAccessService,
} from "../gateway/access-sessions.js";
import type { TunnelStatusRegistry } from "../gateway/tunnel.js";
import { toStartComputerError } from "../provisioning/errors.js";
import { getDev8gbPreset } from "../provisioning/presets.js";
import type { ComputerProvisioner } from "../provisioning/types.js";
import type { AppVariables } from "../shared/context.js";
import { conflict, HttpError, notFound } from "../shared/errors.js";
import { clearSleepMachineHealth } from "../shared/machine-health.js";
import {
  serializeComputer,
  serializeComputerAccessSession,
} from "../shared/serialization.js";
import { readJsonBody, stringField } from "../shared/validation.js";
import { requireAuth } from "../auth/middleware.js";
import { logger } from "../shared/logger.js";

export const createComputerRoutes = (
  store: CloudStore,
  authService: AuthService,
  gatewayAccessService: GatewayAccessService,
  provisioner: ComputerProvisioner,
  config: CloudServerConfig,
  tunnelRegistry: TunnelStatusRegistry,
): Hono<{ Variables: AppVariables }> => {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("*", requireAuth(authService));

  app.get("/", async (context) => {
    const user = context.get("currentUser");
    const computers = await store.listComputersForUser(user.id);

    return context.json({
      computers: computers.map((computer) => serializeUserComputer(computer, tunnelRegistry)),
    });
  });

  app.post("/", async (context) => {
    const user = context.get("currentUser");
    const existingCloudComputer = (await store.listComputersForUser(user.id)).find((computer) =>
      computer.kind === "cloud"
    );

    if (existingCloudComputer !== undefined) {
      throw conflict("CLOUD_MACHINE_LIMIT_REACHED", "Only one cloud machine is allowed per user");
    }

    const body = await readJsonBody(context.req.raw);
    const name = stringField(body, "name", { required: true, maxLength: 120 }) ?? "";
    const computer = await store.createComputer({
      ownerUserId: user.id,
      name,
      kind: "cloud",
      status: "creating",
      providerMetadata: createInitialProviderMetadata(config),
      capabilities: [],
    });
    const bootstrapToken = createOpaqueToken();
    await store.createMachineIdentity({
      computerId: computer.id,
      bootstrapTokenHash: hashToken(bootstrapToken, config.sessionSecret),
    });

    try {
      const result = await provisioner.provisionComputer({ computer, bootstrapToken, config });
      const updated = await store.updateComputerForUser({
        userId: user.id,
        computerId: computer.id,
        providerMetadata: result.providerMetadata,
      });

      return context.json({ computer: serializeUserComputer(updated ?? computer, tunnelRegistry) }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to provision computer";
      await store.updateComputerForUser({
        userId: user.id,
        computerId: computer.id,
        status: "failed",
        providerMetadata: {
          ...(typeof computer.providerMetadata === "object" && computer.providerMetadata !== null
            ? computer.providerMetadata as Record<string, unknown>
            : {}),
          provisioningError: message,
        },
      });
      throw new HttpError(500, "PROVISIONING_FAILED", message);
    }
  });

  app.get("/:computerId", async (context) => {
    const computer = await readOwnedComputer(store, context.get("currentUser").id, context.req.param("computerId"));

    return context.json({ computer: serializeUserComputer(computer, tunnelRegistry) });
  });

  app.patch("/:computerId", async (context) => {
    const body = await readJsonBody(context.req.raw);
    const name = stringField(body, "name", { required: true, maxLength: 120 }) ?? "";
    const computer = await store.updateComputerForUser({
      userId: context.get("currentUser").id,
      computerId: context.req.param("computerId"),
      name,
    });

    if (computer === null) {
      throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
    }

    return context.json({ computer: serializeUserComputer(computer, tunnelRegistry) });
  });

  app.delete("/:computerId", async (context) => {
    const user = context.get("currentUser");
    const computer = await readOwnedComputer(store, user.id, context.req.param("computerId"));
    await provisioner.terminateComputer(computer);
    const deleted = await store.deleteComputerForUser({
      userId: user.id,
      computerId: computer.id,
    });

    if (!deleted) {
      throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
    }

    return context.json({ ok: true });
  });

  app.post("/:computerId/start", async (context) => {
    const user = context.get("currentUser");
    const computer = await readOwnedComputer(store, user.id, context.req.param("computerId"));
    let providerMetadata: Record<string, unknown>;

    try {
      providerMetadata = await provisioner.startComputer(computer);
    } catch (error) {
      throw toStartComputerError(error);
    }

    const updated = await store.updateComputerForUser({
      userId: user.id,
      computerId: computer.id,
      status: "starting",
      providerMetadata,
      machineHealth: clearSleepMachineHealth(computer.machineHealth),
    });

    return context.json({ computer: serializeUserComputer(updated ?? computer, tunnelRegistry) });
  });

  app.post("/:computerId/stop", async (context) => {
    const user = context.get("currentUser");
    const computer = await readOwnedComputer(store, user.id, context.req.param("computerId"));
    const providerMetadata = await provisioner.stopComputer(computer);
    const updated = await store.updateComputerForUser({
      userId: user.id,
      computerId: computer.id,
      status: "sleeping",
      providerMetadata,
    });

    return context.json({ computer: serializeUserComputer(updated ?? computer, tunnelRegistry) });
  });

  app.post("/:computerId/restart", async (context) => {
    const user = context.get("currentUser");
    const computer = await readOwnedComputer(store, user.id, context.req.param("computerId"));
    const providerMetadata = await provisioner.restartComputer(computer);
    const updated = await store.updateComputerForUser({
      userId: user.id,
      computerId: computer.id,
      status: "starting",
      providerMetadata,
      machineHealth: clearSleepMachineHealth(computer.machineHealth),
    });

    return context.json({ computer: serializeUserComputer(updated ?? computer, tunnelRegistry) });
  });

  app.post("/:computerId/access-session", async (context) => {
    const user = context.get("currentUser");
    const computer = await readOwnedComputer(store, user.id, context.req.param("computerId"));
    const result = await gatewayAccessService.createAccessSession({
      userId: user.id,
      computerId: computer.id,
      scopes: getAccessSessionScopes(user.allowBrowserStream),
    });
    logger.info({
      event: "cloud.access_session.created",
      userId: user.id,
      computerId: computer.id,
      accessSessionId: result.accessSession.id,
      expiresAt: result.accessSession.expiresAt.toISOString(),
      tunnelConnected: tunnelRegistry.isConnected(computer.id),
      computerStatus: computer.status,
    }, "Created computer access session");

    return context.json({
      accessSession: serializeComputerAccessSession(result.accessSession, result.token),
      routes: {
        filesystemWebSocketUrl: `/gateway/computers/${computer.id}/filesystem`,
        filesystemPreviewBaseUrl: `/gateway/computers/${computer.id}/preview`,
        filesystemPreviewWebSocketUrl: `/gateway/computers/${computer.id}/preview/ws`,
        browserControlWebSocketUrl: `/gateway/computers/${computer.id}/browser-control`,
        browserControlStatusUrl: `/gateway/computers/${computer.id}/browser-control/status`,
        ...(user.allowBrowserStream
          ? {
              browserViewPublishWebSocketUrl: `/gateway/computers/${computer.id}/browser-view/publish`,
              browserViewSubscribeWebSocketUrl: `/gateway/computers/${computer.id}/browser-view/subscribe`,
            }
          : {}),
        agentBaseUrl: `/gateway/computers/${computer.id}/agent`,
        capabilitiesBaseUrl: `/gateway/computers/${computer.id}/capabilities`,
      },
    }, 201);
  });

  return app;
};

const getAccessSessionScopes = (allowBrowserStream: boolean): readonly GatewayAccessScope[] =>
  allowBrowserStream
    ? DEFAULT_GATEWAY_ACCESS_SCOPES
    : DEFAULT_GATEWAY_ACCESS_SCOPES.filter((scope) => scope !== "browser-view:ws");

const createInitialProviderMetadata = (config: CloudServerConfig): Record<string, unknown> => {
  if (config.computerProvisioner === "docker") {
    return {
      provider: "docker",
      image: config.localDockerMachineImage ?? "ank1015-machine-local:latest",
      network: config.localDockerNetwork ?? "ank1015-local",
    };
  }

  const preset = getDev8gbPreset(config);
  return {
    provider: "aws-ec2",
    preset: preset.id,
    region: preset.region,
    instanceType: preset.instanceType,
    rootVolumeGb: preset.rootVolumeGb,
  };
};

const serializeUserComputer = (
  computer: ComputerRecord,
  tunnelRegistry: TunnelStatusRegistry,
) => ({
  ...serializeComputer(computer),
  tunnelConnected: tunnelRegistry.isConnected(computer.id),
});

const readOwnedComputer = async (
  store: CloudStore,
  userId: string,
  computerId: string,
): Promise<ComputerRecord> => {
  const computer = await store.getComputerForUser({ userId, computerId });

  if (computer === null) {
    throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
  }

  return computer;
};
