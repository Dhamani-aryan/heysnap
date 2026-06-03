import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { useAuth } from '@/hooks/auth/use-auth';
import { useAgentConnection } from '@/hooks/agent/use-agent-connection';
import { useFilesystemConnection } from '@/hooks/filesystem/use-filesystem-connection';
import { env } from '@/lib/env';
import type {
  AccessSessionResponse,
  CloudComputer,
  CloudComputerStatus,
} from '@/lib/machines/machines-api';
import {
  accessSessionQueryOptions,
  machinesQueryOptions,
} from '@/lib/machines/machines-query';
import { useStartComputerMutation } from '@/lib/machines/machines-mutations';
import type { FilesystemConnectionManager } from '@/lib/filesystem/filesystem-connection-manager';
import type {
  FilesystemConnectionStatus,
  FilesystemEntry,
  FilesystemListing,
  FilesystemViewState,
} from '@/lib/filesystem/types';
import {
  buildGatewayHttpUrl,
  buildGatewayWebsocketUrl,
  normalizeGatewayConnectionIdentity,
} from '@/lib/gateway-url';
import { useAgentChatStore } from '@/stores/agent/agent-chat-store';
import { useFilesystemStore } from '@/stores/filesystem/filesystem-store';

type MobileMachineWorkspaceProviderProps = {
  children: ReactNode;
  computerId: string;
};

type MobileMachineWorkspaceSessionState = {
  readonly accessSession: AccessSessionResponse | null;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly startupPhase: 'checking' | 'starting' | null;
};

type MobileMachineWorkspaceContextValue = {
  agentBaseUrl: string | null;
  agentIdentity: string | null;
  browserConnected: boolean;
  browserViewSubscribeWebSocketUrl: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  computer: CloudComputer | null;
  connectionStatus: FilesystemConnectionStatus;
  currentDirectoryName: string;
  currentPath: string;
  error: string | null;
  filesystemClient: FilesystemConnectionManager | null;
  filesystemPreviewBaseUrl: string | null;
  filesystemWebsocketUrl: string | null;
  goBack: () => void;
  goForward: () => void;
  isLoading: boolean;
  listing: FilesystemListing | null;
  navigateTo: (path: string) => void;
  openFile: (path: string) => void;
  openFileEntry: FilesystemEntry | null;
  openFilePath: string | null;
  refresh: () => Promise<void>;
  selectedAgentThreadId: string | null;
  session: MobileMachineWorkspaceSessionState;
  closeOpenFile: () => void;
  setBrowserConnected: (connected: boolean) => void;
  setSelectedAgentThreadId: Dispatch<SetStateAction<string | null>>;
  setOpenFilePath: (path: string | null) => void;
  viewState: FilesystemViewState | null;
};

const MobileMachineWorkspaceContext =
  createContext<MobileMachineWorkspaceContextValue | null>(null);

const isConnectable = (status: CloudComputerStatus): boolean =>
  status === 'online' || status === 'idle';

const isPendingStartup = (status: CloudComputerStatus): boolean =>
  status === 'creating' || status === 'starting';

const isTerminal = (status: CloudComputerStatus): boolean =>
  status === 'failed' || status === 'offline' || status === 'deleted';

const getMachineUnavailableMessage = (status: CloudComputerStatus): string => {
  if (status === 'failed') return 'Machine failed to start.';
  if (status === 'offline') return 'Machine is offline.';
  if (status === 'deleted') return 'Machine not found.';
  if (status === 'sleeping') return 'Machine is sleeping.';
  return `Machine is ${formatStatusLabel(status).toLowerCase()}.`;
};

const formatStatusLabel = (status: string): string =>
  status
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');

export function MobileMachineWorkspaceProvider({
  children,
  computerId,
}: MobileMachineWorkspaceProviderProps) {
  const auth = useAuth();
  const router = useRouter();
  const machinesQuery = useQuery({
    ...machinesQueryOptions,
    enabled: auth.status === 'authenticated',
  });
  const computer =
    machinesQuery.data?.find((machine) => machine.id === computerId) ?? null;
  const startMutation = useStartComputerMutation();
  const didAutoStartComputerIdRef = useRef<string | null>(null);
  const [browserConnected, setBrowserConnected] = useState(false);
  const [selectedAgentThreadId, setSelectedAgentThreadIdState] = useState<string | null>(null);
  const setSelectedAgentThreadId = useCallback<Dispatch<SetStateAction<string | null>>>(
    (nextThreadId) => {
      setSelectedAgentThreadIdState(nextThreadId);
    },
    [],
  );

  const canFetchAccessSession =
    auth.status === 'authenticated' && computer !== null && isConnectable(computer.status);
  const accessQuery = useQuery({
    ...accessSessionQueryOptions(computerId),
    enabled: canFetchAccessSession,
  });

  useEffect(() => {
    didAutoStartComputerIdRef.current = null;
    setBrowserConnected(false);
    setSelectedAgentThreadId(null);
  }, [computerId, setSelectedAgentThreadId]);

  useEffect(() => {
    useAgentChatStore.getState().setSelectedThreadId(selectedAgentThreadId);
  }, [selectedAgentThreadId]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    if (computer === null) return;
    if (computer.kind === 'local') return;
    if (computer.status !== 'sleeping') return;
    if (didAutoStartComputerIdRef.current === computerId) return;
    if (startMutation.isPending || startMutation.isError) return;
    didAutoStartComputerIdRef.current = computerId;
    startMutation.mutate(computerId);
  }, [auth.status, computer, computerId, startMutation]);

  const shouldRedirectToMachines =
    auth.status === 'authenticated' &&
    ((machinesQuery.data !== undefined && computer === null) ||
      (computer !== null && isTerminal(computer.status)) ||
      (startMutation.isError && startMutation.variables === computerId) ||
      accessQuery.isError);

  useEffect(() => {
    if (shouldRedirectToMachines) {
      router.replace('/machines');
    }
  }, [router, shouldRedirectToMachines]);

  const accessSession = useMemo(() => {
    if (!canFetchAccessSession) return null;
    return isAccessSessionUsable(accessQuery.data, computerId)
      ? accessQuery.data
      : null;
  }, [accessQuery.data, canFetchAccessSession, computerId]);

  const session = useMemo<MobileMachineWorkspaceSessionState>(() => {
    if (auth.status !== 'authenticated') {
      return {
        accessSession: null,
        error: null,
        isLoading: false,
        startupPhase: null,
      };
    }

    if (machinesQuery.data === undefined) {
      return {
        accessSession: null,
        error: getErrorMessage(machinesQuery.error),
        isLoading: machinesQuery.isFetching,
        startupPhase: 'checking',
      };
    }

    if (computer === null) {
      return {
        accessSession: null,
        error: 'Machine not found.',
        isLoading: false,
        startupPhase: null,
      };
    }

    if (
      computer.kind !== 'local' &&
      (computer.status === 'sleeping' || isPendingStartup(computer.status))
    ) {
      const startError =
        startMutation.isError && startMutation.variables === computerId
          ? getErrorMessage(startMutation.error) ?? 'Failed to start machine.'
          : null;

      if (startError !== null) {
        return {
          accessSession: null,
          error: startError,
          isLoading: false,
          startupPhase: null,
        };
      }

      return {
        accessSession: null,
        error: null,
        isLoading: true,
        startupPhase: 'starting',
      };
    }

    if (isTerminal(computer.status)) {
      return {
        accessSession: null,
        error: getMachineUnavailableMessage(computer.status),
        isLoading: false,
        startupPhase: null,
      };
    }

    if (!isConnectable(computer.status)) {
      return {
        accessSession: null,
        error: getMachineUnavailableMessage(computer.status),
        isLoading: false,
        startupPhase: null,
      };
    }

    return {
      accessSession,
      error: getErrorMessage(accessQuery.error),
      isLoading: accessQuery.isFetching && accessSession === null,
      startupPhase: null,
    };
  }, [
    accessQuery.error,
    accessQuery.isFetching,
    accessSession,
    auth.status,
    computer,
    computerId,
    machinesQuery.data,
    machinesQuery.error,
    machinesQuery.isFetching,
    startMutation.error,
    startMutation.isError,
    startMutation.variables,
  ]);

  const filesystemWebsocketUrl = useMemo(() => {
    if (session.accessSession === null) return null;

    return buildGatewayWebsocketUrl({
      baseUrl: env.cloudServerUrl,
      path: session.accessSession.routes.filesystemWebSocketUrl,
      token: session.accessSession.accessSession.token,
    });
  }, [session.accessSession]);

  const filesystemPreviewBaseUrl = useMemo(() => {
    if (session.accessSession?.routes.filesystemPreviewBaseUrl === undefined) {
      return null;
    }

    return buildGatewayHttpUrl({
      baseUrl: env.cloudServerUrl,
      path: session.accessSession.routes.filesystemPreviewBaseUrl,
      token: session.accessSession.accessSession.token,
    });
  }, [session.accessSession]);

  const agentBaseUrl = useMemo(() => {
    if (session.accessSession === null) return null;

    return buildGatewayHttpUrl({
      baseUrl: env.cloudServerUrl,
      path: session.accessSession.routes.agentBaseUrl,
      token: session.accessSession.accessSession.token,
    });
  }, [session.accessSession]);

  const agentIdentity = useMemo(
    () =>
      agentBaseUrl === null ? null : normalizeGatewayConnectionIdentity(agentBaseUrl),
    [agentBaseUrl],
  );

  const browserViewSubscribeWebSocketUrl = useMemo(() => {
    if (session.accessSession?.routes.browserViewSubscribeWebSocketUrl === undefined) {
      return null;
    }

    return buildGatewayWebsocketUrl({
      baseUrl: env.cloudServerUrl,
      path: session.accessSession.routes.browserViewSubscribeWebSocketUrl,
      token: session.accessSession.accessSession.token,
    });
  }, [session.accessSession]);

  useAgentConnection({ agentBaseUrl, agentIdentity });

  const filesystemConnectionIdentity = useMemo(
    () =>
      filesystemWebsocketUrl === null
        ? null
        : normalizeGatewayConnectionIdentity(filesystemWebsocketUrl),
    [filesystemWebsocketUrl],
  );

  const filesystemClient = useFilesystemConnection({
    wsUrl: filesystemWebsocketUrl,
    previewBaseUrl: filesystemPreviewBaseUrl ?? undefined,
    connectionIdentity: filesystemConnectionIdentity,
    workspaceIdentity: computerId,
  });

  const connectionStatus = useFilesystemStore((state) => state.connectionStatus);
  const currentPath = useFilesystemStore((state) => state.currentPath);
  const listing = useFilesystemStore((state) => state.listing);
  const isFilesystemFetching = useFilesystemStore((state) => state.isFetching);
  const filesystemError = useFilesystemStore((state) => state.listingError);
  const history = useFilesystemStore((state) => state.history);
  const historyIndex = useFilesystemStore((state) => state.historyIndex);
  const openFileEntry = useFilesystemStore((state) => state.openFileEntry);
  const navigate = useFilesystemStore((state) => state.navigate);
  const goBackAction = useFilesystemStore((state) => state.goBack);
  const goForwardAction = useFilesystemStore((state) => state.goForward);
  const refreshFilesystem = useFilesystemStore((state) => state.refresh);
  const openWorkspacePath = useFilesystemStore((state) => state.openWorkspacePath);
  const closeOpenFile = useFilesystemStore((state) => state.closeOpenFile);

  const currentDirectoryName = listing?.name ?? getDirectoryName(currentPath);
  const openFilePath = openFileEntry?.path ?? null;
  const viewState = useMemo<FilesystemViewState | null>(() => {
    if (!listing && openFileEntry === null) return null;
    return {
      currentPath,
      openFiles: openFileEntry === null ? [] : [openFileEntry],
    };
  }, [currentPath, listing, openFileEntry]);

  const navigateTo = useCallback(
    (path: string): void => {
      void navigate(path);
    },
    [navigate],
  );

  const openFile = useCallback(
    (path: string): void => {
      void openWorkspacePath(path);
    },
    [openWorkspacePath],
  );

  const goBack = useCallback((): void => {
    void goBackAction();
  }, [goBackAction]);

  const goForward = useCallback((): void => {
    void goForwardAction();
  }, [goForwardAction]);

  const setOpenFilePath = useCallback(
    (path: string | null): void => {
      if (path === null) {
        closeOpenFile();
        return;
      }

      void openWorkspacePath(path);
    },
    [closeOpenFile, openWorkspacePath],
  );

  const refresh = useCallback(async (): Promise<void> => {
    await machinesQuery.refetch();
    await refreshFilesystem();
  }, [machinesQuery, refreshFilesystem]);

  const value = useMemo<MobileMachineWorkspaceContextValue>(() => ({
    agentBaseUrl,
    agentIdentity,
    browserConnected,
    browserViewSubscribeWebSocketUrl,
    canGoBack: historyIndex > 0,
    canGoForward: historyIndex >= 0 && historyIndex < history.length - 1,
    computer,
    connectionStatus,
    currentDirectoryName,
    currentPath,
    error: filesystemError ?? session.error,
    filesystemClient,
    filesystemPreviewBaseUrl,
    filesystemWebsocketUrl,
    goBack,
    goForward,
    isLoading: session.isLoading || isFilesystemFetching,
    listing,
    navigateTo,
    openFile,
    openFileEntry,
    openFilePath,
    refresh,
    selectedAgentThreadId,
    session,
    closeOpenFile,
    setBrowserConnected,
    setSelectedAgentThreadId,
    setOpenFilePath,
    viewState,
  }), [
    agentBaseUrl,
    agentIdentity,
    browserConnected,
    browserViewSubscribeWebSocketUrl,
    closeOpenFile,
    computer,
    connectionStatus,
    currentDirectoryName,
    currentPath,
    filesystemClient,
    filesystemError,
    filesystemPreviewBaseUrl,
    filesystemWebsocketUrl,
    goBack,
    goForward,
    history.length,
    historyIndex,
    isFilesystemFetching,
    listing,
    navigateTo,
    openFile,
    openFileEntry,
    openFilePath,
    refresh,
    selectedAgentThreadId,
    session,
    setSelectedAgentThreadId,
    setOpenFilePath,
    viewState,
  ]);

  return (
    <MobileMachineWorkspaceContext.Provider value={value}>
      {children}
    </MobileMachineWorkspaceContext.Provider>
  );
}

export function useMobileMachineWorkspace() {
  const value = useContext(MobileMachineWorkspaceContext);

  if (value === null) {
    throw new Error('useMobileMachineWorkspace must be used inside MobileMachineWorkspaceProvider.');
  }

  return value;
}

function isAccessSessionUsable(
  response: AccessSessionResponse | undefined,
  computerId: string,
): response is AccessSessionResponse {
  if (response === undefined || response.accessSession.computerId !== computerId) {
    return false;
  }

  const expiresAt = Date.parse(response.accessSession.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt - Date.now() > 60_000;
}

function getDirectoryName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? 'workspace';
}

function getErrorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  return error instanceof Error ? error.message : 'Something went wrong.';
}
