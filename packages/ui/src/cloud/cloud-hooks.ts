"use client";

export {
  useCloudAuthStore,
  useCloudMachinesStore,
  useCloudRuntime,
  useMachineAccessStore,
  useOptionalCloudRuntime,
} from "./cloud-runtime";
export type { CloudRuntime } from "./cloud-runtime";
export type { CloudComputer, CloudUser } from "./cloud-client";

export {
  MACHINES_ONBOARDING_STORAGE_KEY_SUFFIX,
  isAuthFailure,
  useBootstrapAuth,
  useClearCloudSession,
  useLoginMutation,
  useLogoutMutation,
} from "./queries/use-cloud-session";

export {
  MACHINES_REFRESH_INTERVAL_MS,
  SELECTED_MACHINE_STARTUP_POLL_INTERVAL_MS,
  useCloudComputers,
  useCreateMachineMutation,
  useMachineWorkspaceSession,
  useMachinesQuery,
  useStartMachineMutation,
  useStopMachineMutation,
} from "./queries/use-machine-queries";
export type { MachineWorkspaceSessionState } from "./queries/use-machine-queries";

export { cloudQueryKeys } from "./queries/cloud-query-keys";
export { selectComputers, selectHasPendingMachine } from "./state/machines-store";
export type { CloudAuthState, CloudAuthStatus } from "./state/auth-store";
export type { CloudMachinesState } from "./state/machines-store";
export type { MachineAccessEntry, MachineAccessState } from "./state/machine-access-store";
export type { CloudSessionStorage } from "./state/cloud-storage";
