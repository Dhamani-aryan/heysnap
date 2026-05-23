export type CapabilityRestOperation = "installTool" | "updateTool" | "connectTool";

export type CapabilityOperationStatus = "running" | "waiting_for_input" | "completed" | "failed" | "cancelled";

export type ToolInstallState = "not_installed" | "installed" | "installing" | "failed";
export type ToolConnectionState = "unsupported" | "unknown" | "connected" | "disconnected" | "error";
export type SkillInstallState = "not_installed" | "installed" | "failed";

export interface CapabilityCommand {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Record<string, string>;
  readonly interactive?: "tty";
}

export type ToolInstallStrategy =
  | { readonly type: "existing" }
  | { readonly type: "npm"; readonly packageName: string; readonly binaryName: string };

export interface AgentToolDefinition {
  readonly id: string;
  readonly label: string;
  readonly logoUrl?: string;
  readonly command: string;
  readonly desiredVersion: string;
  readonly installStrategy: ToolInstallStrategy;
  readonly required?: boolean;
  readonly versionCommand?: CapabilityCommand;
  readonly connect?: CapabilityCommand;
  readonly disconnect?: CapabilityCommand;
  readonly status?: CapabilityCommand;
  readonly attachedSkillIds?: readonly string[];
}

export interface AgentSkillDefinition {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly description: string;
  readonly activeByDefault?: boolean;
  readonly sourcePath: string;
}

export interface CapabilitiesCatalog {
  readonly version: string;
  readonly tools: readonly AgentToolDefinition[];
  readonly skills: readonly AgentSkillDefinition[];
  readonly codexToolId: string;
}

export interface AgentToolState {
  readonly id: string;
  readonly installedVersion: string | null;
  readonly installState: ToolInstallState;
  readonly connectionState: ToolConnectionState;
  readonly lastError?: string;
  readonly updatedAt: string;
}

export interface AgentSkillState {
  readonly id: string;
  readonly installedVersion: string | null;
  readonly installState: SkillInstallState;
  readonly active: boolean;
  readonly lastError?: string;
  readonly updatedAt: string;
}

export interface CapabilityState {
  readonly catalogVersion: string;
  readonly codexBin: string | null;
  readonly tools: Record<string, AgentToolState>;
  readonly skills: Record<string, AgentSkillState>;
  readonly updatedAt: string;
}

export interface CapabilityPaths {
  readonly stateFile: string;
  readonly toolsRoot: string;
  readonly toolsBinDir: string;
  readonly skillsCatalogDir: string;
}

export interface CapabilitiesSnapshot {
  readonly catalogVersion: string;
  readonly codexBin: string | null;
  readonly tools: readonly AgentToolSnapshot[];
  readonly skills: readonly AgentSkillSnapshot[];
}

export interface CapabilityOperationSnapshot {
  readonly id: string;
  readonly operation: CapabilityRestOperation;
  readonly targetId: string;
  readonly status: CapabilityOperationStatus;
  readonly messages: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly capabilities?: CapabilitiesSnapshot;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface AgentToolSnapshot extends AgentToolDefinition {
  readonly installedVersion: string | null;
  readonly installState: ToolInstallState;
  readonly connectionState: ToolConnectionState;
  readonly lastError?: string;
  readonly canConnect: boolean;
  readonly canDisconnect: boolean;
  readonly canRefreshStatus: boolean;
}

export interface AgentSkillSnapshot extends Omit<AgentSkillDefinition, "sourcePath"> {
  readonly installedVersion: string | null;
  readonly installState: SkillInstallState;
  readonly active: boolean;
  readonly lastError?: string;
}
