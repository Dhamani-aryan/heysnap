"use client";

export type ToolInstallState = "not_installed" | "installed" | "installing" | "failed";
export type ToolConnectionState = "unsupported" | "unknown" | "connected" | "disconnected" | "error";
export type SkillInstallState = "not_installed" | "installed" | "failed";

export interface AgentToolSnapshot {
  readonly id: string;
  readonly label: string;
  readonly logoUrl?: string;
  readonly command: string;
  readonly desiredVersion: string;
  readonly installedVersion: string | null;
  readonly installState: ToolInstallState;
  readonly connectionState: ToolConnectionState;
  readonly lastError?: string;
  readonly canConnect: boolean;
  readonly canDisconnect: boolean;
  readonly canRefreshStatus: boolean;
  readonly attachedSkillIds?: readonly string[];
}

export interface AgentSkillSnapshot {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly description: string;
  readonly installedVersion: string | null;
  readonly installState: SkillInstallState;
  readonly active: boolean;
  readonly lastError?: string;
}

export interface CapabilitiesSnapshot {
  readonly catalogVersion: string;
  readonly codexBin: string | null;
  readonly tools: readonly AgentToolSnapshot[];
  readonly skills: readonly AgentSkillSnapshot[];
}

export type CapabilityServerMessage =
  | { readonly type: "hello"; readonly serverTime: string }
  | { readonly type: "capabilities"; readonly requestId: string; readonly capabilities: CapabilitiesSnapshot }
  | { readonly type: "operationStarted"; readonly requestId: string; readonly operationId: string; readonly operation: string; readonly targetId: string }
  | { readonly type: "operationProgress"; readonly requestId: string; readonly operationId: string; readonly message: string }
  | { readonly type: "operationCompleted"; readonly requestId: string; readonly operationId: string; readonly capabilities: CapabilitiesSnapshot }
  | { readonly type: "operationFailed"; readonly requestId: string; readonly operationId: string; readonly code: string; readonly message: string }
  | { readonly type: "toolStatus"; readonly requestId: string; readonly tool: AgentToolSnapshot }
  | { readonly type: "skillStatus"; readonly requestId: string; readonly skill: AgentSkillSnapshot }
  | { readonly type: "error"; readonly requestId?: string; readonly code: string; readonly message: string }
  | { readonly type: "pong"; readonly requestId: string; readonly serverTime: string };

export class CapabilitiesClient {
  private socket: WebSocket | null = null;
  private requestCounter = 0;
  private readonly listeners = new Set<(message: CapabilityServerMessage) => void>();

  constructor(private readonly websocketUrl: string) {}

  connect(): void {
    if (this.socket !== null) {
      return;
    }

    const socket = new WebSocket(this.websocketUrl);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      void parseMessage(event.data).then((message) => {
        for (const listener of this.listeners) {
          listener(message);
        }
      });
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) {
        this.socket = null;
      }
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
    this.listeners.clear();
  }

  subscribe(listener: (message: CapabilityServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  listCapabilities(): void {
    this.send({ type: "listCapabilities", requestId: this.nextRequestId() });
  }

  installTool(toolId: string): void {
    this.send({ type: "installTool", requestId: this.nextRequestId(), toolId });
  }

  updateTool(toolId: string): void {
    this.send({ type: "updateTool", requestId: this.nextRequestId(), toolId });
  }

  connectTool(toolId: string): void {
    this.send({ type: "connectTool", requestId: this.nextRequestId(), toolId });
  }

  sendToolInput(operationId: string, input: string): void {
    this.send({ type: "sendToolInput", requestId: this.nextRequestId(), operationId, input });
  }

  disconnectTool(toolId: string): void {
    this.send({ type: "disconnectTool", requestId: this.nextRequestId(), toolId });
  }

  refreshToolStatus(toolId: string): void {
    this.send({ type: "refreshToolStatus", requestId: this.nextRequestId(), toolId });
  }

  setSkillActive(skillId: string, active: boolean): void {
    this.send({ type: "setSkillActive", requestId: this.nextRequestId(), skillId, active });
  }

  private send(message: Record<string, unknown>): void {
    const socket = this.socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(message));
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `capabilities-${String(this.requestCounter)}`;
  }
}

const parseMessage = async (data: unknown): Promise<CapabilityServerMessage> => {
  const text = typeof data === "string" ? data : await (data as Blob).text();
  return JSON.parse(text) as CapabilityServerMessage;
};
