"use client";

import { RefreshIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  isCapabilityOperationResponse,
  type AgentToolSnapshot,
} from "../../../cloud/capabilities-client";
import {
  setCapabilitiesQueryData,
  useCancelCapabilityOperationMutation,
  useCapabilitiesQuery,
  useCapabilityOperationQuery,
  useConnectToolMutation,
  useDisconnectToolMutation,
  useInstallToolMutation,
  useSendCapabilityOperationInputMutation,
} from "../../../query/cloud/use-capabilities-queries";

import {
  createConnectionDialogState,
  DEVICE_FLOW_TOOL_IDS,
  formatConnectionError,
  getPendingLabel,
  parseConnectionMessages,
  updateConnectionDialog,
} from "./capabilities-connection-helpers";
import type { ActiveOperationState, ConnectionDialogState } from "./capabilities-types";
import { ConnectorRow } from "./connector-row";
import { DeviceConnectionDialog } from "./device-connection-dialog";

export interface CapabilitiesPanelProps {
  readonly capabilitiesBaseUrl?: string;
  readonly showTopbar?: boolean;
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
