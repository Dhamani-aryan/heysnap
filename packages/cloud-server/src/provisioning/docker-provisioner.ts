import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ComputerRecord } from "../db/types.js";
import type {
  CommandExecutor,
  ComputerProvisioner,
  ProvisionComputerInput,
  ProvisionComputerResult,
} from "./types.js";

const execFileAsync = promisify(execFile);
const DEFAULT_IMAGE = "ank1015-machine-local:latest";
const DEFAULT_NETWORK = "ank1015-local";
const DEFAULT_CLOUD_URL = "http://host.docker.internal:4100";

export interface DockerMachineProvisionerOptions {
  readonly executor?: CommandExecutor;
}

export class DockerMachineProvisioner implements ComputerProvisioner {
  private readonly executor: CommandExecutor;

  constructor(options: DockerMachineProvisionerOptions = {}) {
    this.executor = options.executor ?? runCommand;
  }

  async provisionComputer(input: ProvisionComputerInput): Promise<ProvisionComputerResult> {
    const image = input.config.localDockerMachineImage?.trim() || DEFAULT_IMAGE;
    const network = input.config.localDockerNetwork?.trim() || DEFAULT_NETWORK;
    const cloudUrl = input.config.localDockerCloudUrl?.trim() || DEFAULT_CLOUD_URL;
    const containerName = containerNameForComputer(input.computer.id);
    const workspaceVolume = workspaceVolumeForComputer(input.computer.id);
    await this.ensureNetwork(network);
    const result = await this.executor("docker", [
      "run",
      "-d",
      "--name",
      containerName,
      "--label",
      "ank1015:kind=machine",
      "--label",
      `ank1015:computer-id=${input.computer.id}`,
      "--network",
      network,
      "--add-host",
      "host.docker.internal:host-gateway",
      "--restart",
      "unless-stopped",
      "-v",
      `${workspaceVolume}:/workspace`,
      "-e",
      `CLOUD_SERVER_PUBLIC_URL=${cloudUrl}`,
      "-e",
      `ANK1015_COMPUTER_ID=${input.computer.id}`,
      "-e",
      `ANK1015_BOOTSTRAP_TOKEN=${input.bootstrapToken}`,
      "-e",
      `MACHINE_SERVER_CHANNEL=${input.config.machineServerChannel}`,
      "-e",
      "ANK1015_MACHINE_SUPERVISOR=process",
      image,
    ]);
    const containerId = result.stdout.trim();

    return {
      providerMetadata: markAction({
        provider: "docker",
        containerId,
        containerName,
        image,
        network,
        workspaceVolume,
      }, "provision"),
    };
  }

  async startComputer(computer: ComputerRecord): Promise<Record<string, unknown>> {
    const metadata = readDockerMetadata(computer);
    await this.executor("docker", ["start", metadata.containerName]);
    return markAction(metadata, "start");
  }

  async stopComputer(computer: ComputerRecord): Promise<Record<string, unknown>> {
    const metadata = readDockerMetadata(computer);
    await this.executor("docker", ["stop", metadata.containerName]);
    return markAction(metadata, "stop");
  }

  async restartComputer(computer: ComputerRecord): Promise<Record<string, unknown>> {
    const metadata = readDockerMetadata(computer);
    await this.executor("docker", ["restart", metadata.containerName]);
    return markAction(metadata, "restart");
  }

  async terminateComputer(computer: ComputerRecord): Promise<Record<string, unknown>> {
    const metadata = readDockerMetadata(computer);
    await this.executor("docker", ["rm", "-f", metadata.containerName]).catch(ignoreMissingContainer);
    await this.executor("docker", ["volume", "rm", "-f", metadata.workspaceVolume]).catch(ignoreMissingContainer);
    return markAction(metadata, "terminate");
  }

  private async ensureNetwork(network: string): Promise<void> {
    const inspected = await this.executor("docker", ["network", "inspect", network]).then(
      () => true,
      () => false,
    );

    if (!inspected) {
      await this.executor("docker", ["network", "create", network]);
    }
  }
}

export const containerNameForComputer = (computerId: string): string =>
  `ank1015-machine-${computerId}`;

export const workspaceVolumeForComputer = (computerId: string): string =>
  `ank1015-workspace-${computerId}`;

interface DockerProviderMetadata {
  readonly provider: "docker";
  readonly containerId?: string;
  readonly containerName: string;
  readonly image: string;
  readonly network: string;
  readonly workspaceVolume: string;
  readonly lastAction?: string;
  readonly lastActionAt?: string;
}

const readDockerMetadata = (computer: ComputerRecord): DockerProviderMetadata => {
  const metadata = computer.providerMetadata;

  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new Error("Computer is not backed by a Docker container");
  }

  const record = metadata as Record<string, unknown>;

  if (
    record["provider"] !== "docker" ||
    typeof record["containerName"] !== "string" ||
    typeof record["image"] !== "string" ||
    typeof record["network"] !== "string" ||
    typeof record["workspaceVolume"] !== "string"
  ) {
    throw new Error("Computer is not backed by a Docker container");
  }

  return {
    provider: "docker",
    containerId: typeof record["containerId"] === "string" ? record["containerId"] : undefined,
    containerName: record["containerName"],
    image: record["image"],
    network: record["network"],
    workspaceVolume: record["workspaceVolume"],
    lastAction: typeof record["lastAction"] === "string" ? record["lastAction"] : undefined,
    lastActionAt: typeof record["lastActionAt"] === "string" ? record["lastActionAt"] : undefined,
  };
};

const markAction = (
  metadata: DockerProviderMetadata | Record<string, unknown>,
  action: string,
): Record<string, unknown> => ({
  ...metadata,
  lastAction: action,
  lastActionAt: new Date().toISOString(),
});

const runCommand: CommandExecutor = async (command, args) => {
  const result = await execFileAsync(command, [...args], { encoding: "utf8" });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

const ignoreMissingContainer = (error: unknown): void => {
  if (error instanceof Error && /No such/.test(error.message)) {
    return;
  }

  throw error;
};
