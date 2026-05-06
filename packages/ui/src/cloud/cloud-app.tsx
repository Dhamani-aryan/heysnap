"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CloudClient,
  type CloudComputer,
  type CloudUser,
  type ComputerAccessSessionResponse,
} from "./cloud-client";
import { LocalMachineOnboardingScreen } from "./local-machine-onboarding-screen";
import { LoginScreen } from "./login-screen";
import { MachineWorkspace } from "./machine-workspace";
import { MyMachinesScreen } from "./my-machines-screen";
import { RemoteMachineCreateScreen } from "./remote-machine-create-screen";

const DEFAULT_CLOUD_SERVER_URL = "https://api.heysnap.xyz";
const DEFAULT_STORAGE_KEY = "ank1015:cloud-session-token";

export interface CloudAppProps {
  readonly cloudServerUrl?: string;
  readonly includeLocalMachine?: boolean;
  readonly initialComputerId?: string;
  readonly localMachineBridge?: LocalMachineBridge;
  readonly machineRouteBasePath?: string;
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
      readonly agentWebSocketUrl: string;
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
  localMachineBridge,
  machineRouteBasePath,
  storageKey = DEFAULT_STORAGE_KEY,
}: CloudAppProps): React.ReactElement {
  const client = useMemo(() => new CloudClient(cloudServerUrl), [cloudServerUrl]);
  const shouldManageLocalMachine = includeLocalMachine && localMachineBridge !== undefined;
  const lastLocalSyncKeyRef = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<CloudUser | null>(null);
  const [computers, setComputers] = useState<CloudComputer[]>([]);
  const [hasLoadedMachines, setHasLoadedMachines] = useState(false);
  const [selectedComputerId, setSelectedComputerId] = useState<string | null>(initialComputerId ?? null);
  const [accessSession, setAccessSession] = useState<ComputerAccessSessionResponse | null>(null);
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
  const selectedComputer = selectedComputerId === null
    ? null
    : computers.find((computer) => computer.id === selectedComputerId) ?? null;
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
  const shouldShowLocalMachineOnboarding = shouldManageLocalMachine &&
    hasLoadedMachines &&
    localMachinePreview !== null &&
    localComputerForThisDevice === null &&
    (localMachineStatus === null || localMachineStatus.cloud.computer === null) &&
    machinesError === null;

  const clearSession = useCallback(() => {
    removeStoredToken(storageKey);
    lastLocalSyncKeyRef.current = null;
    setToken(null);
    setUser(null);
    setComputers([]);
    setHasLoadedMachines(false);
    setSelectedComputerId(null);
    setAccessSession(null);
    setIsRemoteMachineCreateVisible(false);
    setLocalMachineStatus(null);
    setLocalMachinePreview(null);
    setLocalMachineRegistrationError(null);
    setIsAddingLocalMachine(false);
    setAuthState("unauthenticated");
  }, [storageKey]);

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
    if (
      authState !== "authenticated" ||
      !computers.some((computer) => isTransitionalStatus(computer.status))
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshMachines();
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [authState, computers, refreshMachines]);

  useEffect(() => {
    setSelectedComputerId(initialComputerId ?? null);
    setAccessSession(null);
    setWorkspaceError(null);
  }, [initialComputerId]);

  useEffect(() => {
    if (authState !== "authenticated" || token === null || selectedComputerId === null) {
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

    let isCurrent = true;
    setIsLoadingWorkspace(true);
    setWorkspaceError(null);
    setAccessSession(null);

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
  }, [authState, clearSession, client, localWorkspaceUrls, selectedComputer, selectedComputerId, token]);

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
    setAccessSession(null);
    setWorkspaceError(null);

    if (machineRouteBasePath !== undefined) {
      const nextPath = joinRoute(machineRouteBasePath, computer.id);
      window.history.pushState(null, "", nextPath);
    }
  };

  const closeMachine = (): void => {
    setSelectedComputerId(null);
    setAccessSession(null);
    setWorkspaceError(null);

    if (machineRouteBasePath !== undefined) {
      window.history.pushState(null, "", machineRouteBasePath);
    }
  };

  const startRemoteMachineCreate = (): void => {
    setMachinesError(null);
    setIsRemoteMachineCreateVisible(true);
  };

  const closeRemoteMachineCreate = (): void => {
    setMachinesError(null);
    setIsRemoteMachineCreateVisible(false);
  };

  if (authState === "checking") {
    return (
      <main className="cloud-shell">
        <div className="cloud-loading" role="status" aria-label="Loading" />
      </main>
    );
  }

  if (authState === "unauthenticated" || user === null) {
    return (
      <LoginScreen
        error={loginError}
        isSubmitting={isLoggingIn}
        onSuccessComplete={completeLogin}
        onSubmit={login}
      />
    );
  }

  if (isPreparingLocalMachineGate) {
    return (
      <main className="cloud-shell">
        <div className="cloud-loading" role="status" aria-label="Loading" />
      </main>
    );
  }

  if (shouldShowLocalMachineOnboarding && localMachinePreview !== null) {
    return (
      <LocalMachineOnboardingScreen
        error={localMachineRegistrationError}
        hasExistingMachines={computers.length > 0}
        isSubmitting={isAddingLocalMachine}
        machineName={localMachinePreview.name}
        onAddMachine={addLocalMachine}
        onLogout={logout}
      />
    );
  }

  if (isRemoteMachineCreateVisible) {
    return (
      <RemoteMachineCreateScreen
        error={machinesError}
        isSubmitting={isCreatingMachine}
        onBack={closeRemoteMachineCreate}
        onCreateMachine={createMachine}
        onLogout={logout}
      />
    );
  }

  if (selectedComputerId !== null) {
    if (selectedComputer !== null && localWorkspaceUrls !== null) {
      return (
        <MachineWorkspace
          agentWebsocketUrl={localWorkspaceUrls.agentWebSocketUrl}
          computer={selectedComputer}
          filesystemWebsocketUrl={localWorkspaceUrls.filesystemWebSocketUrl}
          onBack={closeMachine}
        />
      );
    }

    if (selectedComputer === null || accessSession === null) {
      return (
        <main className="cloud-shell">
          <div className="cloud-workspace-state">
            <button className="cloud-text-button" type="button" onClick={closeMachine}>Machines</button>
            <p>
              {workspaceError ?? (isLoadingWorkspace ? "Opening machine..." : "Machine not found.")}
            </p>
          </div>
        </main>
      );
    }

    return (
      <MachineWorkspace
        agentWebsocketUrl={buildGatewayWebsocketUrl({
          baseUrl: client.baseUrl,
          path: accessSession.routes.agentWebSocketUrl,
          token: accessSession.accessSession.token,
        })}
        computer={selectedComputer}
        filesystemWebsocketUrl={buildGatewayWebsocketUrl({
          baseUrl: client.baseUrl,
          path: accessSession.routes.filesystemWebSocketUrl,
          token: accessSession.accessSession.token,
        })}
        onBack={closeMachine}
      />
    );
  }

  return (
    <MyMachinesScreen
      activeLocalComputerId={activeLocalComputerId}
      computers={computers}
      error={machinesError ?? localMachineRegistrationError}
      isCreatingMachine={isCreatingMachine}
      isLoading={isLoadingMachines}
      onOpenMachine={openMachine}
      onLogout={logout}
      onRefresh={refreshMachines}
      onStartCreateMachine={startRemoteMachineCreate}
      user={user}
    />
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

const isAuthFailure = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  (error as { readonly status?: unknown }).status === 401;

const isTransitionalStatus = (status: string): boolean =>
  status === "creating" || status === "starting";

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

const getLocalWorkspaceUrls = (
  computer: CloudComputer | null,
  status: LocalMachineBridgeStatus | null,
): { readonly filesystemWebSocketUrl: string; readonly agentWebSocketUrl: string } | null => {
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

const joinRoute = (basePath: string, computerId: string): string => {
  const normalizedBasePath = basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  return `${normalizedBasePath}/${encodeURIComponent(computerId)}`;
};
