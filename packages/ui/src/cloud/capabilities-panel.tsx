"use client";

import { Cancel01Icon, Copy01Icon, CopyCheckIcon, RefreshIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CapabilitiesClient,
  type AgentToolSnapshot,
  type CapabilitiesSnapshot,
  type CapabilityServerMessage,
} from "./capabilities-client";

const GITHUB_DEVICE_URL = "https://github.com/login/device";
const DEVICE_FLOW_TOOL_IDS = new Set(["github", "vercel", "supabase"]);

export interface CapabilitiesPanelProps {
  readonly websocketUrl?: string;
}

interface ConnectionDialogState {
  readonly tool: AgentToolSnapshot;
  readonly code: string | null;
  readonly url: string | null;
  readonly operationId: string | null;
  readonly error: string | null;
  readonly isSubmitting: boolean;
}

type ConnectionDialogUpdater = (
  updater: ConnectionDialogState | null | ((current: ConnectionDialogState | null) => ConnectionDialogState | null),
) => void;

export function CapabilitiesPanel({ websocketUrl }: CapabilitiesPanelProps): React.ReactElement {
  const clientRef = useRef<CapabilitiesClient | null>(null);
  const didRefreshStatusRef = useRef(false);
  const connectionDialogRef = useRef<ConnectionDialogState | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesSnapshot | null>(null);
  const [search, setSearch] = useState("");
  const [connectionDialog, setConnectionDialog] = useState<ConnectionDialogState | null>(null);
  const updateConnectionDialog = useCallback<ConnectionDialogUpdater>((updater) => {
    setConnectionDialog((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      connectionDialogRef.current = next;
      return next;
    });
  }, []);
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
    if (websocketUrl === undefined) {
      return;
    }

    const client = new CapabilitiesClient(websocketUrl);
    clientRef.current = client;
    const unsubscribe = client.subscribe((message) => {
      handleMessage(message, setCapabilities);
      handleConnectionMessage(message, connectionDialogRef.current, updateConnectionDialog);
    });
    client.connect();

    window.setTimeout(() => {
      client.listCapabilities();
    }, 250);

    return () => {
      unsubscribe();
      client.close();
      clientRef.current = null;
    };
  }, [updateConnectionDialog, websocketUrl]);

  useEffect(() => {
    connectionDialogRef.current = connectionDialog;
  }, [connectionDialog]);

  useEffect(() => {
    if (capabilities === null || didRefreshStatusRef.current) {
      return;
    }

    didRefreshStatusRef.current = true;
    for (const tool of connectors) {
      if (tool.canRefreshStatus) {
        clientRef.current?.refreshToolStatus(tool.id);
      }
    }
  }, [capabilities, connectors]);

  const refresh = useCallback(() => {
    didRefreshStatusRef.current = false;
    clientRef.current?.listCapabilities();
  }, []);
  const connectTool = useCallback((tool: AgentToolSnapshot): void => {
    if (DEVICE_FLOW_TOOL_IDS.has(tool.id)) {
      const nextDialog = {
        tool,
        code: null,
        url: tool.id === "github" ? GITHUB_DEVICE_URL : null,
        operationId: null,
        error: null,
        isSubmitting: false,
      };
      updateConnectionDialog(nextDialog);
      clientRef.current?.connectTool(tool.id);
      return;
    }

    clientRef.current?.connectTool(tool.id);
  }, [updateConnectionDialog]);

  return (
    <main className="connectors-page">
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

      <section className="connectors-page-content">
        <div className="connectors-page-heading">
          <h1>Connectors</h1>
          <p>Connect external tools Codex can use while working on this machine.</p>
        </div>

        <div className="connectors-section-label">Available</div>
        <div className="connectors-grid">
          {websocketUrl === undefined ? (
            <p className="connectors-empty">Connectors are not available for this machine.</p>
          ) : visibleConnectors.length === 0 ? (
            <p className="connectors-empty">No connectors found.</p>
          ) : visibleConnectors.map((tool) => (
            <ConnectorRow key={tool.id} tool={tool} client={clientRef.current} onConnect={connectTool} />
          ))}
        </div>
      </section>
      {connectionDialog === null ? null : (
        <DeviceConnectionDialog
          state={connectionDialog}
          onSubmitInput={(input) => {
            const activeDialog = connectionDialogRef.current;
            if (activeDialog === null) {
              return;
            }

            if (activeDialog.operationId === null) {
              updateConnectionDialog((current) => current === null ? current : {
                ...current,
                error: "Connection is still starting. Try again in a moment.",
              });
              return;
            }

            updateConnectionDialog((current) => current === null ? current : {
              ...current,
              error: null,
              isSubmitting: true,
            });
            clientRef.current?.sendToolInput(activeDialog.operationId, input);
          }}
          onClose={() => updateConnectionDialog(null)}
        />
      )}
    </main>
  );
}

function ConnectorRow({
  tool,
  client,
  onConnect,
}: {
  readonly tool: AgentToolSnapshot;
  readonly client: CapabilitiesClient | null;
  readonly onConnect: (tool: AgentToolSnapshot) => void;
}): React.ReactElement {
  const isConnected = tool.connectionState === "connected";
  const isUnknown = tool.connectionState === "unknown";
  const isInstalled = tool.installState === "installed";

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
          <button type="button" onClick={() => client?.installTool(tool.id)}>Install</button>
        ) : null}
        {isInstalled && isUnknown && tool.canRefreshStatus ? (
          <button type="button" onClick={() => client?.refreshToolStatus(tool.id)}>Check</button>
        ) : null}
        {isInstalled && !isConnected && tool.canConnect ? (
          <button type="button" onClick={() => onConnect(tool)}>Connect</button>
        ) : null}
        {isInstalled && isConnected && tool.canDisconnect ? (
          <button type="button" onClick={() => client?.disconnectTool(tool.id)}>Disconnect</button>
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
      window.setTimeout(() => setCopied(false), 1_200);
    });
  };

  const copyUrl = (): void => {
    if (deviceUrl === null) {
      return;
    }

    void navigator.clipboard.writeText(deviceUrl).then(() => {
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 1_200);
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
    <div
      className="connector-connect-backdrop"
      role="presentation"
    >
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
            <h2 id="connector-connect-title">Connect {toolName}</h2>
            <p>Authorize {toolName} for this machine.</p>
          </div>
        </div>
        <ol className="connector-connect-steps">
          <li>
            <span>Open the following link.</span>
            <div className="connector-connect-link-row">
              <button type="button" disabled={deviceUrl === null} onClick={openDevicePage}>
                {deviceUrl === null ? "Waiting for link..." : `Open ${toolName}`}
              </button>
              <button
                type="button"
                aria-label={copiedUrl ? "Copied link" : "Copy link"}
                title={copiedUrl ? "Copied" : "Copy link"}
                disabled={deviceUrl === null}
                onClick={copyUrl}
              >
                <HugeiconsIcon icon={copiedUrl ? CopyCheckIcon : Copy01Icon} size={16} color="currentColor" strokeWidth={1.8} />
              </button>
            </div>
          </li>
          {usesReadonlyCode ? (
            <li>
              <span>Enter the given code.</span>
              <div className="connector-connect-code">
                <strong>{state.code ?? "Waiting for code..."}</strong>
                <button
                  type="button"
                  aria-label={copied ? "Copied code" : "Copy code"}
                  title={copied ? "Copied" : "Copy code"}
                  disabled={state.code === null}
                  onClick={copyCode}
                >
                  <HugeiconsIcon icon={copied ? CopyCheckIcon : Copy01Icon} size={16} color="currentColor" strokeWidth={1.8} />
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

const handleMessage = (
  message: CapabilityServerMessage,
  setCapabilities: React.Dispatch<React.SetStateAction<CapabilitiesSnapshot | null>>,
): void => {
  switch (message.type) {
    case "capabilities":
    case "operationCompleted":
      setCapabilities(message.capabilities);
      break;
    case "operationStarted":
    case "operationProgress":
      break;
    case "operationFailed":
    case "error":
      break;
    case "toolStatus":
      setCapabilities((current) => current === null ? current : {
        ...current,
        tools: current.tools.map((tool) => tool.id === message.tool.id ? message.tool : tool),
      });
      break;
    case "skillStatus":
    case "hello":
    case "pong":
      break;
  }
};

const handleConnectionMessage = (
  message: CapabilityServerMessage,
  currentDialog: ConnectionDialogState | null,
  updateConnectionDialog: ConnectionDialogUpdater,
): void => {
  if (currentDialog === null) {
    return;
  }

  if (message.type === "operationStarted" && message.operation === "connectTool" && message.targetId === currentDialog.tool.id) {
    updateConnectionDialog((current) => current === null ? current : {
      ...current,
      operationId: message.operationId,
    });
    return;
  }

  if (message.type === "operationProgress") {
    const code = extractDeviceCode(message.message);
    const url = extractDeviceUrl(message.message, currentDialog.tool.id);
    updateConnectionDialog((current) => current === null ? current : {
      ...current,
      code: code ?? current.code,
      url: url ?? current.url,
      error: null,
    });
    return;
  }

  if (message.type === "operationFailed") {
    updateConnectionDialog((current) => current === null ? current : {
      ...current,
      error: formatConnectionError(current.tool),
      isSubmitting: false,
    });
    return;
  }

  if (message.type === "error") {
    updateConnectionDialog((current) => current === null ? current : {
      ...current,
      error: message.message,
      isSubmitting: false,
    });
    return;
  }

  if (message.type === "operationCompleted") {
    const connectedTool = message.capabilities.tools.find((tool) => tool.id === currentDialog.tool.id);
    if (connectedTool?.connectionState === "connected") {
      updateConnectionDialog(null);
      return;
    }

    updateConnectionDialog((current) => current === null ? current : {
      ...current,
      isSubmitting: false,
    });
  }
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
