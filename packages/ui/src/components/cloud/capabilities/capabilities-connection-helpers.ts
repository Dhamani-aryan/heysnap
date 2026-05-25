import type { AgentToolSnapshot, CapabilityOperationSnapshot } from "../../../cloud/capabilities-client";

import type { ActiveOperationState, ConnectionDialogState } from "./capabilities-types";

export const GITHUB_DEVICE_URL = "https://github.com/login/device";
export const DEVICE_FLOW_TOOL_IDS = new Set(["github", "vercel", "supabase"]);

export const createConnectionDialogState = (
  tool: AgentToolSnapshot,
  operation: CapabilityOperationSnapshot | null,
  parsed: { readonly code: string | null; readonly url: string | null } = { code: null, url: null },
): ConnectionDialogState => ({
  tool,
  code: parsed.code,
  url: parsed.url ?? (tool.id === "github" ? GITHUB_DEVICE_URL : null),
  operationId: operation?.id ?? null,
  error: null,
  isSubmitting: false,
});

export const updateConnectionDialog = (
  current: ConnectionDialogState,
  patch: Pick<ConnectionDialogState, "code" | "url" | "error" | "isSubmitting">,
): ConnectionDialogState =>
  current.code === patch.code &&
  current.url === patch.url &&
  current.error === patch.error &&
  current.isSubmitting === patch.isSubmitting
    ? current
    : { ...current, ...patch };

export const renderConnectorStatus = (tool: AgentToolSnapshot): string => {
  if (tool.installState !== "installed") {
    return "Not installed";
  }

  switch (tool.connectionState) {
    case "connected":
      return "Connected";
    case "disconnected":
      return "Not connected";
    case "error":
      return "Status unavailable";
    case "unknown":
      return "Status unknown";
    case "unsupported":
      return "No connection required";
  }
};

type PendingInput = {
  readonly tool: AgentToolSnapshot;
  readonly activeOperation: ActiveOperationState | null;
  readonly operation: CapabilityOperationSnapshot | undefined;
  readonly installMutation: { readonly isPending: boolean; readonly variables?: string };
  readonly connectMutation: { readonly isPending: boolean; readonly variables?: string };
  readonly disconnectMutation: { readonly isPending: boolean; readonly variables?: string };
};

export const getPendingLabel = ({
  tool,
  activeOperation,
  operation,
  installMutation,
  connectMutation,
  disconnectMutation,
}: PendingInput): string | null => {
  if (
    activeOperation?.toolId === tool.id &&
    (operation === undefined || operation.status === "running" || operation.status === "waiting_for_input")
  ) {
    switch (operation?.operation ?? activeOperation.operation) {
      case "connectTool":
        return "Connecting...";
      case "updateTool":
        return "Updating...";
      case "installTool":
      case undefined:
        return "Installing...";
    }
  }

  if (installMutation.isPending && installMutation.variables === tool.id) {
    return "Installing...";
  }

  if (connectMutation.isPending && connectMutation.variables === tool.id) {
    return "Connecting...";
  }

  if (disconnectMutation.isPending && disconnectMutation.variables === tool.id) {
    return "Disconnecting...";
  }

  return null;
};

export const getConnectionToolName = (tool: AgentToolSnapshot): string =>
  tool.id === "github" ? "GitHub" : tool.label;

export type ConnectionFlow = "readonly-code" | "link-only" | "input-code";

export const getConnectionFlow = (toolId: string): ConnectionFlow => {
  switch (toolId) {
    case "vercel":
      return "link-only";
    case "supabase":
      return "input-code";
    default:
      return "readonly-code";
  }
};

export const formatConnectionError = (tool: AgentToolSnapshot): string =>
  `${getConnectionToolName(tool)} connection could not be completed. Please try again.`;

export const parseConnectionMessages = (
  messages: readonly string[],
  toolId: string,
): { readonly code: string | null; readonly url: string | null } => {
  let code: string | null = null;
  let url: string | null = null;

  for (const message of messages) {
    code = extractDeviceCode(message) ?? code;
    url = extractDeviceUrl(message, toolId) ?? url;
  }

  return { code, url };
};

export const extractDeviceCode = (message: string): string | null => {
  const withoutUrls = normalizeTerminalText(message).replaceAll(/https?:\/\/\S+/g, " ");
  return withoutUrls.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/u)?.[0] ??
    withoutUrls.match(/\b[A-Z0-9]{8}\b/u)?.[0] ??
    null;
};

export const extractDeviceUrl = (message: string, toolId: string): string | null => {
  const text = normalizeTerminalText(message);
  const urls = [...text.matchAll(/https?:\/\/[^\s"'<>]+/gu)]
    .map((match) => trimUrl(match[0]))
    .filter((url) => {
      try {
        const parsed = new URL(url);
        if (toolId === "vercel") {
          return parsed.hostname.endsWith("vercel.com");
        }

        if (toolId === "supabase") {
          return parsed.hostname.endsWith("supabase.com");
        }

        return parsed.hostname.endsWith("github.com");
      } catch {
        return false;
      }
    });

  if (urls.length === 0) {
    return null;
  }

  return urls.find((url) => url.includes("code=") || url.includes("device")) ?? urls[0] ?? null;
};

const trimUrl = (url: string): string =>
  url.replace(/[\].,;:!?]+$/u, "");

export const normalizeTerminalText = (value: string): string =>
  stripTerminalSequences(value)
    .replaceAll("\b", "")
    .replaceAll("\r", "\n")
    .replaceAll(/\p{C}/gu, " ");

export const stripTerminalSequences = (value: string): string =>
  value
    .replaceAll(/\u001B\][\s\S]*?(?:\u0007|\u001B\\)/gu, "")
    .replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "");
