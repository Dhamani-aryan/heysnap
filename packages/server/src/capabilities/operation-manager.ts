import { randomUUID } from "node:crypto";

import { toCapabilityError } from "./errors.js";
import type { AgentCapabilitiesService, InteractiveCapabilityCommand } from "./service.js";
import type {
  CapabilitiesSnapshot,
  CapabilityOperationSnapshot,
  CapabilityOperationStatus,
  CapabilityRestOperation,
} from "./types.js";

const DEFAULT_COMPLETED_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_RECORDS = 100;

interface CapabilityOperationRecord {
  id: string;
  operation: CapabilityRestOperation;
  targetId: string;
  status: CapabilityOperationStatus;
  messages: string[];
  createdAt: string;
  updatedAt: string;
  capabilities?: CapabilitiesSnapshot;
  error?: {
    code: string;
    message: string;
  };
  command?: InteractiveCapabilityCommand;
  completed?: Promise<void>;
}

export interface CapabilitiesOperationManagerOptions {
  readonly service: AgentCapabilitiesService;
  readonly completedTtlMs?: number;
  readonly maxRecords?: number;
}

export class CapabilitiesOperationManager {
  private readonly records = new Map<string, CapabilityOperationRecord>();
  private readonly completedTtlMs: number;
  private readonly maxRecords: number;

  constructor(private readonly options: CapabilitiesOperationManagerOptions) {
    this.completedTtlMs = options.completedTtlMs ?? DEFAULT_COMPLETED_TTL_MS;
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  }

  startInstallTool(toolId: string): CapabilityOperationSnapshot {
    return this.startBackgroundOperation("installTool", toolId, async (record) => {
      await this.options.service.installTool(toolId, (progress) => {
        this.addMessage(record, progress.message);
      });
      return this.options.service.getCapabilities();
    });
  }

  startUpdateTool(toolId: string): CapabilityOperationSnapshot {
    return this.startBackgroundOperation("updateTool", toolId, async (record) => {
      await this.options.service.updateTool(toolId, (progress) => {
        this.addMessage(record, progress.message);
      });
      return this.options.service.getCapabilities();
    });
  }

  async startInteractiveConnectTool(toolId: string): Promise<CapabilityOperationSnapshot> {
    this.prune();
    const record = this.createRecord("connectTool", toolId, "running");
    this.records.set(record.id, record);

    try {
      const command = await this.options.service.startInteractiveConnectTool(toolId, (progress) => {
        this.addMessage(record, progress.message);
      });
      record.command = command;
      this.setStatus(record, "waiting_for_input");
      record.completed = command.completed.then(async () => {
        this.setCompleted(record, await this.options.service.getCapabilities());
      }).catch((error: unknown) => {
        this.setFailed(record, error);
      });
    } catch (error) {
      this.setFailed(record, error);
    }

    this.enforceMaxRecords();
    return toSnapshot(record);
  }

  getOperation(operationId: string): CapabilityOperationSnapshot | null {
    this.prune();
    const record = this.records.get(operationId);
    return record === undefined ? null : toSnapshot(record);
  }

  writeInput(operationId: string, input: string): CapabilityOperationSnapshot | null {
    this.prune();
    const record = this.records.get(operationId);

    if (record === undefined) {
      return null;
    }

    if (record.command !== undefined && record.status === "waiting_for_input") {
      record.command.writeInput(input);
      this.touch(record);
    }

    return toSnapshot(record);
  }

  cancelOperation(operationId: string): CapabilityOperationSnapshot | null {
    this.prune();
    const record = this.records.get(operationId);

    if (record === undefined) {
      return null;
    }

    if (record.status === "running" || record.status === "waiting_for_input") {
      record.command?.cancel();
      this.setStatus(record, "cancelled");
    }

    return toSnapshot(record);
  }

  private startBackgroundOperation(
    operation: CapabilityRestOperation,
    targetId: string,
    action: (record: CapabilityOperationRecord) => Promise<CapabilitiesSnapshot>,
  ): CapabilityOperationSnapshot {
    this.prune();
    const record = this.createRecord(operation, targetId, "running");
    this.records.set(record.id, record);
    record.completed = action(record).then((capabilities) => {
      this.setCompleted(record, capabilities);
    }).catch((error: unknown) => {
      this.setFailed(record, error);
    });
    this.enforceMaxRecords();
    return toSnapshot(record);
  }

  private createRecord(
    operation: CapabilityRestOperation,
    targetId: string,
    status: CapabilityOperationStatus,
  ): CapabilityOperationRecord {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      operation,
      targetId,
      status,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  private addMessage(record: CapabilityOperationRecord, message: string): void {
    const trimmed = message.trim();

    if (trimmed.length === 0) {
      return;
    }

    record.messages.push(trimmed);
    this.touch(record);
  }

  private setCompleted(record: CapabilityOperationRecord, capabilities: CapabilitiesSnapshot): void {
    record.capabilities = capabilities;
    record.command = undefined;
    record.error = undefined;
    this.setStatus(record, "completed");
  }

  private setFailed(record: CapabilityOperationRecord, error: unknown): void {
    const capabilityError = toCapabilityError(error);
    record.command = undefined;
    record.error = {
      code: capabilityError.code,
      message: capabilityError.message,
    };
    this.setStatus(record, "failed");
  }

  private setStatus(record: CapabilityOperationRecord, status: CapabilityOperationStatus): void {
    record.status = status;
    this.touch(record);
  }

  private touch(record: CapabilityOperationRecord): void {
    record.updatedAt = new Date().toISOString();
  }

  private prune(): void {
    const cutoff = Date.now() - this.completedTtlMs;

    for (const [id, record] of this.records) {
      if (record.status === "running" || record.status === "waiting_for_input") {
        continue;
      }

      if (Date.parse(record.updatedAt) < cutoff) {
        this.records.delete(id);
      }
    }

    this.enforceMaxRecords();
  }

  private enforceMaxRecords(): void {
    if (this.records.size <= this.maxRecords) {
      return;
    }

    const removable = Array.from(this.records.values())
      .filter((record) => record.status !== "running" && record.status !== "waiting_for_input")
      .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));

    for (const record of removable) {
      if (this.records.size <= this.maxRecords) {
        return;
      }

      this.records.delete(record.id);
    }
  }
}

const toSnapshot = (record: CapabilityOperationRecord): CapabilityOperationSnapshot => ({
  id: record.id,
  operation: record.operation,
  targetId: record.targetId,
  status: record.status,
  messages: [...record.messages],
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  ...(record.capabilities === undefined ? {} : { capabilities: record.capabilities }),
  ...(record.error === undefined ? {} : { error: record.error }),
});
