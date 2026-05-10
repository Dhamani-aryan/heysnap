"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import type { AgentThreadSummary } from "../agent/types";
import {
  CloudClient,
  type CloudComputer,
  type CloudUser,
  type ComputerAccessSessionResponse,
} from "./cloud-client";
import { LoginScreen } from "./login-screen";
import { MachineWorkspace, MachineWorkspaceLoader } from "./machine-workspace";
import { MyMachinesScreen } from "./my-machines-screen";
import { RemoteMachineCreateScreen } from "./remote-machine-create-screen";

const DEFAULT_CLOUD_SERVER_URL = "https://api.heysnap.xyz";
const DEFAULT_STORAGE_KEY = "ank1015:cloud-session-token";
const MACHINES_ONBOARDING_STORAGE_KEY_SUFFIX = ":machines-onboarding-shown";
const MACHINES_REFRESH_INTERVAL_MS = 5000;
const SELECTED_MACHINE_STARTUP_POLL_INTERVAL_MS = 2000;
const ACCESS_SESSION_REFRESH_BUFFER_MS = 60_000;
const CLOUD_SCREEN_TRANSITION = { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const };

export interface CloudAppProps {
  readonly cloudServerUrl?: string;
  readonly route?: CloudAppRoute;
  readonly onRouteChange?: (route: CloudAppRoute, options?: CloudRouteChangeOptions) => void;
  readonly storageKey?: string;
}

export type CloudAppRoute =
  | { readonly view: "home" }
  | { readonly view: "login" }
  | { readonly view: "machines" }
  | { readonly view: "machine-create" }
  | {
    readonly view: "workspace";
    readonly computerId: string;
    readonly threadId?: string | null;
  };

export interface CloudRouteChangeOptions {
  readonly replace?: boolean;
}

export function CloudApp({
  cloudServerUrl = DEFAULT_CLOUD_SERVER_URL,
  route,
  onRouteChange,
  storageKey = DEFAULT_STORAGE_KEY,
}: CloudAppProps): React.ReactElement {
  const client = useMemo(() => new CloudClient(cloudServerUrl), [cloudServerUrl]);
  const machinesOnboardingStorageKey = `${storageKey}${MACHINES_ONBOARDING_STORAGE_KEY_SUFFIX}`;
  const [internalRoute, setInternalRoute] = useState<CloudAppRoute>({ view: "home" });
  const activeRoute = route ?? internalRoute;
  const routeComputerId = activeRoute.view === "workspace" ? activeRoute.computerId : null;
  const routeThreadId = activeRoute.view === "workspace" ? activeRoute.threadId ?? null : null;
  const routeComputerIdRef = useRef<string | null>(routeComputerId);
  const startingComputerIdsRef = useRef<Set<string>>(new Set());
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<CloudUser | null>(null);
  const [hasSeenMachinesOnboarding, setHasSeenMachinesOnboarding] = useState(() =>
    readStoredBoolean(machinesOnboardingStorageKey),
  );
  const [computers, setComputers] = useState<CloudComputer[]>([]);
  const [hasLoadedMachines, setHasLoadedMachines] = useState(false);
  const [selectedComputerId, setSelectedComputerId] = useState<string | null>(routeComputerId);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(routeThreadId);
  const [accessSession, setAccessSession] = useState<ComputerAccessSessionResponse | null>(null);
  const [accessSessionRefreshTick, setAccessSessionRefreshTick] = useState(0);
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "unauthenticated">("checking");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [machinesError, setMachinesError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoadingMachines, setIsLoadingMachines] = useState(false);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [isCreatingMachine, setIsCreatingMachine] = useState(false);
  const [workspaceMachineStartup, setWorkspaceMachineStartup] = useState<{
    readonly computerId: string;
    readonly phase: "checking" | "starting";
  } | null>(null);
  const selectedComputer = selectedComputerId === null
    ? null
    : computers.find((computer) => computer.id === selectedComputerId) ?? null;
  const selectedComputerKind = selectedComputer?.kind ?? null;
  const selectedComputerStatus = selectedComputer?.status ?? null;
  const workspaceMachineStartupPhase = selectedComputerId !== null &&
    workspaceMachineStartup?.computerId === selectedComputerId
      ? workspaceMachineStartup.phase
      : null;
  const isPreparingMachinesGate =
    authState === "authenticated" &&
    hasLoadedMachines === false;
  const shouldShowFirstRemoteMachineCreate =
    hasLoadedMachines &&
    computers.length === 0 &&
    machinesError === null;

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

  const clearSession = useCallback(() => {
    removeStoredToken(storageKey);
    removeStoredBoolean(machinesOnboardingStorageKey);
    startingComputerIdsRef.current.clear();
    setToken(null);
    setUser(null);
    setHasSeenMachinesOnboarding(false);
    setComputers([]);
    setHasLoadedMachines(false);
    setSelectedComputerId(null);
    setSelectedThreadId(null);
    setAccessSession(null);
    setWorkspaceMachineStartup(null);
    setAuthState("unauthenticated");
    changeRoute({ view: "login" }, { replace: true });
  }, [changeRoute, machinesOnboardingStorageKey, storageKey]);

  const upsertComputer = useCallback((computer: CloudComputer): void => {
    setComputers((currentComputers) => [
      computer,
      ...currentComputers.filter((currentComputer) => currentComputer.id !== computer.id),
    ]);
  }, []);

  const refreshMachines = useCallback(async () => {
    if (token === null) {
      return;
    }

    setIsLoadingMachines(true);
    setMachinesError(null);

    try {
      const response = await client.listComputers(token);
      setComputers(response.computers);
      setHasLoadedMachines(true);
    } catch (error) {
      if (isAuthFailure(error)) {
        clearSession();
        return;
      }

      setHasLoadedMachines(true);
      setMachinesError(error instanceof Error ? error.message : "Failed to load machines.");
    } finally {
      setIsLoadingMachines(false);
    }
  }, [clearSession, client, token]);

  useEffect(() => {
    setHasSeenMachinesOnboarding(readStoredBoolean(machinesOnboardingStorageKey));
  }, [machinesOnboardingStorageKey]);

  useEffect(() => {
    const storedToken = readStoredToken(storageKey);

    if (storedToken === null) {
      setAuthState("unauthenticated");
      return;
    }

    let isCurrent = true;
    setToken(storedToken);
    setAuthState("checking");

    void client.me(storedToken)
      .then((response) => {
        if (!isCurrent) {
          return;
        }

        setUser(response.user);
        setAuthState("authenticated");
      })
      .catch(() => {
        if (isCurrent) {
          clearSession();
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [clearSession, client, storageKey]);

  useEffect(() => {
    if (authState !== "authenticated") {
      return;
    }

    void refreshMachines();
  }, [authState, refreshMachines]);

  useEffect(() => {
    if (authState !== "authenticated") {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshMachines();
    }, MACHINES_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [authState, refreshMachines]);

  useEffect(() => {
    const nextComputerId = activeRoute.view === "workspace" ? activeRoute.computerId : null;
    const nextThreadId = activeRoute.view === "workspace" ? activeRoute.threadId ?? null : null;
    const didComputerChange = routeComputerIdRef.current !== nextComputerId;

    setSelectedComputerId(nextComputerId);
    setSelectedThreadId(nextThreadId);

    if (didComputerChange) {
      routeComputerIdRef.current = nextComputerId;
      setAccessSession(null);
      setWorkspaceError(null);
      setWorkspaceMachineStartup(null);
    }
  }, [activeRoute]);

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

  useEffect(() => {
    if (accessSession === null) {
      return;
    }

    const expiresAt = Date.parse(accessSession.accessSession.expiresAt);

    if (!Number.isFinite(expiresAt)) {
      return;
    }

    const refreshDelay = Math.max(0, expiresAt - Date.now() - ACCESS_SESSION_REFRESH_BUFFER_MS);
    const refreshTimer = window.setTimeout(() => {
      setAccessSessionRefreshTick((currentTick) => currentTick + 1);
    }, refreshDelay);

    return () => {
      window.clearTimeout(refreshTimer);
    };
  }, [accessSession]);

  useEffect(() => {
    if (authState !== "authenticated" || token === null || selectedComputerId === null) {
      return;
    }

    let isCurrent = true;
    const computerId = selectedComputerId;

    setWorkspaceMachineStartup({ computerId, phase: "checking" });
    setWorkspaceError(null);

    void client.getComputer(token, computerId)
      .then(async (response) => {
        if (!isCurrent) {
          return;
        }

        upsertComputer(response.computer);

        if (response.computer.kind === "local") {
          setWorkspaceMachineStartup((current) =>
            current?.computerId === computerId ? null : current
          );
          return;
        }

        if (response.computer.status === "sleeping") {
          setWorkspaceMachineStartup({ computerId, phase: "starting" });

          if (startingComputerIdsRef.current.has(computerId)) {
            return;
          }

          startingComputerIdsRef.current.add(computerId);

          try {
            const startResponse = await client.startComputer(token, computerId);

            if (!isCurrent) {
              return;
            }

            upsertComputer(startResponse.computer);

            if (!isRemoteMachinePendingStartup(startResponse.computer.status)) {
              setWorkspaceMachineStartup((current) =>
                current?.computerId === computerId ? null : current
              );
            }
          } finally {
            startingComputerIdsRef.current.delete(computerId);
          }

          return;
        }

        if (isRemoteMachinePendingStartup(response.computer.status)) {
          setWorkspaceMachineStartup({ computerId, phase: "starting" });
          return;
        }

        setWorkspaceMachineStartup((current) =>
          current?.computerId === computerId ? null : current
        );
      })
      .catch((error) => {
        if (!isCurrent) {
          return;
        }

        if (isAuthFailure(error)) {
          clearSession();
          return;
        }

        setWorkspaceMachineStartup((current) =>
          current?.computerId === computerId ? null : current
        );
        setWorkspaceError(error instanceof Error ? error.message : "Failed to check machine status.");
      });

    return () => {
      isCurrent = false;
    };
  }, [authState, clearSession, client, selectedComputerId, token, upsertComputer]);

  useEffect(() => {
    if (
      authState !== "authenticated" ||
      token === null ||
      selectedComputerId === null ||
      workspaceMachineStartupPhase !== "starting"
    ) {
      return;
    }

    let isCurrent = true;
    let pollTimer: number | undefined;
    const computerId = selectedComputerId;

    const pollSelectedMachine = (): void => {
      void client.getComputer(token, computerId)
        .then((response) => {
          if (!isCurrent) {
            return;
          }

          upsertComputer(response.computer);

          if (
            response.computer.kind === "local" ||
            isRemoteMachineConnectable(response.computer.status)
          ) {
            setWorkspaceMachineStartup((current) =>
              current?.computerId === computerId ? null : current
            );
            return;
          }

          if (isRemoteMachineTerminal(response.computer.status)) {
            setWorkspaceMachineStartup((current) =>
              current?.computerId === computerId ? null : current
            );
            setWorkspaceError(getRemoteMachineUnavailableMessage(response.computer.status));
            return;
          }

          pollTimer = window.setTimeout(pollSelectedMachine, SELECTED_MACHINE_STARTUP_POLL_INTERVAL_MS);
        })
        .catch((error) => {
          if (!isCurrent) {
            return;
          }

          if (isAuthFailure(error)) {
            clearSession();
            return;
          }

          pollTimer = window.setTimeout(pollSelectedMachine, SELECTED_MACHINE_STARTUP_POLL_INTERVAL_MS);
        });
    };

    pollTimer = window.setTimeout(pollSelectedMachine, SELECTED_MACHINE_STARTUP_POLL_INTERVAL_MS);

    return () => {
      isCurrent = false;

      if (pollTimer !== undefined) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [
    authState,
    clearSession,
    client,
    selectedComputerId,
    token,
    upsertComputer,
    workspaceMachineStartupPhase,
  ]);

  useEffect(() => {
    if (authState !== "authenticated" || token === null || selectedComputerId === null) {
      return;
    }

    if (workspaceMachineStartupPhase !== null) {
      setAccessSession(null);
      setIsLoadingWorkspace(workspaceMachineStartupPhase === "checking");
      setWorkspaceError(null);
      return;
    }

    if (selectedComputer === null) {
      return;
    }

    if (!isRemoteMachineConnectable(selectedComputer.status)) {
      setAccessSession(null);
      setIsLoadingWorkspace(false);
      setWorkspaceError(getRemoteMachineUnavailableMessage(selectedComputer.status));
      return;
    }

    if (isAccessSessionUsable(accessSession, selectedComputerId)) {
      setIsLoadingWorkspace(false);
      setWorkspaceError(null);
      return;
    }

    let isCurrent = true;
    setIsLoadingWorkspace(true);
    setWorkspaceError(null);
    if (accessSession?.accessSession.computerId !== selectedComputerId) {
      setAccessSession(null);
    }

    void client.createComputerAccessSession(token, selectedComputerId)
      .then((response) => {
        if (isCurrent) {
          setAccessSession(response);
        }
      })
      .catch((error) => {
        if (!isCurrent) {
          return;
        }

        if (isAuthFailure(error)) {
          clearSession();
          return;
        }

        setWorkspaceError(error instanceof Error ? error.message : "Failed to open machine.");
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoadingWorkspace(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [
    accessSession,
    accessSessionRefreshTick,
    authState,
    clearSession,
    client,
    selectedComputerId,
    selectedComputerKind,
    selectedComputerStatus,
    token,
    workspaceMachineStartupPhase,
  ]);

  const login = async (input: { readonly email: string; readonly password: string }): Promise<boolean> => {
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const response = await client.login(input);
      writeStoredToken(storageKey, response.session.token);
      setToken(response.session.token);
      setUser(response.user);
      return true;
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Unable to sign in.");
      return false;
    } finally {
      setIsLoggingIn(false);
    }
  };

  const completeLogin = useCallback((): void => {
    setAuthState("authenticated");
  }, []);

  const dismissMachinesOnboarding = useCallback((): void => {
    writeStoredBoolean(machinesOnboardingStorageKey, true);
    setHasSeenMachinesOnboarding(true);
  }, [machinesOnboardingStorageKey]);

  const logout = async (): Promise<void> => {
    const currentToken = token;
    clearSession();

    if (currentToken !== null) {
      try {
        await client.logout(currentToken);
      } catch {
        // The local session should still be cleared if the remote revoke fails.
      }
    }
  };

  const createMachine = async (input: { readonly name: string }): Promise<void> => {
    if (token === null) {
      clearSession();
      return;
    }

    setIsCreatingMachine(true);
    setMachinesError(null);

    try {
      const response = await client.createComputer(token, input);
      upsertComputer(response.computer);
      changeRoute({ view: "machines" }, { replace: true });
      void refreshMachines();
    } catch (error) {
      if (isAuthFailure(error)) {
        clearSession();
        return;
      }

      setMachinesError(error instanceof Error ? error.message : "Failed to create machine.");
      void refreshMachines();
      throw error;
    } finally {
      setIsCreatingMachine(false);
    }
  };

  const sleepSelectedMachine = useCallback(async (): Promise<void> => {
    if (token === null || selectedComputerId === null) {
      clearSession();
      return;
    }

    const computerId = selectedComputerId;

    try {
      const response = await client.stopComputer(token, computerId);
      upsertComputer(response.computer);
      setSelectedComputerId(null);
      setSelectedThreadId(null);
      setAccessSession(null);
      setWorkspaceError(null);
      setWorkspaceMachineStartup(null);
      changeRoute({ view: "machines" });
      void refreshMachines();
    } catch (error) {
      if (isAuthFailure(error)) {
        clearSession();
        return;
      }

      throw error;
    }
  }, [
    clearSession,
    client,
    refreshMachines,
    selectedComputerId,
    token,
    changeRoute,
    upsertComputer,
  ]);

  const openMachine = (computer: CloudComputer): void => {
    setSelectedComputerId(computer.id);
    setSelectedThreadId(null);
    setAccessSession(null);
    setWorkspaceError(null);
    setWorkspaceMachineStartup(null);
    changeRoute({ view: "workspace", computerId: computer.id, threadId: null });
  };

  const closeMachine = (): void => {
    setSelectedComputerId(null);
    setSelectedThreadId(null);
    setAccessSession(null);
    setWorkspaceError(null);
    setWorkspaceMachineStartup(null);
    changeRoute({ view: "machines" });
  };

  const selectThread = useCallback((thread: AgentThreadSummary): void => {
    if (selectedComputerId === null) {
      return;
    }

    setSelectedThreadId(thread.id);
    changeRoute({ view: "workspace", computerId: selectedComputerId, threadId: thread.id });
  }, [changeRoute, selectedComputerId]);

  const newThread = useCallback((): void => {
    if (selectedComputerId === null) {
      return;
    }

    setSelectedThreadId(null);
    changeRoute({ view: "workspace", computerId: selectedComputerId, threadId: null });
  }, [changeRoute, selectedComputerId]);

  const resolveThread = useCallback((threadId: string): void => {
    if (selectedComputerId === null || selectedThreadId === threadId) {
      return;
    }

    setSelectedThreadId(threadId);
    changeRoute({ view: "workspace", computerId: selectedComputerId, threadId }, { replace: true });
  }, [changeRoute, selectedComputerId, selectedThreadId]);

  const startRemoteMachineCreate = (): void => {
    setMachinesError(null);
    changeRoute({ view: "machine-create" });
  };

  const closeRemoteMachineCreate = (): void => {
    setMachinesError(null);
    changeRoute({ view: "machines" });
  };

  const shouldShowWorkspaceStartup = selectedComputer !== null &&
    selectedComputer.kind !== "local" &&
    (
      workspaceMachineStartupPhase === "starting" ||
      isRemoteMachinePendingStartup(selectedComputer.status)
    );
  const shouldShowRouteLoader =
    activeRoute.view === "home" ||
    (user === null && activeRoute.view !== "login") ||
    (authState === "unauthenticated" && activeRoute.view !== "login") ||
    (authState === "authenticated" && activeRoute.view === "login") ||
    (activeRoute.view === "machines" && shouldShowFirstRemoteMachineCreate);
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
        isSubmitting={isLoggingIn}
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
  } else if (activeRoute.view === "machine-create") {
    screenKey = "remote-machine-create";
    screenContent = (
      <RemoteMachineCreateScreen
        error={machinesError}
        isSubmitting={isCreatingMachine}
        onBack={closeRemoteMachineCreate}
        onCreateMachine={createMachine}
        onLogout={logout}
        showBackButton={!shouldShowFirstRemoteMachineCreate}
      />
    );
  } else if (selectedComputerId !== null) {
    if (shouldShowWorkspaceStartup && selectedComputer !== null) {
      screenKey = `remote-workspace-starting:${selectedComputer.id}`;
      screenContent = (
        <main className="cloud-workspace">
          <MachineWorkspaceLoader
            ariaLabel="Starting machine"
            computer={selectedComputer}
            label="Starting"
          />
        </main>
      );
    } else if (selectedComputer === null || accessSession === null) {
      screenKey = "workspace-state";
      screenContent = (
        <main className="cloud-shell">
          <div className="cloud-workspace-state">
            <button className="cloud-text-button" type="button" onClick={closeMachine}>Machines</button>
            <p>
              {workspaceError ?? (
                workspaceMachineStartupPhase === "checking"
                  ? "Checking machine..."
                  : isLoadingWorkspace
                    ? "Opening machine..."
                    : workspaceMachineStartupPhase === "starting"
                      ? "Starting machine..."
                      : "Machine not found."
              )}
            </p>
          </div>
        </main>
      );
    } else {
      screenKey = `remote-workspace:${selectedComputer.id}`;
      screenContent = (
        <MachineWorkspace
          agentBaseUrl={buildGatewayHttpUrl({
            baseUrl: client.baseUrl,
            path: accessSession.routes.agentBaseUrl,
            token: accessSession.accessSession.token,
          })}
          capabilitiesWebsocketUrl={accessSession.routes.capabilitiesWebSocketUrl === undefined ? undefined : buildGatewayWebsocketUrl({
            baseUrl: client.baseUrl,
            path: accessSession.routes.capabilitiesWebSocketUrl,
            token: accessSession.accessSession.token,
          })}
          computer={selectedComputer}
          filesystemWebsocketUrl={buildGatewayWebsocketUrl({
            baseUrl: client.baseUrl,
            path: accessSession.routes.filesystemWebSocketUrl,
            token: accessSession.accessSession.token,
          })}
          selectedThreadId={selectedThreadId}
          onSelectThread={selectThread}
          onNewThread={newThread}
          onThreadResolved={resolveThread}
          onBackToMachines={closeMachine}
          onSleepMachine={sleepSelectedMachine}
          suppressConnectionLoader={selectedThreadId !== null}
        />
      );
    }
  } else if (user !== null) {
    screenKey = "machines";
    screenContent = (
      <MyMachinesScreen
        computers={computers}
        error={machinesError}
        isCreatingMachine={isCreatingMachine}
        isLoading={isLoadingMachines}
        onOpenMachine={openMachine}
        onLogout={logout}
        onDismissOnboarding={dismissMachinesOnboarding}
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

const readStoredToken = (storageKey: string): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const token = window.localStorage.getItem(storageKey);
    return token === null || token.length === 0 ? null : token;
  } catch {
    return null;
  }
};

const writeStoredToken = (storageKey: string, token: string): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, token);
  } catch {
    // The in-memory session still works for this tab when storage is unavailable.
  }
};

const removeStoredToken = (storageKey: string): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nothing else to clear.
  }
};

const readStoredBoolean = (storageKey: string): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
};

const writeStoredBoolean = (storageKey: string, value: boolean): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, value ? "true" : "false");
  } catch {
    // Showing the modal again is acceptable when storage is unavailable.
  }
};

const removeStoredBoolean = (storageKey: string): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nothing else to clear.
  }
};

const isAuthFailure = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  (error as { readonly status?: unknown }).status === 401;

const isRemoteMachineConnectable = (status: string): boolean =>
  status === "online" || status === "idle";

const isRemoteMachinePendingStartup = (status: string): boolean =>
  status === "creating" || status === "starting";

const isRemoteMachineTerminal = (status: string): boolean =>
  status === "failed" || status === "offline" || status === "deleted";

const getRemoteMachineUnavailableMessage = (status: string): string => {
  if (status === "failed") {
    return "Machine failed to start.";
  }

  if (status === "offline") {
    return "Machine is offline.";
  }

  if (status === "deleted") {
    return "Machine not found.";
  }

  if (status === "sleeping") {
    return "Machine is sleeping.";
  }

  return `Machine is ${formatStatusLabel(status).toLowerCase()}.`;
};

const formatStatusLabel = (status: string): string =>
  status
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

const isAccessSessionUsable = (
  response: ComputerAccessSessionResponse | null,
  computerId: string,
): boolean => {
  if (response === null || response.accessSession.computerId !== computerId) {
    return false;
  }

  const expiresAt = Date.parse(response.accessSession.expiresAt);

  return Number.isFinite(expiresAt) && expiresAt - Date.now() > ACCESS_SESSION_REFRESH_BUFFER_MS;
};

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
