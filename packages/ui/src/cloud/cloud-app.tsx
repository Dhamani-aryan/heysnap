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
import { LocalMachineOnboardingScreen } from "./local-machine-onboarding-screen";
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
  readonly includeLocalMachine?: boolean;
  readonly initialComputerId?: string;
  readonly initialThreadId?: string;
  readonly localMachineBridge?: LocalMachineBridge;
  readonly machineRouteBasePath?: string;
  readonly onWorkspaceRouteChange?: (
    route: { readonly computerId: string | null; readonly threadId: string | null },
    options?: { readonly replace?: boolean },
  ) => void;
  readonly storageKey?: string;
}

export interface LocalMachineBridge {
  getStatus(): Promise<LocalMachineBridgeStatus>;
  getRegistrationPreview(): Promise<LocalMachineRegistrationPreview>;
  syncCloudSession(input: {
    readonly cloudServerUrl: string;
    readonly sessionToken: string;
    readonly name?: string;
  }): Promise<LocalMachineBridgeStatus>;
}

export interface LocalMachineRegistrationPreview {
  readonly localDeviceId: string;
  readonly name: string;
}

export interface LocalMachineBridgeStatus {
  readonly server: {
    readonly state: "starting" | "running" | "failed" | "stopped";
    readonly port: number | null;
    readonly filesystemRoot: string | null;
    readonly urls: {
      readonly filesystemWebSocketUrl: string;
      readonly agentBaseUrl: string;
      readonly capabilitiesWebSocketUrl?: string;
    } | null;
    readonly error: string | null;
  };
  readonly cloud: {
    readonly state: "not-synced" | "syncing" | "synced" | "failed";
    readonly computer: CloudComputer | null;
    readonly error: string | null;
    readonly lastHeartbeatAt: string | null;
  };
}

export function CloudApp({
  cloudServerUrl = DEFAULT_CLOUD_SERVER_URL,
  includeLocalMachine = false,
  initialComputerId,
  initialThreadId,
  localMachineBridge,
  machineRouteBasePath,
  onWorkspaceRouteChange,
  storageKey = DEFAULT_STORAGE_KEY,
}: CloudAppProps): React.ReactElement {
  const client = useMemo(() => new CloudClient(cloudServerUrl), [cloudServerUrl]);
  const machinesOnboardingStorageKey = `${storageKey}${MACHINES_ONBOARDING_STORAGE_KEY_SUFFIX}`;
  const shouldManageLocalMachine = includeLocalMachine && localMachineBridge !== undefined;
  const lastLocalSyncKeyRef = useRef<string | null>(null);
  const routeComputerIdRef = useRef<string | null>(initialComputerId ?? null);
  const startingComputerIdsRef = useRef<Set<string>>(new Set());
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<CloudUser | null>(null);
  const [hasSeenMachinesOnboarding, setHasSeenMachinesOnboarding] = useState(() =>
    readStoredBoolean(machinesOnboardingStorageKey),
  );
  const [computers, setComputers] = useState<CloudComputer[]>([]);
  const [hasLoadedMachines, setHasLoadedMachines] = useState(false);
  const [selectedComputerId, setSelectedComputerId] = useState<string | null>(initialComputerId ?? null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    initialComputerId === undefined ? null : initialThreadId ?? null,
  );
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
  const [isRemoteMachineCreateVisible, setIsRemoteMachineCreateVisible] = useState(false);
  const [localMachineStatus, setLocalMachineStatus] = useState<LocalMachineBridgeStatus | null>(null);
  const [localMachinePreview, setLocalMachinePreview] = useState<LocalMachineRegistrationPreview | null>(null);
  const [localMachineRegistrationError, setLocalMachineRegistrationError] = useState<string | null>(null);
  const [isAddingLocalMachine, setIsAddingLocalMachine] = useState(false);
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
  const localComputerForThisDevice = useMemo(() => {
    if (localMachinePreview === null) {
      return null;
    }

    return computers.find((computer) =>
      computer.kind === "local" &&
      readProviderMetadataString(computer.providerMetadata, "localDeviceId") === localMachinePreview.localDeviceId
    ) ?? null;
  }, [computers, localMachinePreview]);
  const localWorkspaceUrls = getLocalWorkspaceUrls(selectedComputer, localMachineStatus);
  const activeLocalComputerId = localMachineStatus?.server.state === "running"
    ? localMachineStatus.cloud.computer?.id ?? null
    : null;
  const isPreparingLocalMachineGate = shouldManageLocalMachine &&
    authState === "authenticated" &&
    (hasLoadedMachines === false || (localMachinePreview === null && localMachineRegistrationError === null));
  const isPreparingFirstRemoteMachineGate = !includeLocalMachine &&
    authState === "authenticated" &&
    hasLoadedMachines === false;
  const shouldShowLocalMachineOnboarding = shouldManageLocalMachine &&
    hasLoadedMachines &&
    localMachinePreview !== null &&
    localComputerForThisDevice === null &&
    (localMachineStatus === null || localMachineStatus.cloud.computer === null) &&
    machinesError === null;
  const shouldShowFirstRemoteMachineCreate = !includeLocalMachine &&
    hasLoadedMachines &&
    computers.length === 0 &&
    machinesError === null;

  const updateWorkspaceRoute = useCallback((
    route: { readonly computerId: string | null; readonly threadId: string | null },
    options: { readonly replace?: boolean } = {},
  ): void => {
    if (onWorkspaceRouteChange !== undefined) {
      onWorkspaceRouteChange(route, options);
      return;
    }

    if (machineRouteBasePath === undefined) {
      return;
    }

    const nextPath = route.computerId === null
      ? machineRouteBasePath
      : joinRoute(machineRouteBasePath, route.computerId, route.threadId);
    const method = options.replace === true ? "replaceState" : "pushState";
    window.history[method](null, "", nextPath);
  }, [machineRouteBasePath, onWorkspaceRouteChange]);

  const clearSession = useCallback(() => {
    removeStoredToken(storageKey);
    removeStoredBoolean(machinesOnboardingStorageKey);
    lastLocalSyncKeyRef.current = null;
    startingComputerIdsRef.current.clear();
    setToken(null);
    setUser(null);
    setHasSeenMachinesOnboarding(false);
    setComputers([]);
    setHasLoadedMachines(false);
    setSelectedComputerId(null);
    setSelectedThreadId(null);
    setAccessSession(null);
    setIsRemoteMachineCreateVisible(false);
    setLocalMachineStatus(null);
    setLocalMachinePreview(null);
    setLocalMachineRegistrationError(null);
    setIsAddingLocalMachine(false);
    setWorkspaceMachineStartup(null);
    setAuthState("unauthenticated");
  }, [machinesOnboardingStorageKey, storageKey]);

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

  const syncLocalMachine = useCallback(async (
    preview: LocalMachineRegistrationPreview,
  ): Promise<LocalMachineBridgeStatus | null> => {
    if (token === null || localMachineBridge === undefined) {
      return null;
    }

    const status = await localMachineBridge.syncCloudSession({
      cloudServerUrl: client.baseUrl,
      sessionToken: token,
      name: preview.name,
    });

    setLocalMachineStatus(status);

    if (status.cloud.computer !== null) {
      upsertComputer(status.cloud.computer);
    }

    return status;
  }, [client.baseUrl, localMachineBridge, token, upsertComputer]);

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
    if (authState !== "authenticated" || !shouldManageLocalMachine || localMachineBridge === undefined) {
      return;
    }

    let isCurrent = true;
    setLocalMachineRegistrationError(null);

    void localMachineBridge.getStatus()
      .then((status) => {
        if (isCurrent) {
          setLocalMachineStatus(status);
        }
      })
      .catch(() => {
        // Registration preview below provides the actionable error for this gate.
      });

    void localMachineBridge.getRegistrationPreview()
      .then((preview) => {
        if (isCurrent) {
          setLocalMachinePreview(preview);
        }
      })
      .catch((error) => {
        if (!isCurrent) {
          return;
        }

        setLocalMachineRegistrationError(
          error instanceof Error ? error.message : "Failed to read local machine details.",
        );
      });

    return () => {
      isCurrent = false;
    };
  }, [authState, localMachineBridge, shouldManageLocalMachine]);

  useEffect(() => {
    if (
      authState !== "authenticated" ||
      token === null ||
      localMachinePreview === null ||
      localComputerForThisDevice === null ||
      localMachineStatus?.cloud.computer?.id === localComputerForThisDevice.id
    ) {
      return;
    }

    const syncKey = `${token}:${localMachinePreview.localDeviceId}:${localComputerForThisDevice.id}`;

    if (lastLocalSyncKeyRef.current === syncKey) {
      return;
    }

    lastLocalSyncKeyRef.current = syncKey;

    void syncLocalMachine(localMachinePreview)
      .then(() => {
        void refreshMachines();
      })
      .catch((error) => {
        lastLocalSyncKeyRef.current = null;
        setMachinesError(error instanceof Error ? error.message : "Failed to sync local machine.");
      });
  }, [
    authState,
    localComputerForThisDevice,
    localMachinePreview,
    localMachineStatus?.cloud.computer?.id,
    refreshMachines,
    syncLocalMachine,
    token,
  ]);

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
    const nextComputerId = initialComputerId ?? null;
    const nextThreadId = initialComputerId === undefined ? null : initialThreadId ?? null;
    const didComputerChange = routeComputerIdRef.current !== nextComputerId;

    setSelectedComputerId(nextComputerId);
    setSelectedThreadId(nextThreadId);

    if (didComputerChange) {
      routeComputerIdRef.current = nextComputerId;
      setAccessSession(null);
      setWorkspaceError(null);
      setWorkspaceMachineStartup(null);
    }
  }, [initialComputerId, initialThreadId]);

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

    if (selectedComputer.kind === "local") {
      setAccessSession(null);
      setIsLoadingWorkspace(false);
      setWorkspaceError(localWorkspaceUrls === null ? "This local machine is not active in this desktop app." : null);
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
    localWorkspaceUrls,
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
    setIsRemoteMachineCreateVisible(true);
    setMachinesError(null);

    try {
      const response = await client.createComputer(token, input);
      upsertComputer(response.computer);
      setIsRemoteMachineCreateVisible(false);
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

  const addLocalMachine = async (): Promise<void> => {
    if (localMachinePreview === null) {
      return;
    }

    setIsAddingLocalMachine(true);
    setLocalMachineRegistrationError(null);
    setMachinesError(null);

    try {
      const status = await syncLocalMachine(localMachinePreview);

      if (status?.cloud.computer !== null && status?.cloud.computer !== undefined && token !== null) {
        lastLocalSyncKeyRef.current = `${token}:${localMachinePreview.localDeviceId}:${status.cloud.computer.id}`;
      }

      await refreshMachines();
    } catch (error) {
      setLocalMachineRegistrationError(
        error instanceof Error ? error.message : "Failed to add local machine.",
      );
    } finally {
      setIsAddingLocalMachine(false);
    }
  };

  const openMachine = (computer: CloudComputer): void => {
    setIsRemoteMachineCreateVisible(false);
    setSelectedComputerId(computer.id);
    setSelectedThreadId(null);
    setAccessSession(null);
    setWorkspaceError(null);
    setWorkspaceMachineStartup(null);
    updateWorkspaceRoute({ computerId: computer.id, threadId: null });
  };

  const closeMachine = (): void => {
    setSelectedComputerId(null);
    setSelectedThreadId(null);
    setAccessSession(null);
    setWorkspaceError(null);
    setWorkspaceMachineStartup(null);
    updateWorkspaceRoute({ computerId: null, threadId: null });
  };

  const selectThread = useCallback((thread: AgentThreadSummary): void => {
    if (selectedComputerId === null) {
      return;
    }

    setSelectedThreadId(thread.id);
    updateWorkspaceRoute({ computerId: selectedComputerId, threadId: thread.id });
  }, [selectedComputerId, updateWorkspaceRoute]);

  const newThread = useCallback((): void => {
    if (selectedComputerId === null) {
      return;
    }

    setSelectedThreadId(null);
    updateWorkspaceRoute({ computerId: selectedComputerId, threadId: null });
  }, [selectedComputerId, updateWorkspaceRoute]);

  const resolveThread = useCallback((threadId: string): void => {
    if (selectedComputerId === null || selectedThreadId === threadId) {
      return;
    }

    setSelectedThreadId(threadId);
    updateWorkspaceRoute({ computerId: selectedComputerId, threadId }, { replace: true });
  }, [selectedComputerId, selectedThreadId, updateWorkspaceRoute]);

  const startRemoteMachineCreate = (): void => {
    setMachinesError(null);
    setIsRemoteMachineCreateVisible(true);
  };

  const closeRemoteMachineCreate = (): void => {
    setMachinesError(null);
    setIsRemoteMachineCreateVisible(false);
  };

  const shouldShowWorkspaceStartup = selectedComputer !== null &&
    selectedComputer.kind !== "local" &&
    (
      workspaceMachineStartupPhase === "starting" ||
      isRemoteMachinePendingStartup(selectedComputer.status)
    );
  let screenKey: string;
  let screenContent: React.ReactElement;

  if (authState === "checking") {
    screenKey = "auth-checking";
    screenContent = (
      <main className="cloud-shell">
        <div className="cloud-loading" role="status" aria-label="Loading" />
      </main>
    );
  } else if (authState === "unauthenticated" || user === null) {
    screenKey = "login";
    screenContent = (
      <LoginScreen
        error={loginError}
        isSubmitting={isLoggingIn}
        onSuccessComplete={completeLogin}
        onSubmit={login}
      />
    );
  } else if (isPreparingLocalMachineGate || isPreparingFirstRemoteMachineGate) {
    screenKey = "preparing";
    screenContent = (
      <main className="cloud-shell">
        <div className="cloud-loading" role="status" aria-label="Loading" />
      </main>
    );
  } else if (shouldShowLocalMachineOnboarding && localMachinePreview !== null) {
    screenKey = "local-machine-onboarding";
    screenContent = (
      <LocalMachineOnboardingScreen
        error={localMachineRegistrationError}
        hasExistingMachines={computers.length > 0}
        isSubmitting={isAddingLocalMachine}
        machineName={localMachinePreview.name}
        onAddMachine={addLocalMachine}
        onLogout={logout}
      />
    );
  } else if (shouldShowFirstRemoteMachineCreate || isRemoteMachineCreateVisible) {
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
    } else if (selectedComputer !== null && localWorkspaceUrls !== null) {
      screenKey = `local-workspace:${selectedComputer.id}`;
      screenContent = (
        <MachineWorkspace
          agentBaseUrl={localWorkspaceUrls.agentBaseUrl}
          capabilitiesWebsocketUrl={localWorkspaceUrls.capabilitiesWebSocketUrl}
          computer={selectedComputer}
          filesystemWebsocketUrl={localWorkspaceUrls.filesystemWebSocketUrl}
          selectedThreadId={selectedThreadId}
          onSelectThread={selectThread}
          onNewThread={newThread}
          onThreadResolved={resolveThread}
          suppressConnectionLoader={selectedThreadId !== null}
        />
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
          suppressConnectionLoader={selectedThreadId !== null}
        />
      );
    }
  } else {
    screenKey = "machines";
    screenContent = (
      <MyMachinesScreen
        activeLocalComputerId={activeLocalComputerId}
        computers={computers}
        error={machinesError ?? localMachineRegistrationError}
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

const getLocalWorkspaceUrls = (
  computer: CloudComputer | null,
  status: LocalMachineBridgeStatus | null,
): { readonly filesystemWebSocketUrl: string; readonly agentBaseUrl: string; readonly capabilitiesWebSocketUrl?: string } | null => {
  if (
    computer === null ||
    computer.kind !== "local" ||
    status?.server.state !== "running" ||
    status.server.urls === null ||
    status.cloud.computer?.id !== computer.id
  ) {
    return null;
  }

  return status.server.urls;
};

const readProviderMetadataString = (metadata: unknown, key: string): string | null => {
  if (typeof metadata !== "object" || metadata === null || !(key in metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const joinRoute = (basePath: string, computerId: string, threadId: string | null = null): string => {
  const normalizedBasePath = basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  const machinePath = `${normalizedBasePath}/${encodeURIComponent(computerId)}`;
  return threadId === null ? machinePath : `${machinePath}/${encodeURIComponent(threadId)}`;
};
