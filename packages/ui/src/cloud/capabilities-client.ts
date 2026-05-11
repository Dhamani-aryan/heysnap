"use client";

export type ToolInstallState = "not_installed" | "installed" | "installing" | "failed";
export type ToolConnectionState = "unsupported" | "unknown" | "connected" | "disconnected" | "error";
export type SkillInstallState = "not_installed" | "installed" | "failed";
export type CapabilityOperationStatus = "running" | "waiting_for_input" | "completed" | "failed" | "cancelled";
export type CapabilityOperationName = "installTool" | "updateTool" | "connectTool";

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

export interface CapabilityOperationSnapshot {
  readonly id: string;
  readonly operation: CapabilityOperationName;
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

export interface CapabilitiesResponse {
  readonly capabilities: CapabilitiesSnapshot;
}

export interface CapabilityOperationResponse {
  readonly operation: CapabilityOperationSnapshot;
}

export class CapabilitiesApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CapabilitiesApiError";
    this.status = status;
    this.code = code;
  }
}

export const getCapabilities = (baseUrl: string): Promise<CapabilitiesResponse> =>
  requestJson<CapabilitiesResponse>(baseUrl);

export const installTool = (baseUrl: string, toolId: string): Promise<CapabilityOperationResponse> =>
  requestJson<CapabilityOperationResponse>(toolActionUrl(baseUrl, toolId, "install"), { method: "POST" });

export const updateTool = (baseUrl: string, toolId: string): Promise<CapabilityOperationResponse> =>
  requestJson<CapabilityOperationResponse>(toolActionUrl(baseUrl, toolId, "update"), { method: "POST" });

export const connectTool = (
  baseUrl: string,
  toolId: string,
): Promise<CapabilitiesResponse | CapabilityOperationResponse> =>
  requestJson<CapabilitiesResponse | CapabilityOperationResponse>(toolActionUrl(baseUrl, toolId, "connect"), {
    method: "POST",
  });

export const disconnectTool = (baseUrl: string, toolId: string): Promise<CapabilitiesResponse> =>
  requestJson<CapabilitiesResponse>(toolActionUrl(baseUrl, toolId, "disconnect"), { method: "POST" });

export const refreshToolStatus = (baseUrl: string, toolId: string): Promise<CapabilitiesResponse> =>
  requestJson<CapabilitiesResponse>(toolActionUrl(baseUrl, toolId, "refresh-status"), { method: "POST" });

export const getCapabilityOperation = (
  baseUrl: string,
  operationId: string,
): Promise<CapabilityOperationResponse> =>
  requestJson<CapabilityOperationResponse>(operationUrl(baseUrl, operationId));

export const sendCapabilityOperationInput = (
  baseUrl: string,
  operationId: string,
  input: string,
): Promise<CapabilityOperationResponse> =>
  requestJson<CapabilityOperationResponse>(operationInputUrl(baseUrl, operationId), {
    method: "POST",
    body: JSON.stringify({ input }),
    headers: { "content-type": "application/json" },
  });

export const cancelCapabilityOperation = (
  baseUrl: string,
  operationId: string,
): Promise<CapabilityOperationResponse> =>
  requestJson<CapabilityOperationResponse>(operationUrl(baseUrl, operationId), { method: "DELETE" });

export const isCapabilityOperationResponse = (
  value: CapabilitiesResponse | CapabilityOperationResponse,
): value is CapabilityOperationResponse =>
  "operation" in value;

const toolActionUrl = (baseUrl: string, toolId: string, action: string): string =>
  joinUrl(baseUrl, `tools/${encodeURIComponent(toolId)}/${action}`);

const operationUrl = (baseUrl: string, operationId: string): string =>
  joinUrl(baseUrl, `operations/${encodeURIComponent(operationId)}`);

const operationInputUrl = (baseUrl: string, operationId: string): string =>
  joinUrl(baseUrl, `operations/${encodeURIComponent(operationId)}/input`);

const joinUrl = (baseUrl: string, suffix: string): string => {
  const [path, query = ""] = baseUrl.split("?", 2);
  return `${path.replace(/\/+$/u, "")}/${suffix}${query.length === 0 ? "" : `?${query}`}`;
};

const requestJson = async <TResponse,>(url: string, init: RequestInit = {}): Promise<TResponse> => {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = null;

  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new CapabilitiesApiError(
        response.status,
        "INVALID_CAPABILITIES_RESPONSE",
        response.ok
          ? "Connectors API returned a non-JSON response. The machine server may need to be restarted or updated."
          : text,
      );
    }
  }

  if (!response.ok) {
    const error = readApiError(body);
    throw new CapabilitiesApiError(response.status, error.code, error.message);
  }

  return body as TResponse;
};

const readApiError = (body: unknown): { readonly code: string; readonly message: string } => {
  if (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    typeof (body as Record<string, unknown>)["error"] === "object" &&
    (body as Record<string, unknown>)["error"] !== null
  ) {
    const error = (body as { readonly error: Record<string, unknown> }).error;
    return {
      code: typeof error["code"] === "string" ? error["code"] : "CAPABILITIES_ERROR",
      message: typeof error["message"] === "string" ? error["message"] : "Capabilities request failed.",
    };
  }

  return { code: "CAPABILITIES_ERROR", message: "Capabilities request failed." };
};
