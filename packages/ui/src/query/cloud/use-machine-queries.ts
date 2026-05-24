"use client";

import { useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { CloudComputer, ComputerAccessSessionResponse } from "../../cloud/cloud-client";
import { useCloudAuthStore, useCloudMachinesStore, useCloudRuntime, useMachineAccessStore } from "../../cloud/cloud-runtime";
import {
  ACCESS_SESSION_REFRESH_BUFFER_MS,
  getRemoteMachineUnavailableMessage,
  isAccessSessionUsable,
  isRemoteMachineConnectable,
  isRemoteMachinePendingStartup,
  isRemoteMachineTerminal,
} from "../../cloud/machine-status";
import { emptyEntry } from "../../stores/cloud/machine-access-store";
import { selectComputers, selectHasPendingMachine } from "../../stores/cloud/machines-store";
import { cloudQueryKeys } from "./cloud-query-keys";
import { isAuthFailure, useClearCloudSession } from "./use-cloud-session";

export const MACHINES_REFRESH_INTERVAL_MS = 5000;
export const SELECTED_MACHINE_STARTUP_POLL_INTERVAL_MS = 2000;

export interface MachineWorkspaceSessionState {
  readonly accessSession: ComputerAccessSessionResponse | null;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly startupPhase: "checking" | "starting" | null;
}

export const useMachinesQuery = (): ReturnType<typeof useQuery> => {
  const { client, machinesStore } = useCloudRuntime();
  const token = useCloudAuthStore((state) => state.token);
  const authStatus = useCloudAuthStore((state) => state.status);
  const hasPendingMachine = useCloudMachinesStore(selectHasPendingMachine);
  const clearSession = useClearCloudSession();
  const enabled = authStatus === "authenticated" && token !== null;
  const query = useQuery({
    queryKey: cloudQueryKeys.computers(),
    queryFn: async () => {
      if (token === null) {
        throw new Error("Cloud session required.");
      }

      return client.listComputers(token);
    },
    enabled,
    refetchInterval: enabled
      ? hasPendingMachine ? SELECTED_MACHINE_STARTUP_POLL_INTERVAL_MS : MACHINES_REFRESH_INTERVAL_MS
      : false,
  });

  useEffect(() => {
    if (query.data !== undefined) {
      machinesStore.getState().replaceComputers(query.data.computers);
    }
  }, [machinesStore, query.data]);

  useEffect(() => {
    if (!query.isError) {
      return;
    }

    if (isAuthFailure(query.error)) {
      clearSession();
      return;
    }

    machinesStore.getState().setError(
      query.error instanceof Error ? query.error.message : "Failed to load machines.",
    );
  }, [clearSession, machinesStore, query.error, query.isError]);

  return query;
};

export const useCreateMachineMutation = () => {
  const { client, machinesStore } = useCloudRuntime();
  const token = useCloudAuthStore((state) => state.token);
  const clearSession = useClearCloudSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { readonly name: string }) => {
      if (token === null) {
        throw new Error("Cloud session required.");
      }

      return client.createComputer(token, input);
    },
    onSuccess: (response) => {
      machinesStore.getState().upsertComputer(response.computer);
      void queryClient.invalidateQueries({ queryKey: cloudQueryKeys.computers() });
    },
    onError: (error) => {
      if (isAuthFailure(error)) {
        clearSession();
        return;
      }

      machinesStore.getState().setError(error instanceof Error ? error.message : "Failed to create machine.");
      void queryClient.invalidateQueries({ queryKey: cloudQueryKeys.computers() });
    },
  });
};

export const useStartMachineMutation = () => {
  const { client, machinesStore } = useCloudRuntime();
  const token = useCloudAuthStore((state) => state.token);
  const clearSession = useClearCloudSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (computerId: string) => {
      if (token === null) {
        throw new Error("Cloud session required.");
      }

      machinesStore.getState().markStartRequested(computerId);
      return client.startComputer(token, computerId);
    },
    onSuccess: (response) => {
      machinesStore.getState().upsertComputer(response.computer);
      void queryClient.invalidateQueries({ queryKey: cloudQueryKeys.computers() });
    },
    onError: (error, computerId) => {
      if (isAuthFailure(error)) {
        clearSession();
        return;
      }
    },
  });
};

export const useStopMachineMutation = () => {
  const { accessStore, client, machinesStore } = useCloudRuntime();
  const token = useCloudAuthStore((state) => state.token);
  const clearSession = useClearCloudSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (computerId: string) => {
      if (token === null) {
        throw new Error("Cloud session required.");
      }

      return client.stopComputer(token, computerId);
    },
    onSuccess: (response) => {
      machinesStore.getState().upsertComputer(response.computer);
      accessStore.getState().clearSession(response.computer.id);
      void queryClient.invalidateQueries({ queryKey: cloudQueryKeys.computers() });
    },
    onError: (error) => {
      if (isAuthFailure(error)) {
        clearSession();
      }
    },
  });
};

export const useMachineWorkspaceSession = (
  computerId: string | null,
  options: { readonly suppressAutoStart?: boolean } = {},
): MachineWorkspaceSessionState => {
  const { accessStore, client, machinesStore } = useCloudRuntime();
  const suppressAutoStart = options.suppressAutoStart === true;
  const authStatus = useCloudAuthStore((state) => state.status);
  const token = useCloudAuthStore((state) => state.token);
  const computer = useCloudMachinesStore((state) =>
    computerId === null ? null : state.computersById[computerId] ?? null
  );
  const hasLoadedMachines = useCloudMachinesStore((state) => state.hasLoaded);
  const startRequested = useCloudMachinesStore((state) =>
    computerId === null ? false : state.startRequestedIds.has(computerId)
  );
  const accessEntry = useMachineAccessStore((state) =>
    computerId === null ? emptyEntry : state.sessionsByComputerId[computerId] ?? emptyEntry
  );
  const clearSession = useClearCloudSession();
  const startMutation = useStartMachineMutation();
  const startError = startMutation.isError && startMutation.variables === computerId
    ? startMutation.error
    : null;
  const createAccessSession = useMutation({
    mutationKey: computerId === null ? undefined : cloudQueryKeys.accessSession(computerId),
    mutationFn: async (targetComputerId: string) => {
      if (token === null) {
        throw new Error("Cloud session required.");
      }

      return client.createComputerAccessSession(token, targetComputerId);
    },
    onMutate: (targetComputerId) => {
      accessStore.getState().setLoading(targetComputerId, true);
    },
    onSuccess: (response, targetComputerId) => {
      accessStore.getState().setSession(targetComputerId, response);
    },
    onError: (error, targetComputerId) => {
      if (isAuthFailure(error)) {
        clearSession();
        return;
      }

      accessStore.getState().setError(
        targetComputerId,
        error instanceof Error ? error.message : "Failed to open machine.",
      );
    },
    onSettled: (_response, _error, targetComputerId) => {
      accessStore.getState().setLoading(targetComputerId, false);
    },
  });
  const requestAccessSession = useCallback((targetComputerId: string) => {
    if (!createAccessSession.isPending) {
      createAccessSession.mutate(targetComputerId);
    }
  }, [createAccessSession]);

  useEffect(() => {
    if (computerId === null || computer === null) {
      return;
    }

    if (computer.status !== "sleeping" && startRequested) {
      machinesStore.getState().markStartFinished(computerId);
    }
  }, [computer, computerId, machinesStore, startRequested]);

  useEffect(() => {
    if (
      authStatus !== "authenticated" ||
      computerId === null ||
      computer === null ||
      computer.kind === "local" ||
      suppressAutoStart ||
      computer.status !== "sleeping" ||
      startRequested ||
      startError !== null
    ) {
      return;
    }

    accessStore.getState().clearSession(computerId);
    startMutation.mutate(computerId);
  }, [accessStore, authStatus, computer, computerId, startError, startMutation, startRequested, suppressAutoStart]);

  useEffect(() => {
    if (
      authStatus !== "authenticated" ||
      computerId === null ||
      computer === null ||
      !isRemoteMachineConnectable(computer.status)
    ) {
      return;
    }

    if (isAccessSessionUsable(accessEntry.response, computerId) || accessEntry.isLoading) {
      return;
    }

    requestAccessSession(computerId);
  }, [
    accessEntry.isLoading,
    accessEntry.response,
    authStatus,
    computer,
    computerId,
    requestAccessSession,
  ]);

  useEffect(() => {
    if (
      authStatus !== "authenticated" ||
      computerId === null ||
      computer === null ||
      !isRemoteMachineConnectable(computer.status) ||
      accessEntry.response === null
    ) {
      return;
    }

    const expiresAt = Date.parse(accessEntry.response.accessSession.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      return;
    }

    const refreshDelay = Math.max(0, expiresAt - Date.now() - ACCESS_SESSION_REFRESH_BUFFER_MS);
    const refreshTimer = window.setTimeout(() => {
      requestAccessSession(computerId);
    }, refreshDelay);

    return () => {
      window.clearTimeout(refreshTimer);
    };
  }, [accessEntry.response, authStatus, computer, computerId, requestAccessSession]);

  if (computerId === null || authStatus !== "authenticated") {
    return {
      accessSession: null,
      error: null,
      isLoading: false,
      startupPhase: null,
    };
  }

  if (!hasLoadedMachines) {
    return {
      accessSession: null,
      error: null,
      isLoading: true,
      startupPhase: "checking",
    };
  }

  if (computer === null) {
    return {
      accessSession: null,
      error: "Machine not found.",
      isLoading: false,
      startupPhase: null,
    };
  }

  if (computer.kind !== "local" && computer.status === "sleeping" && suppressAutoStart) {
    return {
      accessSession: null,
      error: getRemoteMachineUnavailableMessage(computer.status),
      isLoading: false,
      startupPhase: null,
    };
  }

  if (computer.kind !== "local" && (computer.status === "sleeping" || isRemoteMachinePendingStartup(computer.status))) {
    if (startError !== null) {
      return {
        accessSession: null,
        error: startError instanceof Error ? startError.message : "Failed to start machine.",
        isLoading: false,
        startupPhase: null,
      };
    }

    return {
      accessSession: null,
      error: null,
      isLoading: true,
      startupPhase: "starting",
    };
  }

  if (isRemoteMachineTerminal(computer.status)) {
    return {
      accessSession: null,
      error: getRemoteMachineUnavailableMessage(computer.status),
      isLoading: false,
      startupPhase: null,
    };
  }

  if (!isRemoteMachineConnectable(computer.status)) {
    return {
      accessSession: null,
      error: getRemoteMachineUnavailableMessage(computer.status),
      isLoading: false,
      startupPhase: null,
    };
  }

  return {
    accessSession: isAccessSessionUsable(accessEntry.response, computerId) ? accessEntry.response : null,
    error: accessEntry.error,
    isLoading: accessEntry.isLoading,
    startupPhase: null,
  };
};

export const useCloudComputers = (): readonly CloudComputer[] =>
  useCloudMachinesStore(selectComputers);
