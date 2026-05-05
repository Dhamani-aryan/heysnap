import type { App } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

import { MachineSidecarSupervisor, type MachineServerReleaseManifest } from "./machine-sidecar.js";

interface LocalMachineComputer {
  readonly id: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly kind: string;
  readonly status: string;
  readonly providerMetadata: unknown;
  readonly capabilities: unknown;
  readonly machineServerVersion: string | null;
  readonly lastHeartbeatAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface LocalMachineSyncResponse {
  readonly computer: LocalMachineComputer;
  readonly machine: {
    readonly computerId: string;
    readonly token: string;
    readonly heartbeatIntervalSeconds: number;
  };
}

interface LocalMachineHeartbeatResponse {
  readonly computer: LocalMachineComputer;
  readonly update?: {
    readonly updateAvailable: boolean;
    readonly latest: MachineServerReleaseManifest | null;
  };
}

export interface LocalMachineStatus {
  readonly server: {
    readonly state: "starting" | "running" | "failed" | "stopped";
    readonly port: number | null;
    readonly filesystemRoot: string | null;
    readonly urls: {
      readonly filesystemWebSocketUrl: string;
      readonly agentWebSocketUrl: string;
    } | null;
    readonly image: string | null;
    readonly version: string | null;
    readonly updateState: "idle" | "checking" | "deferred" | "pulling" | "restarting" | "failed";
    readonly updateError: string | null;
    readonly error: string | null;
  };
  readonly cloud: {
    readonly state: "not-synced" | "syncing" | "synced" | "failed";
    readonly computer: LocalMachineComputer | null;
    readonly error: string | null;
    readonly lastHeartbeatAt: string | null;
  };
}

export interface SyncCloudSessionInput {
  readonly cloudServerUrl: string;
  readonly sessionToken: string;
}

interface LocalDeviceIdentity {
  readonly localDeviceId: string;
  readonly replacedLocalDeviceIds: readonly string[];
}

export class LocalMachineController {
  private sidecar: MachineSidecarSupervisor | null = null;
  private serverState: LocalMachineStatus["server"] = {
    state: "stopped",
    port: null,
    filesystemRoot: null,
    urls: null,
    image: null,
    version: null,
    updateState: "idle",
    updateError: null,
    error: null,
  };
  private cloudState: LocalMachineStatus["cloud"] = {
    state: "not-synced",
    computer: null,
    error: null,
    lastHeartbeatAt: null,
  };
  private machineToken: string | null = null;
  private cloudServerUrl: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly electronApp: App) {}

  async start(): Promise<void> {
    this.serverState = { ...this.serverState, state: "starting", error: null };

    try {
      const sidecar = this.getSidecar();
      await sidecar.start();
      this.serverState = sidecar.getStatus();
    } catch (error) {
      this.serverState = {
        ...this.serverState,
        state: "failed",
        port: null,
        filesystemRoot: null,
        urls: null,
        error: error instanceof Error ? error.message : "Failed to start local server sidecar.",
      };
      throw error;
    }
  }

  getStatus(): LocalMachineStatus {
    return {
      server: this.serverState,
      cloud: this.cloudState,
    };
  }

  async syncCloudSession(input: SyncCloudSessionInput): Promise<LocalMachineStatus> {
    if (this.serverState.state !== "running") {
      await this.start();
    }

    const cloudServerUrl = input.cloudServerUrl.trim().replace(/\/+$/, "");
    const sessionToken = input.sessionToken.trim();

    if (cloudServerUrl.length === 0 || sessionToken.length === 0) {
      throw new Error("Cloud server URL and session token are required.");
    }

    this.cloudState = { ...this.cloudState, state: "syncing", error: null };

    try {
      const localDevice = await this.readLocalDeviceIdentity();
      const machineServerVersion = this.readMachineServerVersion();
      const response = await this.request<LocalMachineSyncResponse>(
        cloudServerUrl,
        "/computers/local",
        sessionToken,
        {
          localDeviceId: localDevice.localDeviceId,
          replacedLocalDeviceIds: localDevice.replacedLocalDeviceIds,
          name: `${hostname() || "Local"} Machine`,
          capabilities: ["filesystem", "agent", "local"],
          machineServerVersion,
        },
      );

      this.machineToken = response.machine.token;
      this.cloudServerUrl = cloudServerUrl;
      this.cloudState = {
        state: "synced",
        computer: response.computer,
        error: null,
        lastHeartbeatAt: response.computer.lastHeartbeatAt,
      };
      this.startHeartbeat(response.machine.heartbeatIntervalSeconds);
      await this.sendHeartbeat();

      return this.getStatus();
    } catch (error) {
      this.stopHeartbeat();
      this.machineToken = null;
      this.cloudState = {
        ...this.cloudState,
        state: "failed",
        error: error instanceof Error ? error.message : "Failed to sync local machine.",
      };
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.stopHeartbeat();

    if (this.sidecar !== null) {
      await this.sidecar.stop();
    }

    this.serverState = {
      state: "stopped",
      port: null,
      filesystemRoot: null,
      urls: null,
      image: null,
      version: null,
      updateState: "idle",
      updateError: null,
      error: null,
    };
    this.cloudState = {
      state: "not-synced",
      computer: null,
      error: null,
      lastHeartbeatAt: null,
    };
  }

  private startHeartbeat(intervalSeconds: number): void {
    this.stopHeartbeat();
    const intervalMs = Math.max(intervalSeconds, 5) * 1000;
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (this.cloudServerUrl === null || this.machineToken === null) {
      return;
    }

    try {
      const sidecar = this.getSidecar();
      const runtimeStatus = await sidecar.getRuntimeStatus();
      const machineServerVersion = runtimeStatus?.version ?? this.readMachineServerVersion();
      const response = await this.request<LocalMachineHeartbeatResponse>(
        this.cloudServerUrl,
        "/machines/heartbeat",
        this.machineToken,
        {
          status: runtimeStatus?.safeToRestart === false ? "online" : "idle",
          capabilities: ["filesystem", "agent", "local"],
          machineServerVersion,
        },
      );

      this.cloudState = {
        state: "synced",
        computer: response.computer,
        error: null,
        lastHeartbeatAt: response.computer.lastHeartbeatAt,
      };
      this.serverState = sidecar.getStatus();

      if (response.update?.updateAvailable === true) {
        const result = await sidecar.updateIfIdle(response.update.latest);
        this.serverState = sidecar.getStatus();

        if (result === "updated") {
          await this.sendHeartbeat();
        }
      }
    } catch (error) {
      this.cloudState = {
        ...this.cloudState,
        state: "failed",
        error: error instanceof Error ? error.message : "Local machine heartbeat failed.",
      };
    }
  }

  private getSidecar(): MachineSidecarSupervisor {
    if (this.sidecar === null) {
      this.sidecar = new MachineSidecarSupervisor({
        filesystemRoot: this.electronApp.getPath("desktop"),
      });
    }

    return this.sidecar;
  }

  private readMachineServerVersion(): string {
    return this.sidecar?.getStatus().version ?? "development";
  }

  private async readLocalDeviceIdentity(): Promise<LocalDeviceIdentity> {
    const filePath = this.localDeviceIdPath();
    const currentId = await this.readDeviceIdFile(filePath);
    const legacyIds = await this.readLegacyDeviceIds();
    const migratedId = legacyIds.find((legacyId) => legacyId !== currentId);

    if (migratedId !== undefined) {
      await this.writeDeviceIdFile(filePath, migratedId);
      return {
        localDeviceId: migratedId,
        replacedLocalDeviceIds: currentId === null ? [] : [currentId],
      };
    }

    if (currentId !== null) {
      return { localDeviceId: currentId, replacedLocalDeviceIds: [] };
    }

    const localDeviceId = randomUUID();
    await this.writeDeviceIdFile(filePath, localDeviceId);
    return { localDeviceId, replacedLocalDeviceIds: [] };
  }

  private async readDeviceIdFile(filePath: string): Promise<string | null> {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "localDeviceId" in parsed &&
        typeof parsed.localDeviceId === "string" &&
        parsed.localDeviceId.length > 0
      ) {
        return parsed.localDeviceId;
      }
    } catch {
      // A missing or corrupt id file is replaced with a new stable id.
    }

    return null;
  }

  private async readLegacyDeviceIds(): Promise<string[]> {
    const currentPath = this.localDeviceIdPath();
    const legacyPaths = [
      join(this.electronApp.getPath("appData"), "@ank1015-app", "desktop", "local-machine.json"),
      join(this.electronApp.getPath("appData"), "ank1015 desktop", "local-machine.json"),
    ].filter((path) => path !== currentPath);
    const ids: string[] = [];

    for (const legacyPath of legacyPaths) {
      const id = await this.readDeviceIdFile(legacyPath);

      if (id !== null && !ids.includes(id)) {
        ids.push(id);
      }
    }

    return ids;
  }

  private localDeviceIdPath(): string {
    return join(this.electronApp.getPath("userData"), "local-machine.json");
  }

  private async writeDeviceIdFile(filePath: string, localDeviceId: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ localDeviceId }, null, 2), "utf8");
  }

  private async request<TResponse>(
    cloudServerUrl: string,
    path: string,
    bearerToken: string,
    body: unknown,
  ): Promise<TResponse> {
    const response = await fetch(`${cloudServerUrl}${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${bearerToken}`,
        "content-type": "application/json",
      },
    });
    const responseBody = await readJson(response);

    if (!response.ok) {
      const error = readCloudError(responseBody);
      throw new Error(error);
    }

    return responseBody as TResponse;
  }
}

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();

  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
};

const readCloudError = (body: unknown): string => {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }

  return "Cloud request failed.";
};
