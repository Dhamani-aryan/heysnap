import { spawn } from "node:child_process";
import { createServer } from "node:net";

export interface MachineServerReleaseManifest {
  readonly version: string;
  readonly dockerImage: string | null;
}

export interface MachineServerRuntimeStatus {
  readonly ok: true;
  readonly version: string;
  readonly activeSessions: {
    readonly filesystem: number;
    readonly agent: number;
    readonly total: number;
  };
  readonly safeToRestart: boolean;
}

export interface MachineSidecarStatus {
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
}

export interface MachineSidecarOptions {
  readonly filesystemRoot: string;
  readonly image?: string;
  readonly version?: string;
  readonly containerName?: string;
  readonly preferredPort?: number;
}

const CONTAINER_PORT = 4000;
const DEFAULT_IMAGE = "ank1015-machine-server:development";
const DEFAULT_VERSION = "development";

export class MachineSidecarSupervisor {
  private readonly filesystemRoot: string;
  private readonly containerName: string;
  private readonly preferredPort: number;
  private image: string;
  private version: string;
  private status: MachineSidecarStatus;

  constructor(options: MachineSidecarOptions) {
    this.filesystemRoot = options.filesystemRoot;
    this.containerName = options.containerName ?? "heysnap-local-machine-server";
    this.preferredPort = options.preferredPort ?? 4000;
    this.image = options.image?.trim() || process.env.MACHINE_SERVER_IMAGE?.trim() || DEFAULT_IMAGE;
    this.version = options.version?.trim() || process.env.MACHINE_SERVER_VERSION?.trim() || readImageTag(this.image) || DEFAULT_VERSION;
    this.status = {
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
  }

  getStatus(): MachineSidecarStatus {
    return this.status;
  }

  async start(): Promise<MachineSidecarStatus> {
    this.status = {
      ...this.status,
      state: "starting",
      error: null,
      updateError: null,
    };

    try {
      await runCommand("docker", ["version", "--format", "{{.Server.Version}}"]);
      const port = await findAvailablePort(this.preferredPort);
      await this.ensureImage(this.image);
      await this.startContainer(this.image, this.version, port);
      await this.waitForRuntimeStatus(port);
      this.markRunning(port, this.image, this.version);
      return this.status;
    } catch (error) {
      this.status = {
        ...this.status,
        state: "failed",
        port: null,
        filesystemRoot: null,
        urls: null,
        image: this.image,
        version: this.version,
        error: renderError(error),
      };
      throw error;
    }
  }

  async stop(): Promise<void> {
    await removeContainer(this.containerName);
    this.status = {
      ...this.status,
      state: "stopped",
      port: null,
      filesystemRoot: null,
      urls: null,
      error: null,
    };
  }

  async getRuntimeStatus(): Promise<MachineServerRuntimeStatus | null> {
    if (this.status.port === null) {
      return null;
    }

    return await fetchRuntimeStatus(this.status.port);
  }

  async updateIfIdle(release: MachineServerReleaseManifest | null): Promise<"updated" | "deferred" | "skipped" | "failed"> {
    if (release === null || release.dockerImage === null || release.version === this.version) {
      return "skipped";
    }

    this.status = { ...this.status, updateState: "checking", updateError: null };
    const runtimeStatus = await this.getRuntimeStatus();

    if (runtimeStatus !== null && !runtimeStatus.safeToRestart) {
      this.status = { ...this.status, updateState: "deferred" };
      return "deferred";
    }

    const previousImage = this.image;
    const previousVersion = this.version;
    const port = this.status.port ?? await findAvailablePort(this.preferredPort);

    try {
      this.status = { ...this.status, updateState: "pulling", updateError: null };
      await this.pullImage(release.dockerImage);
      this.status = { ...this.status, updateState: "restarting" };
      await this.startContainer(release.dockerImage, release.version, port);
      await this.waitForRuntimeStatus(port);
      this.image = release.dockerImage;
      this.version = release.version;
      this.markRunning(port, this.image, this.version);
      this.status = { ...this.status, updateState: "idle", updateError: null };
      return "updated";
    } catch (error) {
      await this.rollback(previousImage, previousVersion, port);
      this.status = {
        ...this.status,
        updateState: "failed",
        updateError: renderError(error),
      };
      return "failed";
    }
  }

  private async ensureImage(image: string): Promise<void> {
    if (await imageExists(image)) {
      return;
    }

    await this.pullImage(image);
  }

  private async pullImage(image: string): Promise<void> {
    await loginToEcrIfNeeded(image);
    await runCommand("docker", ["pull", image]);
  }

  private async startContainer(image: string, version: string, port: number): Promise<void> {
    await removeContainer(this.containerName);
    await runCommand("docker", [
      "run",
      "-d",
      "--name",
      this.containerName,
      "-p",
      `127.0.0.1:${String(port)}:${String(CONTAINER_PORT)}`,
      "-e",
      `PORT=${String(CONTAINER_PORT)}`,
      "-e",
      "HOST=0.0.0.0",
      "-e",
      "ANK1015_FILESYSTEM_ROOT=/workspace",
      "-e",
      `MACHINE_SERVER_VERSION=${version}`,
      "-v",
      `${this.filesystemRoot}:/workspace`,
      image,
    ]);
  }

  private async waitForRuntimeStatus(port: number): Promise<void> {
    const deadline = Date.now() + 20_000;

    while (Date.now() < deadline) {
      const status = await fetchRuntimeStatus(port);

      if (status !== null) {
        return;
      }

      await sleep(300);
    }

    const logs = await runCommand("docker", ["logs", "--tail", "80", this.containerName]).catch((error) => renderError(error));
    throw new Error(`Machine server did not become healthy. ${logs}`);
  }

  private async rollback(image: string, version: string, port: number): Promise<void> {
    try {
      await this.startContainer(image, version, port);
      await this.waitForRuntimeStatus(port);
      this.image = image;
      this.version = version;
      this.markRunning(port, image, version);
    } catch {
      this.status = {
        ...this.status,
        state: "failed",
        error: "Machine server update failed and rollback did not start.",
      };
    }
  }

  private markRunning(port: number, image: string, version: string): void {
    this.status = {
      ...this.status,
      state: "running",
      port,
      filesystemRoot: this.filesystemRoot,
      urls: {
        filesystemWebSocketUrl: `ws://127.0.0.1:${String(port)}/filesystem`,
        agentWebSocketUrl: `ws://127.0.0.1:${String(port)}/agent`,
      },
      image,
      version,
      error: null,
    };
  }
}

const fetchRuntimeStatus = async (port: number): Promise<MachineServerRuntimeStatus | null> => {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/status`);

    if (!response.ok) {
      return null;
    }

    const body = await response.json() as unknown;

    if (!isMachineServerRuntimeStatus(body)) {
      return null;
    }

    return body;
  } catch {
    return null;
  }
};

const isMachineServerRuntimeStatus = (value: unknown): value is MachineServerRuntimeStatus => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const activeSessions = record["activeSessions"];

  return record["ok"] === true &&
    typeof record["version"] === "string" &&
    typeof activeSessions === "object" &&
    activeSessions !== null &&
    typeof (activeSessions as Record<string, unknown>)["total"] === "number" &&
    typeof record["safeToRestart"] === "boolean";
};

const imageExists = async (image: string): Promise<boolean> => {
  try {
    await runCommand("docker", ["image", "inspect", image]);
    return true;
  } catch {
    return false;
  }
};

const removeContainer = async (containerName: string): Promise<void> => {
  await runCommand("docker", ["rm", "-f", containerName]).catch(() => undefined);
};

const loginToEcrIfNeeded = async (image: string): Promise<void> => {
  const registry = image.split("/", 1)[0] ?? "";

  if (!registry.includes(".dkr.ecr.") || !registry.includes(".amazonaws.com")) {
    return;
  }

  const region = registry.split(".")[3];

  if (region === undefined || region.length === 0) {
    return;
  }

  const password = await runCommand("aws", ["ecr", "get-login-password", "--region", region]);
  await runCommand("docker", ["login", "--username", "AWS", "--password-stdin", registry], password);
};

const runCommand = (
  command: string,
  args: readonly string[],
  input?: string,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed: ${stderr.trim() || stdout.trim()}`));
    });

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });

const findAvailablePort = (preferredPort: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", () => {
      const fallback = createServer();
      fallback.once("error", reject);
      fallback.listen(0, "127.0.0.1", () => {
        const address = fallback.address();
        fallback.close(() => {
          if (typeof address === "object" && address !== null) {
            resolve(address.port);
            return;
          }

          reject(new Error("Failed to allocate a local port."));
        });
      });
    });
    server.listen(preferredPort, "127.0.0.1", () => {
      server.close(() => {
        resolve(preferredPort);
      });
    });
  });

const readImageTag = (image: string): string | null => {
  const lastSegment = image.split("/").at(-1) ?? "";
  const tag = lastSegment.includes(":") ? lastSegment.split(":").at(-1) ?? "" : "";
  return tag.length === 0 ? null : tag;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const renderError = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown machine server sidecar error.";
