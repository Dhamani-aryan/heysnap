"use client";

export {
  useCloudAuthStore,
  useCloudMachinesStore,
  useCloudRuntime,
  useMachineAccessStore,
  useOptionalCloudRuntime,
} from "../cloud/cloud-runtime";
export type { CloudRuntime } from "../cloud/cloud-runtime";
export type { CloudComputer, CloudUser } from "../cloud/cloud-client";

export {
  MACHINES_ONBOARDING_STORAGE_KEY_SUFFIX,
  isAuthFailure,
  useBootstrapAuth,
  useClearCloudSession,
  useLoginMutation,
  useLogoutMutation,
} from "../query/cloud/use-cloud-session";

export {
  MACHINES_REFRESH_INTERVAL_MS,
  SELECTED_MACHINE_STARTUP_POLL_INTERVAL_MS,
  useCloudComputers,
  useCreateMachineMutation,
  useMachineWorkspaceSession,
  useMachinesQuery,
  useStartMachineMutation,
  useStopMachineMutation,
} from "../query/cloud/use-machine-queries";
export type { MachineWorkspaceSessionState } from "../query/cloud/use-machine-queries";

export { cloudQueryKeys } from "../query/cloud/cloud-query-keys";
export { selectComputers, selectHasPendingMachine } from "../stores/cloud/machines-store";
export type { CloudAuthState, CloudAuthStatus } from "../stores/cloud/auth-store";
export type { CloudMachinesState } from "../stores/cloud/machines-store";
export type { MachineAccessEntry, MachineAccessState } from "../stores/cloud/machine-access-store";
export type { CloudSessionStorage } from "../stores/cloud/cloud-storage";
