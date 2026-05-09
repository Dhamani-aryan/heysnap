export type CapabilityOperation =
  | "installTool"
  | "updateTool"
  | "connectTool"
  | "disconnectTool"
  | "refreshToolStatus"
  | "installSkill"
  | "setSkillActive";

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
  readonly activeSkillsDir: string;
}

export interface CapabilitiesSnapshot {
  readonly catalogVersion: string;
  readonly codexBin: string | null;
  readonly tools: readonly AgentToolSnapshot[];
  readonly skills: readonly AgentSkillSnapshot[];
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

export type CapabilityClientMessage =
  | { readonly type: "listCapabilities"; readonly requestId: string }
  | { readonly type: "installTool"; readonly requestId: string; readonly toolId: string }
  | { readonly type: "updateTool"; readonly requestId: string; readonly toolId: string }
  | { readonly type: "connectTool"; readonly requestId: string; readonly toolId: string }
  | { readonly type: "sendToolInput"; readonly requestId: string; readonly operationId: string; readonly input: string }
  | { readonly type: "disconnectTool"; readonly requestId: string; readonly toolId: string }
  | { readonly type: "refreshToolStatus"; readonly requestId: string; readonly toolId: string }
  | { readonly type: "installSkill"; readonly requestId: string; readonly skillId: string }
  | { readonly type: "setSkillActive"; readonly requestId: string; readonly skillId: string; readonly active: boolean }
  | { readonly type: "ping"; readonly requestId: string };

export type CapabilityServerMessage =
  | { readonly type: "hello"; readonly serverTime: string }
  | { readonly type: "capabilities"; readonly requestId: string; readonly capabilities: CapabilitiesSnapshot }
  | {
      readonly type: "operationStarted";
      readonly requestId: string;
      readonly operationId: string;
      readonly operation: CapabilityOperation;
      readonly targetId: string;
    }
  | { readonly type: "operationProgress"; readonly requestId: string; readonly operationId: string; readonly message: string }
  | {
      readonly type: "operationCompleted";
      readonly requestId: string;
      readonly operationId: string;
      readonly capabilities: CapabilitiesSnapshot;
    }
  | { readonly type: "operationFailed"; readonly requestId: string; readonly operationId: string; readonly code: string; readonly message: string }
  | { readonly type: "toolStatus"; readonly requestId: string; readonly tool: AgentToolSnapshot }
  | { readonly type: "skillStatus"; readonly requestId: string; readonly skill: AgentSkillSnapshot }
  | { readonly type: "error"; readonly requestId?: string; readonly code: string; readonly message: string }
  | { readonly type: "pong"; readonly requestId: string; readonly serverTime: string };
