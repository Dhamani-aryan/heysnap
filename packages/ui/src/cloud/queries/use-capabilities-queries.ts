"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import {
  cancelCapabilityOperation,
  connectTool,
  disconnectTool,
  getCapabilities,
  getCapabilityOperation,
  installTool,
  isCapabilityOperationResponse,
  refreshToolStatus,
  sendCapabilityOperationInput,
  updateTool,
  type CapabilitiesResponse,
  type CapabilitiesSnapshot,
  type CapabilityOperationResponse,
} from "../capabilities-client";
import { cloudQueryKeys } from "./cloud-query-keys";

export const CAPABILITY_OPERATION_POLL_INTERVAL_MS = 1000;

export const useCapabilitiesQuery = (capabilitiesBaseUrl: string | undefined) =>
  useQuery({
    queryKey: capabilitiesBaseUrl === undefined ? ["cloud", "capabilities", "missing"] : cloudQueryKeys.capabilities(capabilitiesBaseUrl),
    queryFn: async () => {
      if (capabilitiesBaseUrl === undefined) {
        throw new Error("Connectors are not available for this machine.");
      }

      return getCapabilities(capabilitiesBaseUrl);
    },
    enabled: capabilitiesBaseUrl !== undefined,
  });

export const useCapabilityOperationQuery = (
  capabilitiesBaseUrl: string | undefined,
  operationId: string | null,
) => {
  const enabled = capabilitiesBaseUrl !== undefined && operationId !== null;

  return useQuery({
    queryKey: enabled
      ? cloudQueryKeys.capabilityOperation(capabilitiesBaseUrl, operationId)
      : ["cloud", "capabilities", "operation", "missing"],
    queryFn: async () => {
      if (capabilitiesBaseUrl === undefined || operationId === null) {
        throw new Error("Capability operation is not available.");
      }

      return getCapabilityOperation(capabilitiesBaseUrl, operationId);
    },
    enabled,
    refetchInterval: (query) => {
      const response = query.state.data as CapabilityOperationResponse | undefined;
      const status = response?.operation.status;
      return status === "running" || status === "waiting_for_input"
        ? CAPABILITY_OPERATION_POLL_INTERVAL_MS
        : false;
    },
    refetchIntervalInBackground: true,
    select: (response) => response.operation,
  });
};

export const useInstallToolMutation = (capabilitiesBaseUrl: string | undefined) =>
  useCapabilityActionMutation(capabilitiesBaseUrl, (baseUrl, toolId) => installTool(baseUrl, toolId));

export const useUpdateToolMutation = (capabilitiesBaseUrl: string | undefined) =>
  useCapabilityActionMutation(capabilitiesBaseUrl, (baseUrl, toolId) => updateTool(baseUrl, toolId));

export const useConnectToolMutation = (capabilitiesBaseUrl: string | undefined) =>
  useCapabilityActionMutation(capabilitiesBaseUrl, (baseUrl, toolId) => connectTool(baseUrl, toolId));

export const useDisconnectToolMutation = (capabilitiesBaseUrl: string | undefined) =>
  useCapabilityActionMutation(capabilitiesBaseUrl, (baseUrl, toolId) => disconnectTool(baseUrl, toolId));

export const useRefreshToolStatusMutation = (capabilitiesBaseUrl: string | undefined) =>
  useCapabilityActionMutation(capabilitiesBaseUrl, (baseUrl, toolId) => refreshToolStatus(baseUrl, toolId));

export const useSendCapabilityOperationInputMutation = (capabilitiesBaseUrl: string | undefined) =>
  useMutation({
    mutationFn: async (input: { readonly operationId: string; readonly text: string }) => {
      if (capabilitiesBaseUrl === undefined) {
        throw new Error("Connectors are not available for this machine.");
      }

      return sendCapabilityOperationInput(capabilitiesBaseUrl, input.operationId, input.text);
    },
  });

export const useCancelCapabilityOperationMutation = (capabilitiesBaseUrl: string | undefined) =>
  useMutation({
    mutationFn: async (operationId: string) => {
      if (capabilitiesBaseUrl === undefined) {
        throw new Error("Connectors are not available for this machine.");
      }

      return cancelCapabilityOperation(capabilitiesBaseUrl, operationId);
    },
  });

const useCapabilityActionMutation = <TResponse extends CapabilitiesResponse | CapabilityOperationResponse>(
  capabilitiesBaseUrl: string | undefined,
  action: (baseUrl: string, toolId: string) => Promise<TResponse>,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (toolId: string) => {
      if (capabilitiesBaseUrl === undefined) {
        throw new Error("Connectors are not available for this machine.");
      }

      return action(capabilitiesBaseUrl, toolId);
    },
    onSuccess: (response) => {
      if (capabilitiesBaseUrl === undefined) {
        return;
      }

      if (isCapabilityOperationResponse(response)) {
        if (response.operation.capabilities !== undefined) {
          setCapabilitiesQueryData(queryClient, capabilitiesBaseUrl, response.operation.capabilities);
        }
        return;
      }

      setCapabilitiesQueryData(queryClient, capabilitiesBaseUrl, response.capabilities);
    },
  });
};

export const setCapabilitiesQueryData = (
  queryClient: QueryClient,
  capabilitiesBaseUrl: string,
  capabilities: CapabilitiesSnapshot,
): void => {
  queryClient.setQueryData<CapabilitiesResponse>(
    cloudQueryKeys.capabilities(capabilitiesBaseUrl),
    { capabilities },
  );
};
