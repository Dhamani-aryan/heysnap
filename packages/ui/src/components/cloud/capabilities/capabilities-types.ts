import type { AgentToolSnapshot, CapabilityOperationName } from "../../../cloud/capabilities-client";

export interface ConnectionDialogState {
  readonly tool: AgentToolSnapshot;
  readonly code: string | null;
  readonly url: string | null;
  readonly operationId: string | null;
  readonly error: string | null;
  readonly isSubmitting: boolean;
}

export interface ActiveOperationState {
  readonly operationId: string;
  readonly operation: CapabilityOperationName;
  readonly toolId: string;
}
