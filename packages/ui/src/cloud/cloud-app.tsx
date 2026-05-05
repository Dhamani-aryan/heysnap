"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CloudClient,
  type CloudComputer,
  type CloudUser,
  type ComputerAccessSessionResponse,
} from "./cloud-client";
import { LoginScreen } from "./login-screen";
import { MachineWorkspace } from "./machine-workspace";
import { MyMachinesScreen } from "./my-machines-screen";

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
  syncCloudSession(input: {
    readonly cloudServerUrl: string;
    readonly sessionToken: string;
  }): Promise<LocalMachineBridgeStatus>;
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
  includeLocalMachine: _includeLocalMachine = false,
  initialComputerId,
  localMachineBridge,
  machineRouteBasePath,
  storageKey = DEFAULT_STORAGE_KEY,
}: CloudAppProps): React.ReactElement {
  const client = useMemo(() => new CloudClient(cloudServerUrl), [cloudServerUrl]);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<CloudUser | null>(null);
  const [computers, setComputers] = useState<CloudComputer[]>([]);
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
  const [localMachineStatus, setLocalMachineStatus] = useState<LocalMachineBridgeStatus | null>(null);
  const selectedComputer = selectedComputerId === null
    ? null
    : computers.find((computer) => computer.id === selectedComputerId) ?? null;
  const localWorkspaceUrls = getLocalWorkspaceUrls(selectedComputer, localMachineStatus);
  const activeLocalComputerId = localMachineStatus?.server.state === "running"
    ? localMachineStatus.cloud.computer?.id ?? null
    : null;

  const clearSession = useCallback(() => {
    removeStoredToken(storageKey);
    setToken(null);
    setUser(null);
    setComputers([]);
    setSelectedComputerId(null);
    setAccessSession(null);
    setLocalMachineStatus(null);
    setAuthState("unauthenticated");
  }, [storageKey]);

  const refreshMachines = useCallback(async () => {
    if (token === null) {
      return;
    }

    setIsLoadingMachines(true);
    setMachinesError(null);

    try {
      const response = await client.listComputers(token);
      setComputers(response.computers);
    } catch (error) {
      if (isAuthFailure(error)) {
        clearSession();
        return;
      }

      setMachinesError(error instanceof Error ? error.message : "Failed to load machines.");
    } finally {
      setIsLoadingMachines(false);
    }
  }, [clearSession, client, token]);

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
    if (authState !== "authenticated" || token === null || localMachineBridge === undefined) {
      return;
    }

    let isCurrent = true;

    void localMachineBridge.getStatus()
      .then((status) => {
        if (isCurrent) {
          setLocalMachineStatus(status);
        }
      })
      .catch(() => {
        // The sync call below will surface the useful error if the bridge is unavailable.
      });

    void localMachineBridge.syncCloudSession({
      cloudServerUrl: client.baseUrl,
      sessionToken: token,
    })
      .then((status) => {
        if (!isCurrent) {
          return;
        }

        setLocalMachineStatus(status);
        void refreshMachines();
      })
      .catch((error) => {
        if (!isCurrent) {
          return;
        }

        setMachinesError(error instanceof Error ? error.message : "Failed to sync local machine.");
      });

    return () => {
      isCurrent = false;
    };
  }, [authState, client.baseUrl, localMachineBridge, refreshMachines, token]);

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

  const login = async (input: { readonly email: string; readonly password: string }): Promise<void> => {
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const response = await client.login(input);
      writeStoredToken(storageKey, response.session.token);
      setToken(response.session.token);
      setUser(response.user);
      setAuthState("authenticated");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setIsLoggingIn(false);
    }
  };

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
      setComputers((currentComputers) => [
        response.computer,
        ...currentComputers.filter((computer) => computer.id !== response.computer.id),
      ]);
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

  const openMachine = (computer: CloudComputer): void => {
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

  if (authState === "checking") {
    return (
      <main className="cloud-shell">
        <div className="cloud-loading" role="status">Loading...</div>
      </main>
    );
  }

  if (authState === "unauthenticated" || user === null) {
    return (
      <LoginScreen
        error={loginError}
        isSubmitting={isLoggingIn}
        onSubmit={login}
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
      error={machinesError}
      isCreatingMachine={isCreatingMachine}
      isLoading={isLoadingMachines}
      onCreateMachine={createMachine}
      onOpenMachine={openMachine}
      onLogout={logout}
      onRefresh={refreshMachines}
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

const joinRoute = (basePath: string, computerId: string): string => {
  const normalizedBasePath = basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  return `${normalizedBasePath}/${encodeURIComponent(computerId)}`;
};
