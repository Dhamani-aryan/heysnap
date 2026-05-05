import type { CloudServerConfig } from "../config.js";
import type { ComputerRecord } from "../db/types.js";

export interface ProvisionComputerInput {
  readonly computer: ComputerRecord;
  readonly bootstrapToken: string;
  readonly config: CloudServerConfig;
}

export interface ProvisionComputerResult {
  readonly providerMetadata: Record<string, unknown>;
}

export interface ComputerProvisioner {
  provisionComputer(input: ProvisionComputerInput): Promise<ProvisionComputerResult>;
  startComputer(computer: ComputerRecord): Promise<Record<string, unknown>>;
  stopComputer(computer: ComputerRecord): Promise<Record<string, unknown>>;
  restartComputer(computer: ComputerRecord): Promise<Record<string, unknown>>;
  terminateComputer(computer: ComputerRecord): Promise<Record<string, unknown>>;
}
