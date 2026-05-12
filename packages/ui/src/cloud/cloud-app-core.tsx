"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import type { AgentThreadSummary } from "../agent/types";
import type { CloudComputer } from "./cloud-client";
import {
  CloudRuntimeProvider,
  useCloudAuthStore,
  useCloudMachinesStore,
  useCloudRuntime,
  useOptionalCloudRuntime,
} from "./cloud-runtime";
import { LoginScreen } from "./login-screen";
import { MyMachinesScreen } from "./my-machines-screen";
import {
  useBootstrapAuth,
  useLoginMutation,
  useLogoutMutation,
  MACHINES_ONBOARDING_STORAGE_KEY_SUFFIX,
} from "./queries/use-cloud-session";
import {
  useCloudComputers,
  useCreateMachineMutation,
  useMachineWorkspaceSession,
  useMachinesQuery,
  useStopMachineMutation,
} from "./queries/use-machine-queries";
import { readStoredBoolean, writeStoredBoolean } from "./state/cloud-storage";
import { RemoteMachineCreateScreen } from "./remote-machine-create-screen";

const DEFAULT_CLOUD_SERVER_URL = "https://api.heysnap.xyz";
const DEFAULT_STORAGE_KEY = "ank1015:cloud-session-token";
const CLOUD_SCREEN_TRANSITION = { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const };

export interface CloudAppProps {
  readonly cloudServerUrl?: string;
  readonly route?: CloudAppRoute;
  readonly onRouteChange?: (route: CloudAppRoute, options?: CloudRouteChangeOptions) => void;
  readonly storageKey?: string;
}

export interface CloudAppCoreProps extends CloudAppProps {
  readonly renderWorkspace?: (props: CloudWorkspaceRendererProps) => React.ReactElement;
  readonly renderWorkspaceLoader?: (props: CloudWorkspaceLoaderRendererProps) => React.ReactElement;
}

export interface CloudWorkspaceRendererProps {
  readonly agentBaseUrl: string;
  readonly capabilitiesBaseUrl?: string;
  readonly computer: CloudComputer;
  readonly filesystemWebsocketUrl: string;
  readonly selectedThreadId?: string | null;
  readonly workspacePanel?: "chat" | "connectors";
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
  readonly onNewThread?: () => void;
  readonly onOpenConnectors?: () => void;
  readonly onCloseConnectors?: () => void;
  readonly onThreadResolved?: (threadId: string) => void;
  readonly onBackToMachines?: () => void;
  readonly onSleepMachine?: () => Promise<void>;
  readonly suppressConnectionLoader?: boolean;
}

export interface CloudWorkspaceLoaderRendererProps {
  readonly ariaLabel: string;
  readonly computer: CloudComputer;
  readonly label: string;
}

export type CloudAppRoute =
  | { readonly view: "home" }
  | { readonly view: "login" }
  | { readonly view: "machines" }
  | { readonly view: "machine-create" }
  | {
    readonly view: "workspace";
    readonly computerId: string;
    readonly panel?: "chat" | "connectors";
    readonly threadId?: string | null;
  };

export interface CloudRouteChangeOptions {
  readonly replace?: boolean;
}

export function CloudAppCore(props: CloudAppCoreProps): React.ReactElement {
  const runtime = useOptionalCloudRuntime();

  if (runtime === null) {
    return (
      <CloudRuntimeProvider
        cloudServerUrl={props.cloudServerUrl ?? DEFAULT_CLOUD_SERVER_URL}
        storageKey={props.storageKey ?? DEFAULT_STORAGE_KEY}
      >
        <CloudAppContent {...props} />
      </CloudRuntimeProvider>
    );
  }

  return <CloudAppContent {...props} />;
}

function CloudAppContent({
  route,
  onRouteChange,
  renderWorkspace,
  renderWorkspaceLoader,
}: CloudAppCoreProps): React.ReactElement {
  const { authStore, client, machinesStore, storageKey } = useCloudRuntime();
  const machinesOnboardingStorageKey = `${storageKey}${MACHINES_ONBOARDING_STORAGE_KEY_SUFFIX}`;
  const [internalRoute, setInternalRoute] = useState<CloudAppRoute>({ view: "home" });
  const [hasSeenMachinesOnboarding, setHasSeenMachinesOnboarding] = useState(() =>
    readStoredBoolean(machinesOnboardingStorageKey),
  );
  const [canShowMissingMachine, setCanShowMissingMachine] = useState(false);
  const [autoStartSuppressedComputerIds, setAutoStartSuppressedComputerIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const activeRoute = route ?? internalRoute;
  const selectedComputerId = activeRoute.view === "workspace" ? activeRoute.computerId : null;
  const selectedWorkspacePanel = activeRoute.view === "workspace" ? activeRoute.panel ?? "chat" : "chat";
  const selectedThreadId =
    activeRoute.view === "workspace" && selectedWorkspacePanel === "chat"
      ? activeRoute.threadId ?? null
      : null;
  const suppressSelectedComputerAutoStart =
    selectedComputerId !== null && autoStartSuppressedComputerIds.has(selectedComputerId);
  const changeRoute = useCallback((
    nextRoute: CloudAppRoute,
    options: CloudRouteChangeOptions = {},
  ): void => {
    if (onRouteChange !== undefined) {
      onRouteChange(nextRoute, options);
      return;
    }

    setInternalRoute(nextRoute);
  }, [onRouteChange]);
  const routeToLogin = useCallback((): void => {
    changeRoute({ view: "login" }, { replace: true });
  }, [changeRoute]);
  const user = useCloudAuthStore((state) => state.user);
  const authState = useCloudAuthStore((state) => state.status);
  const computers = useCloudComputers();
  const selectedComputer = useCloudMachinesStore((state) =>
    selectedComputerId === null ? null : state.computersById[selectedComputerId] ?? null
  );
  const hasLoadedMachines = useCloudMachinesStore((state) => state.hasLoaded);
  const machinesError = useCloudMachinesStore((state) => state.error);
  const machinesQuery = useMachinesQuery();
  const workspaceSession = useMachineWorkspaceSession(selectedComputerId, {
    suppressAutoStart: suppressSelectedComputerAutoStart,
  });
  const loginMutation = useLoginMutation();
  const logoutMutation = useLogoutMutation({
    onLogout: routeToLogin,
  });
  const createMachineMutation = useCreateMachineMutation();
  const stopMachineMutation = useStopMachineMutation();
  const shouldShowFirstRemoteMachineCreate =
    hasLoadedMachines &&
    computers.length === 0 &&
    machinesError === null;
  const isPreparingMachinesGate =
    authState === "authenticated" &&
    hasLoadedMachines === false &&
    activeRoute.view !== "workspace";

  useBootstrapAuth({
    onAuthFailure: routeToLogin,
  });

  useEffect(() => {
    setHasSeenMachinesOnboarding(readStoredBoolean(machinesOnboardingStorageKey));
  }, [machinesOnboardingStorageKey]);

  useEffect(() => {
    setCanShowMissingMachine(false);

    if (
      selectedComputerId === null ||
      selectedComputer !== null ||
      !hasLoadedMachines ||
      machinesQuery.isFetching
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCanShowMissingMachine(true);
    }, 800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [hasLoadedMachines, machinesQuery.isFetching, selectedComputer, selectedComputerId]);

  useEffect(() => {
    if (activeRoute.view === "workspace") {
      return;
    }

    setAutoStartSuppressedComputerIds((current) => current.size === 0 ? current : new Set<string>());
  }, [activeRoute.view]);

  useEffect(() => {
    if (authState === "checking") {
      return;
    }

    if (authState === "unauthenticated" || user === null) {
      if (activeRoute.view !== "login") {
        changeRoute({ view: "login" }, { replace: true });
      }
      return;
    }

    if (authState !== "authenticated") {
      return;
    }

    if (activeRoute.view !== "home" && activeRoute.view !== "login" && activeRoute.view !== "machines") {
      return;
    }

    if (!hasLoadedMachines) {
      return;
    }

    if (activeRoute.view === "home" || activeRoute.view === "login") {
      changeRoute(getPostAuthRoute(computers), { replace: true });
      return;
    }

    if (activeRoute.view === "machines" && shouldShowFirstRemoteMachineCreate) {
      changeRoute({ view: "machine-create" }, { replace: true });
    }
  }, [
    activeRoute.view,
    authState,
    changeRoute,
    computers,
    hasLoadedMachines,
    shouldShowFirstRemoteMachineCreate,
    user,
  ]);

  const login = async (input: { readonly email: string; readonly password: string }): Promise<boolean> => {
    try {
      await loginMutation.mutateAsync(input);
      return true;
    } catch {
      return false;
    }
  };

  const completeLogin = useCallback((): void => {
    authStore.getState().completeLogin();
  }, [authStore]);

  const dismissMachinesOnboarding = useCallback((): void => {
    writeStoredBoolean(machinesOnboardingStorageKey, true);
    setHasSeenMachinesOnboarding(true);
  }, [machinesOnboardingStorageKey]);

  const showMachinesOnboarding = useCallback((): void => {
    setHasSeenMachinesOnboarding(false);
  }, []);

  const logout = async (): Promise<void> => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // The local session is cleared before the remote revoke request is sent.
    }
  };

  const createMachine = async (input: { readonly name: string }): Promise<void> => {
    try {
      await createMachineMutation.mutateAsync(input);
      changeRoute({ view: "machines" }, { replace: true });
    } catch {
      // The mutation stores the error for the form.
    }
  };

  const sleepSelectedMachine = useCallback(async (): Promise<void> => {
    if (selectedComputerId === null) {
      return;
    }

    const computerId = selectedComputerId;
    setAutoStartSuppressedComputerIds((current) => new Set(current).add(computerId));

    try {
      await stopMachineMutation.mutateAsync(computerId);
    } catch (error) {
      setAutoStartSuppressedComputerIds((current) => {
        const next = new Set(current);
        next.delete(computerId);
        return next;
      });
      throw error;
    }

    changeRoute({ view: "machines" });
  }, [changeRoute, selectedComputerId, stopMachineMutation]);

  const openMachine = (computer: CloudComputer): void => {
    changeRoute({ view: "workspace", computerId: computer.id, threadId: null });
  };

  const closeMachine = (): void => {
    changeRoute({ view: "machines" });
  };

  const selectThread = useCallback((thread: AgentThreadSummary): void => {
    if (selectedComputerId === null) {
      return;
    }

    changeRoute({ view: "workspace", computerId: selectedComputerId, panel: "chat", threadId: thread.id });
  }, [changeRoute, selectedComputerId]);

  const newThread = useCallback((): void => {
    if (selectedComputerId === null) {
      return;
    }

    changeRoute({ view: "workspace", computerId: selectedComputerId, panel: "chat", threadId: null });
  }, [changeRoute, selectedComputerId]);

  const openConnectors = useCallback((): void => {
    if (selectedComputerId === null) {
      return;
    }

    changeRoute({ view: "workspace", computerId: selectedComputerId, panel: "connectors", threadId: null });
  }, [changeRoute, selectedComputerId]);

  const closeConnectors = useCallback((): void => {
    if (selectedComputerId === null) {
      return;
    }

    changeRoute({ view: "workspace", computerId: selectedComputerId, panel: "chat", threadId: null });
  }, [changeRoute, selectedComputerId]);

  const resolveThread = useCallback((threadId: string): void => {
    if (selectedComputerId === null || selectedThreadId === threadId) {
      return;
    }

    changeRoute({ view: "workspace", computerId: selectedComputerId, panel: "chat", threadId }, { replace: true });
  }, [changeRoute, selectedComputerId, selectedThreadId]);

  const startRemoteMachineCreate = (): void => {
    machinesStore.getState().setError(null);
    createMachineMutation.reset();
    changeRoute({ view: "machine-create" });
  };

  const refreshMachines = async (): Promise<void> => {
    await machinesQuery.refetch();
  };

  const shouldShowWorkspaceStartup = selectedComputer !== null &&
    selectedComputer.kind !== "local" &&
    selectedComputer.status === "starting";
  const shouldShowRouteLoader =
    activeRoute.view === "home" ||
    (user === null && activeRoute.view !== "login") ||
    (authState === "unauthenticated" && activeRoute.view !== "login") ||
    (authState === "authenticated" && activeRoute.view === "login") ||
    (activeRoute.view === "machines" && shouldShowFirstRemoteMachineCreate);
  const loginError = loginMutation.error instanceof Error ? loginMutation.error.message : null;
  const createMachineError = createMachineMutation.error instanceof Error
    ? createMachineMutation.error.message
    : machinesError;
  let screenKey: string;
  let screenContent: React.ReactElement;

  if (authState === "checking" || shouldShowRouteLoader) {
    screenKey = "auth-checking";
    screenContent = (
      <main className="cloud-shell">
        <div className="cloud-loading" role="status" aria-label="Loading" />
      </main>
    );
  } else if ((authState === "unauthenticated" || user === null) && activeRoute.view === "login") {
    screenKey = "login";
    screenContent = (
      <LoginScreen
        error={loginError}
        isSubmitting={loginMutation.isPending}
        onSuccessComplete={completeLogin}
        onSubmit={login}
      />
    );
  } else if (isPreparingMachinesGate) {
    screenKey = "preparing";
    screenContent = (
      <main className="cloud-shell">
        <div className="cloud-loading" role="status" aria-label="Loading" />
      </main>
    );
  } else if (activeRoute.view === "machine-create" && user !== null) {
    screenKey = "remote-machine-create";
    screenContent = (
      <RemoteMachineCreateScreen
        error={createMachineError}
        isSubmitting={createMachineMutation.isPending}
        onCreateMachine={createMachine}
        onLogout={logout}
        user={user}
      />
    );
  } else if (selectedComputerId !== null) {
    if (shouldShowWorkspaceStartup && selectedComputer !== null) {
      screenKey = `remote-workspace-starting:${selectedComputer.id}`;
      screenContent = (
        <main className="cloud-workspace">
          {renderWorkspaceLoader?.({
            ariaLabel: "Starting machine",
            computer: selectedComputer,
            label: "Starting",
          }) ?? <div className="cloud-loading" role="status" aria-label="Starting machine" />}
        </main>
      );
    } else if (selectedComputer === null || workspaceSession.accessSession === null) {
      const workspaceStateMessage = workspaceSession.error === "Machine not found." && !canShowMissingMachine
        ? null
        : workspaceSession.error;
      screenKey = "workspace-state";
      screenContent = (
        <main className="cloud-shell">
          {workspaceStateMessage === null ? null : (
            <div className="cloud-workspace-state">
              <button className="cloud-text-button" type="button" onClick={closeMachine}>Machines</button>
              <p>{workspaceStateMessage}</p>
            </div>
          )}
        </main>
      );
    } else {
      screenKey = `remote-workspace:${selectedComputer.id}`;
      screenContent = renderWorkspace?.({
        agentBaseUrl: buildGatewayHttpUrl({
          baseUrl: client.baseUrl,
          path: workspaceSession.accessSession.routes.agentBaseUrl,
          token: workspaceSession.accessSession.accessSession.token,
        }),
        capabilitiesBaseUrl: workspaceSession.accessSession.routes.capabilitiesBaseUrl === undefined ? undefined : buildGatewayHttpUrl({
          baseUrl: client.baseUrl,
          path: workspaceSession.accessSession.routes.capabilitiesBaseUrl,
          token: workspaceSession.accessSession.accessSession.token,
        }),
        computer: selectedComputer,
        filesystemWebsocketUrl: buildGatewayWebsocketUrl({
          baseUrl: client.baseUrl,
          path: workspaceSession.accessSession.routes.filesystemWebSocketUrl,
          token: workspaceSession.accessSession.accessSession.token,
        }),
        selectedThreadId,
        workspacePanel: selectedWorkspacePanel,
        onSelectThread: selectThread,
        onNewThread: newThread,
        onOpenConnectors: openConnectors,
        onCloseConnectors: closeConnectors,
        onThreadResolved: resolveThread,
        onBackToMachines: closeMachine,
        onSleepMachine: sleepSelectedMachine,
        suppressConnectionLoader: true,
      }) ?? (
        <main className="cloud-shell">
          <div className="cloud-loading" role="status" aria-label="Loading workspace" />
        </main>
      );
    }
  } else if (user !== null) {
    screenKey = "machines";
    screenContent = (
      <MyMachinesScreen
        computers={computers}
        error={machinesError}
        isCreatingMachine={createMachineMutation.isPending}
        isLoading={machinesQuery.isFetching}
        onOpenMachine={openMachine}
        onLogout={logout}
        onDismissOnboarding={dismissMachinesOnboarding}
        onShowOnboarding={showMachinesOnboarding}
        onRefresh={refreshMachines}
        onStartCreateMachine={startRemoteMachineCreate}
        showOnboardingModal={!hasSeenMachinesOnboarding}
        user={user}
      />
    );
  } else {
    screenKey = "auth-checking";
    screenContent = (
      <main className="cloud-shell">
        <div className="cloud-loading" role="status" aria-label="Loading" />
      </main>
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={screenKey}
        className="cloud-screen-transition"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={CLOUD_SCREEN_TRANSITION}
      >
        {screenContent}
      </motion.div>
    </AnimatePresence>
  );
}

const buildGatewayWebsocketUrl = (input: {
  readonly baseUrl: string;
  readonly path: string;
  readonly token: string;
}): string => {
  const url = new URL(input.path, input.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("accessToken", input.token);

  return url.toString();
};

const buildGatewayHttpUrl = (input: {
  readonly baseUrl: string;
  readonly path: string;
  readonly token: string;
}): string => {
  const url = new URL(input.path, input.baseUrl);
  url.searchParams.set("accessToken", input.token);

  return url.toString();
};

const getPostAuthRoute = (computers: readonly CloudComputer[]): CloudAppRoute =>
  computers.length === 0 ? { view: "machine-create" } : { view: "machines" };
