"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStore } from "zustand";

import { CloudClient } from "./cloud-client";
import { createCloudAuthStore, type CloudAuthState, type CloudAuthStore } from "./state/auth-store";
import {
  createCloudMachinesStore,
  type CloudMachinesState,
  type CloudMachinesStore,
} from "./state/machines-store";
import {
  createMachineAccessStore,
  type MachineAccessState,
  type MachineAccessStore,
} from "./state/machine-access-store";

export interface CloudRuntimeProviderProps {
  readonly children: React.ReactNode;
  readonly cloudServerUrl: string;
  readonly storageKey: string;
}

export interface CloudRuntime {
  readonly client: CloudClient;
  readonly cloudServerUrl: string;
  readonly storageKey: string;
  readonly authStore: CloudAuthStore;
  readonly machinesStore: CloudMachinesStore;
  readonly accessStore: MachineAccessStore;
}

const CloudRuntimeContext = createContext<CloudRuntime | null>(null);

export function CloudRuntimeProvider({
  children,
  cloudServerUrl,
  storageKey,
}: CloudRuntimeProviderProps): React.ReactElement {
  const [queryClient] = useState(() =>
    new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          refetchOnWindowFocus: false,
        },
        mutations: {
          retry: false,
        },
      },
    })
  );
  const [authStore] = useState(() => createCloudAuthStore());
  const [machinesStore] = useState(() => createCloudMachinesStore());
  const [accessStore] = useState(() => createMachineAccessStore());
  const client = useMemo(() => new CloudClient(cloudServerUrl), [cloudServerUrl]);
  const runtime = useMemo<CloudRuntime>(() => ({
    client,
    cloudServerUrl,
    storageKey,
    authStore,
    machinesStore,
    accessStore,
  }), [accessStore, authStore, client, cloudServerUrl, machinesStore, storageKey]);

  return (
    <QueryClientProvider client={queryClient}>
      <CloudRuntimeContext.Provider value={runtime}>
        {children}
      </CloudRuntimeContext.Provider>
    </QueryClientProvider>
  );
}

export const useOptionalCloudRuntime = (): CloudRuntime | null =>
  useContext(CloudRuntimeContext);

export const useCloudRuntime = (): CloudRuntime => {
  const runtime = useOptionalCloudRuntime();

  if (runtime === null) {
    throw new Error("CloudRuntimeProvider is required.");
  }

  return runtime;
};

export const useCloudAuthStore = <T,>(selector: (state: CloudAuthState) => T): T => {
  const { authStore } = useCloudRuntime();
  return useStore(authStore, selector);
};

export const useCloudMachinesStore = <T,>(selector: (state: CloudMachinesState) => T): T => {
  const { machinesStore } = useCloudRuntime();
  return useStore(machinesStore, selector);
};

export const useMachineAccessStore = <T,>(selector: (state: MachineAccessState) => T): T => {
  const { accessStore } = useCloudRuntime();
  return useStore(accessStore, selector);
};
