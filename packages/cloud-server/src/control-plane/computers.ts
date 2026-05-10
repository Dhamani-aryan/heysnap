import { Hono } from "hono";

import type { AuthService } from "../auth/service.js";
import { createOpaqueToken, hashToken } from "../auth/tokens.js";
import type { CloudServerConfig } from "../config.js";
import type { CloudStore, ComputerRecord } from "../db/types.js";
import type { GatewayAccessService } from "../gateway/access-sessions.js";
import type { TunnelStatusRegistry } from "../gateway/tunnel.js";
import { getDev8gbPreset } from "../provisioning/presets.js";
import type { ComputerProvisioner } from "../provisioning/types.js";
import type { AppVariables } from "../shared/context.js";
import { conflict, HttpError, notFound } from "../shared/errors.js";
import {
  serializeComputer,
  serializeComputerAccessSession,
} from "../shared/serialization.js";
import { readJsonBody, stringField } from "../shared/validation.js";
import { requireAuth } from "../auth/middleware.js";

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

  app.post("/local", async (context) => {
    const user = context.get("currentUser");
    const body = await readJsonBody(context.req.raw);
    const localDeviceId = stringField(body, "localDeviceId", { required: true, maxLength: 200 }) ?? "";
    const name = stringField(body, "name", { required: true, maxLength: 120 }) ?? "Local Machine";
    const machineServerVersion = stringField(body, "machineServerVersion", { maxLength: 120 }) ?? null;
    const capabilities = readCapabilities(body["capabilities"]);
    const replacedLocalDeviceIds = readLocalDeviceIds(body["replacedLocalDeviceIds"])
      .filter((replacedLocalDeviceId) => replacedLocalDeviceId !== localDeviceId);
    const providerMetadata = {
      provider: "electron-local",
      localDeviceId,
    };
    const existing = (await store.listComputersForUser(user.id)).find((computer) =>
      computer.kind === "local" &&
      readProviderMetadataString(computer.providerMetadata, "localDeviceId") === localDeviceId
    );
    const now = new Date();
    const computer = existing === undefined
      ? await store.createComputer({
          ownerUserId: user.id,
          name,
          kind: "local",
          status: "online",
          providerMetadata,
          capabilities,
        })
      : await store.updateComputerForUser({
          userId: user.id,
          computerId: existing.id,
          name,
          status: "online",
          providerMetadata,
          capabilities,
          machineServerVersion,
          lastHeartbeatAt: now,
        }) ?? existing;
    const machineToken = await createActivatedMachineToken(store, computer.id, config);
    const syncedComputer = existing === undefined
      ? await store.updateComputerForUser({
          userId: user.id,
          computerId: computer.id,
          machineServerVersion,
          lastHeartbeatAt: now,
        }) ?? computer
      : computer;

    if (replacedLocalDeviceIds.length > 0) {
      const computers = await store.listComputersForUser(user.id);

      await Promise.all(computers.map(async (localComputer) => {
        if (
          localComputer.id !== computer.id &&
          localComputer.kind === "local" &&
          replacedLocalDeviceIds.includes(
            readProviderMetadataString(localComputer.providerMetadata, "localDeviceId") ?? "",
          )
        ) {
          await store.deleteComputerForUser({
            userId: user.id,
            computerId: localComputer.id,
          });
        }
      }));
    }

    return context.json({
      computer: serializeUserComputer(syncedComputer, tunnelRegistry),
      machine: {
        computerId: syncedComputer.id,
        token: machineToken,
        heartbeatIntervalSeconds: 30,
      },
    }, existing === undefined ? 201 : 200);
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
    const providerMetadata = await provisioner.startComputer(computer);
    const updated = await store.updateComputerForUser({
      userId: user.id,
      computerId: computer.id,
      status: "starting",
      providerMetadata,
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
    });

    return context.json({ computer: serializeUserComputer(updated ?? computer, tunnelRegistry) });
  });

  app.post("/:computerId/access-session", async (context) => {
    const user = context.get("currentUser");
    const computer = await readOwnedComputer(store, user.id, context.req.param("computerId"));
    const result = await gatewayAccessService.createAccessSession({
      userId: user.id,
      computerId: computer.id,
    });

    return context.json({
      accessSession: serializeComputerAccessSession(result.accessSession, result.token),
      routes: {
        filesystemWebSocketUrl: `/gateway/computers/${computer.id}/filesystem`,
        agentBaseUrl: `/gateway/computers/${computer.id}/agent`,
        capabilitiesWebSocketUrl: `/gateway/computers/${computer.id}/capabilities`,
      },
    }, 201);
  });

  return app;
};

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

const createActivatedMachineToken = async (
  store: CloudStore,
  computerId: string,
  config: CloudServerConfig,
): Promise<string> => {
  const bootstrapToken = createOpaqueToken();
  const identity = await store.createMachineIdentity({
    computerId,
    bootstrapTokenHash: hashToken(bootstrapToken, config.sessionSecret),
  });
  const machineToken = createOpaqueToken();
  const activated = await store.activateMachineIdentity({
    identityId: identity.id,
    tokenHash: hashToken(machineToken, config.sessionSecret),
    activatedAt: new Date(),
  });

  if (activated === null) {
    throw new HttpError(500, "MACHINE_TOKEN_CREATE_FAILED", "Failed to create machine token");
  }

  return machineToken;
};

const serializeUserComputer = (
  computer: ComputerRecord,
  tunnelRegistry: TunnelStatusRegistry,
) => ({
  ...serializeComputer(computer),
  tunnelConnected: tunnelRegistry.isConnected(computer.id),
});

const readCapabilities = (value: unknown): string[] => {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return [];
  }

  return value;
};

const readLocalDeviceIds = (value: unknown): string[] => {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
};

const readProviderMetadataString = (metadata: unknown, key: string): string | null => {
  if (typeof metadata !== "object" || metadata === null || !(key in metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

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
