"use client";

import { Cancel01Icon, CopyIcon, RefreshIcon, Search01Icon, Share04Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  isCapabilityOperationResponse,
  type AgentToolSnapshot,
  type CapabilityOperationName,
  type CapabilityOperationSnapshot,
} from "./capabilities-client";
import {
  setCapabilitiesQueryData,
  useCancelCapabilityOperationMutation,
  useCapabilitiesQuery,
  useCapabilityOperationQuery,
  useConnectToolMutation,
  useDisconnectToolMutation,
  useInstallToolMutation,
  useSendCapabilityOperationInputMutation,
} from "./queries/use-capabilities-queries";

const GITHUB_DEVICE_URL = "https://github.com/login/device";
const DEVICE_FLOW_TOOL_IDS = new Set(["github", "vercel", "supabase"]);

export interface CapabilitiesPanelProps {
  readonly capabilitiesBaseUrl?: string;
  readonly showTopbar?: boolean;
}

interface ConnectionDialogState {
  readonly tool: AgentToolSnapshot;
  readonly code: string | null;
  readonly url: string | null;
  readonly operationId: string | null;
  readonly error: string | null;
  readonly isSubmitting: boolean;
}

interface ActiveOperationState {
  readonly operationId: string;
  readonly operation: CapabilityOperationName;
  readonly toolId: string;
}

export function CapabilitiesPanel({
  capabilitiesBaseUrl,
  showTopbar = true,
}: CapabilitiesPanelProps): React.ReactElement {
  const queryClient = useQueryClient();
  const capabilitiesQuery = useCapabilitiesQuery(capabilitiesBaseUrl);
  const installMutation = useInstallToolMutation(capabilitiesBaseUrl);
  const connectMutation = useConnectToolMutation(capabilitiesBaseUrl);
  const disconnectMutation = useDisconnectToolMutation(capabilitiesBaseUrl);
  const sendInputMutation = useSendCapabilityOperationInputMutation(capabilitiesBaseUrl);
  const cancelOperationMutation = useCancelCapabilityOperationMutation(capabilitiesBaseUrl);
  const [search, setSearch] = useState("");
  const [activeOperation, setActiveOperation] = useState<ActiveOperationState | null>(null);
  const [connectionDialog, setConnectionDialog] = useState<ConnectionDialogState | null>(null);
  const operationQuery = useCapabilityOperationQuery(capabilitiesBaseUrl, activeOperation?.operationId ?? null);
  const operation = operationQuery.data;
  const capabilities = capabilitiesQuery.data?.capabilities ?? null;
  const connectors = useMemo(
    () => (capabilities?.tools ?? []).filter((tool) => tool.canConnect || tool.canDisconnect),
    [capabilities],
  );
  const visibleConnectors = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (query.length === 0) {
      return connectors;
    }

    return connectors.filter((tool) =>
      tool.label.toLowerCase().includes(query) || tool.command.toLowerCase().includes(query)
    );
  }, [connectors, search]);

  useEffect(() => {
    if (capabilitiesBaseUrl === undefined || operation?.capabilities === undefined) {
      return;
    }

    setCapabilitiesQueryData(queryClient, capabilitiesBaseUrl, operation.capabilities);
  }, [capabilitiesBaseUrl, operation?.capabilities, queryClient]);

  useEffect(() => {
    if (operation === undefined) {
      return;
    }

    if (operation.status === "cancelled") {
      setConnectionDialog((current) => current?.operationId === operation.id ? null : current);
      setActiveOperation((current) => current?.operationId === operation.id ? null : current);
      return;
    }

    if (operation.status === "completed") {
      const connectedTool = operation.capabilities?.tools.find((tool) => tool.id === activeOperation?.toolId);
      if (connectedTool?.connectionState === "connected") {
        setConnectionDialog((current) => current?.operationId === operation.id ? null : current);
        setActiveOperation((current) => current?.operationId === operation.id ? null : current);
        return;
      }
    }

    if (operation.status === "failed") {
      setConnectionDialog((current) => {
        if (current === null || current.operationId !== operation.id) {
          return current;
        }

        const parsed = parseConnectionMessages(operation.messages, current.tool.id);
        return updateConnectionDialog(current, {
          code: parsed.code ?? current.code,
          url: parsed.url ?? current.url,
          error: operation.error?.message ?? formatConnectionError(current.tool),
          isSubmitting: false,
        });
      });
      setActiveOperation((current) => current?.operationId === operation.id ? null : current);
      return;
    }

    setConnectionDialog((current) => {
      if (current === null || current.operationId !== operation.id) {
        return current;
      }

      const parsed = parseConnectionMessages(operation.messages, current.tool.id);
      return updateConnectionDialog(current, {
        code: parsed.code ?? current.code,
        url: parsed.url ?? current.url,
        error: null,
        isSubmitting: false,
      });
    });
  }, [activeOperation?.toolId, operation]);

  useEffect(() => {
    if (operation === undefined || connectionDialog !== null) {
      return;
    }

    if (operation.status === "completed" || operation.status === "failed" || operation.status === "cancelled") {
      setActiveOperation(null);
    }
  }, [connectionDialog, operation]);

  const refresh = useCallback(() => {
    void capabilitiesQuery.refetch();
  }, [capabilitiesQuery]);

  const installTool = useCallback((tool: AgentToolSnapshot): void => {
    void installMutation.mutateAsync(tool.id).then((response) => {
      setActiveOperation({ operationId: response.operation.id, operation: response.operation.operation, toolId: tool.id });
    });
  }, [installMutation]);

  const connectTool = useCallback((tool: AgentToolSnapshot): void => {
    if (DEVICE_FLOW_TOOL_IDS.has(tool.id)) {
      setConnectionDialog(createConnectionDialogState(tool, null));
    }

    void connectMutation.mutateAsync(tool.id).then((response) => {
      if (!isCapabilityOperationResponse(response)) {
        setConnectionDialog(null);
        return;
      }

      setActiveOperation({ operationId: response.operation.id, operation: response.operation.operation, toolId: tool.id });
      const parsed = parseConnectionMessages(response.operation.messages, tool.id);
      setConnectionDialog((current) => current === null
        ? createConnectionDialogState(tool, response.operation, parsed)
        : {
            ...current,
            operationId: response.operation.id,
            code: parsed.code ?? current.code,
            url: parsed.url ?? current.url,
            error: null,
          });
    }).catch((error) => {
      if (!DEVICE_FLOW_TOOL_IDS.has(tool.id)) {
        return;
      }

      setConnectionDialog((current) => current === null ? null : {
        ...current,
        error: error instanceof Error ? error.message : formatConnectionError(tool),
        isSubmitting: false,
      });
    });
  }, [connectMutation]);

  const disconnectTool = useCallback((tool: AgentToolSnapshot): void => {
    disconnectMutation.mutate(tool.id);
  }, [disconnectMutation]);

  const sendConnectionInput = useCallback((input: string): void => {
    const dialog = connectionDialog;

    if (dialog === null || dialog.operationId === null) {
      setConnectionDialog((current) => current === null ? current : {
        ...current,
        error: "Connection is still starting. Try again in a moment.",
      });
      return;
    }

    setConnectionDialog((current) => current === null ? null : {
      ...current,
      error: null,
      isSubmitting: true,
    });
    void sendInputMutation.mutateAsync({ operationId: dialog.operationId, text: input }).then((operationResponse) => {
      const nextOperation = operationResponse.operation;
      if (capabilitiesBaseUrl !== undefined && nextOperation.capabilities !== undefined) {
        setCapabilitiesQueryData(queryClient, capabilitiesBaseUrl, nextOperation.capabilities);
      }
      setConnectionDialog((current) => current === null ? null : {
        ...current,
        error: null,
        isSubmitting: false,
      });
    }).catch((error) => {
      setConnectionDialog((current) => current === null ? null : {
        ...current,
        error: error instanceof Error ? error.message : "Connection input failed.",
        isSubmitting: false,
      });
    });
  }, [capabilitiesBaseUrl, connectionDialog, queryClient, sendInputMutation]);

  const closeConnectionDialog = useCallback((): void => {
    const operationId = connectionDialog?.operationId;
    const shouldCancel = operation !== undefined &&
      operationId === operation.id &&
      (operation.status === "running" || operation.status === "waiting_for_input");

    if (operationId !== undefined && operationId !== null && shouldCancel) {
      cancelOperationMutation.mutate(operationId);
    }

    setConnectionDialog(null);
    if (shouldCancel) {
      setActiveOperation(null);
    }
  }, [cancelOperationMutation, connectionDialog?.operationId, operation]);

  return (
    <main className={showTopbar ? "connectors-page" : "connectors-page no-topbar"}>
      {showTopbar ? (
        <div className="connectors-page-topbar">
          <button className="connectors-refresh" type="button" onClick={refresh}>
            <HugeiconsIcon icon={RefreshIcon} size={16} color="currentColor" strokeWidth={1.8} />
            Refresh
          </button>
          <label className="connectors-search">
            <HugeiconsIcon icon={Search01Icon} size={16} color="currentColor" strokeWidth={1.8} />
            <input
              type="search"
              placeholder="Search connectors"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </label>
        </div>
      ) : null}

      <section className="connectors-page-content">
        <div className="connectors-page-heading">
          <h1>Connectors</h1>
        </div>

        <div className="connectors-section-label">Available</div>
        <div className="connectors-grid">
          {capabilitiesBaseUrl === undefined ? (
            <p className="connectors-empty">Connectors are not available for this machine.</p>
          ) : capabilitiesQuery.isLoading ? (
            <div className="connectors-loading" role="status" aria-label="Loading connectors">
              <span />
            </div>
          ) : capabilitiesQuery.isError ? (
            <p className="connectors-error">
              {capabilitiesQuery.error instanceof Error ? capabilitiesQuery.error.message : "Failed to load connectors."}
            </p>
          ) : visibleConnectors.length === 0 ? (
            <p className="connectors-empty">No connectors found.</p>
          ) : visibleConnectors.map((tool) => (
            <ConnectorRow
              key={tool.id}
              tool={tool}
              pendingLabel={getPendingLabel({
                tool,
                activeOperation,
                operation,
                installMutation,
                connectMutation,
                disconnectMutation,
              })}
              onInstall={installTool}
              onConnect={connectTool}
              onDisconnect={disconnectTool}
            />
          ))}
        </div>
      </section>
      {connectionDialog === null ? null : (
        <DeviceConnectionDialog
          state={connectionDialog}
          onSubmitInput={sendConnectionInput}
          onClose={closeConnectionDialog}
        />
      )}
    </main>
  );
}

function ConnectorRow({
  tool,
  pendingLabel,
  onInstall,
  onConnect,
  onDisconnect,
}: {
  readonly tool: AgentToolSnapshot;
  readonly pendingLabel: string | null;
  readonly onInstall: (tool: AgentToolSnapshot) => void;
  readonly onConnect: (tool: AgentToolSnapshot) => void;
  readonly onDisconnect: (tool: AgentToolSnapshot) => void;
}): React.ReactElement {
  const isConnected = tool.connectionState === "connected";
  const isInstalled = tool.installState === "installed";
  const isPending = pendingLabel !== null;

  return (
    <article className="connector-list-item">
      <div className="connector-logo-wrap">
        {tool.logoUrl === undefined ? (
          <span>{tool.label.slice(0, 1)}</span>
        ) : (
          <img src={tool.logoUrl} alt="" loading="lazy" />
        )}
      </div>
      <div className="connector-copy">
        <div>
          <strong>{tool.label}</strong>
        </div>
        <span>{renderConnectorStatus(tool)}</span>
      </div>
      <div className="connector-actions">
        {!isInstalled ? (
          <button type="button" disabled={isPending} onClick={() => onInstall(tool)}>
            {pendingLabel ?? "Install"}
          </button>
        ) : null}
        {isInstalled && !isConnected && tool.canConnect ? (
          <button type="button" disabled={isPending} onClick={() => onConnect(tool)}>
            {pendingLabel ?? "Connect"}
          </button>
        ) : null}
        {isInstalled && isConnected && tool.canDisconnect ? (
          <button type="button" disabled={isPending} onClick={() => onDisconnect(tool)}>
            {pendingLabel ?? "Disconnect"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function DeviceConnectionDialog({
  state,
  onSubmitInput,
  onClose,
}: {
  readonly state: ConnectionDialogState;
  readonly onSubmitInput: (input: string) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [inputCode, setInputCode] = useState("");
  const deviceUrl = state.url ?? (state.tool.id === "github" ? GITHUB_DEVICE_URL : null);
  const displayUrl = deviceUrl?.toLowerCase() ?? "waiting for link...";
  const toolName = getConnectionToolName(state.tool);
  const flow = getConnectionFlow(state.tool.id);
  const usesReadonlyCode = flow === "readonly-code";
  const usesInputCode = flow === "input-code";

  const openDevicePage = (): void => {
    if (deviceUrl !== null) {
      window.open(deviceUrl, "_blank", "noopener,noreferrer");
    }
  };

  const copyCode = (): void => {
    if (state.code === null) {
      return;
    }

    void navigator.clipboard.writeText(state.code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_000);
    });
  };

  const copyUrl = (): void => {
    if (deviceUrl === null) {
      return;
    }

    void navigator.clipboard.writeText(deviceUrl).then(() => {
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 1_000);
    });
  };

  const submitInputCode = (): void => {
    const code = inputCode.trim();
    if (code.length === 0) {
      return;
    }

    onSubmitInput(code);
    setInputCode("");
  };

  return (
    <div className="connector-connect-backdrop" role="presentation">
      <section
        className="connector-connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connector-connect-title"
      >
        <button className="connector-connect-close" type="button" aria-label={`Close ${toolName} connection`} onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} size={18} color="currentColor" strokeWidth={1.8} />
        </button>
        <div className="connector-connect-header">
          <div className="connector-logo-wrap">
            {state.tool.logoUrl === undefined ? <span>G</span> : <img src={state.tool.logoUrl} alt="" />}
          </div>
          <div>
            <h2 id="connector-connect-title">
              Connect {toolName}
              <span className="connector-connect-title-spinner" aria-hidden="true" />
            </h2>
          </div>
        </div>
        <ol className="connector-connect-steps">
          <li>
            <span>Open the following link.</span>
            <div className="connector-connect-link-row">
              <button className="connector-connect-link-text" type="button" disabled={deviceUrl === null} onClick={openDevicePage}>
                {displayUrl}
              </button>
              <button
                className="connector-connect-icon-button"
                type="button"
                aria-label={copiedUrl ? "Copied link" : "Copy link"}
                title={copiedUrl ? "Copied" : "Copy link"}
                disabled={deviceUrl === null}
                onClick={copyUrl}
              >
                <HugeiconsIcon icon={copiedUrl ? Tick02Icon : CopyIcon} size={15} color="currentColor" strokeWidth={1.8} />
              </button>
              <button
                className="connector-connect-icon-button"
                type="button"
                aria-label="Open link"
                title="Open link"
                disabled={deviceUrl === null}
                onClick={openDevicePage}
              >
                <HugeiconsIcon icon={Share04Icon} size={15} color="currentColor" strokeWidth={1.8} />
              </button>
            </div>
          </li>
          {usesReadonlyCode ? (
            <li>
              <span>Enter the following code.</span>
              <div className="connector-connect-code">
                <strong>{state.code ?? "Waiting for code..."}</strong>
                <button
                  className="connector-connect-icon-button"
                  type="button"
                  aria-label={copied ? "Copied code" : "Copy code"}
                  title={copied ? "Copied" : "Copy code"}
                  disabled={state.code === null}
                  onClick={copyCode}
                >
                  <HugeiconsIcon icon={copied ? Tick02Icon : CopyIcon} size={15} color="currentColor" strokeWidth={1.8} />
                </button>
              </div>
            </li>
          ) : null}
          {usesInputCode ? (
            <li>
              <span>Enter the verification code from the {toolName} page.</span>
              <div className="connector-connect-input">
                <input
                  type="text"
                  value={inputCode}
                  placeholder="Verification code"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => setInputCode(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      submitInputCode();
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={inputCode.trim().length === 0 || state.operationId === null || state.isSubmitting}
                  onClick={submitInputCode}
                >
                  {state.isSubmitting ? "Connecting..." : "Connect"}
                </button>
              </div>
            </li>
          ) : null}
        </ol>
        {state.error === null ? null : <p className="connectors-error">{state.error}</p>}
      </section>
    </div>
  );
}

const createConnectionDialogState = (
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

const updateConnectionDialog = (
  current: ConnectionDialogState,
  patch: Pick<ConnectionDialogState, "code" | "url" | "error" | "isSubmitting">,
): ConnectionDialogState =>
  current.code === patch.code &&
  current.url === patch.url &&
  current.error === patch.error &&
  current.isSubmitting === patch.isSubmitting
    ? current
    : { ...current, ...patch };

const renderConnectorStatus = (tool: AgentToolSnapshot): string => {
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

const getPendingLabel = ({
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

const getConnectionToolName = (tool: AgentToolSnapshot): string =>
  tool.id === "github" ? "GitHub" : tool.label;

type ConnectionFlow = "readonly-code" | "link-only" | "input-code";

const getConnectionFlow = (toolId: string): ConnectionFlow => {
  switch (toolId) {
    case "vercel":
      return "link-only";
    case "supabase":
      return "input-code";
    default:
      return "readonly-code";
  }
};

const formatConnectionError = (tool: AgentToolSnapshot): string =>
  `${getConnectionToolName(tool)} connection could not be completed. Please try again.`;

const parseConnectionMessages = (
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

const extractDeviceCode = (message: string): string | null => {
  const withoutUrls = normalizeTerminalText(message).replaceAll(/https?:\/\/\S+/g, " ");
  return withoutUrls.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/u)?.[0] ??
    withoutUrls.match(/\b[A-Z0-9]{8}\b/u)?.[0] ??
    null;
};

const extractDeviceUrl = (message: string, toolId: string): string | null => {
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

const normalizeTerminalText = (value: string): string =>
  stripTerminalSequences(value)
    .replaceAll("\b", "")
    .replaceAll("\r", "\n")
    .replaceAll(/\p{C}/gu, " ");

const stripTerminalSequences = (value: string): string =>
  value
    .replaceAll(/\u001B\][\s\S]*?(?:\u0007|\u001B\\)/gu, "")
    .replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "");
