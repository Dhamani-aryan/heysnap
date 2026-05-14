import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FilesystemClient, type FilesystemConnectionStatus } from '@ank1015-app/ui/filesystem-client';
import type { FilesystemListing, FilesystemViewState } from '@ank1015-app/ui/filesystem-types';
import {
  useCloudAuthStore,
  useCloudMachinesStore,
  useCloudRuntime,
  useMachineWorkspaceSession,
  useMachinesQuery,
  type CloudComputer,
  type MachineWorkspaceSessionState,
} from '@ank1015-app/ui/cloud-hooks';

type MobileMachineWorkspaceProviderProps = {
  children: ReactNode;
  computerId: string;
};

type MobileMachineWorkspaceContextValue = {
  agentBaseUrl: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  computer: CloudComputer | null;
  connectionStatus: FilesystemConnectionStatus;
  currentDirectoryName: string;
  currentPath: string;
  error: string | null;
  filesystemClient: FilesystemClient | null;
  filesystemWebsocketUrl: string | null;
  goBack: () => void;
  goForward: () => void;
  isLoading: boolean;
  listing: FilesystemListing | null;
  navigateTo: (path: string) => void;
  openFilePath: string | null;
  refresh: () => Promise<void>;
  session: MachineWorkspaceSessionState;
  setOpenFilePath: (path: string | null) => void;
  viewState: FilesystemViewState | null;
};

const MobileMachineWorkspaceContext = createContext<MobileMachineWorkspaceContextValue | null>(null);
const HISTORY_LIMIT = 64;

export function MobileMachineWorkspaceProvider({
  children,
  computerId,
}: MobileMachineWorkspaceProviderProps) {
  const { client } = useCloudRuntime();
  const authStatus = useCloudAuthStore((state) => state.status);
  const computer = useCloudMachinesStore((state) => state.computersById[computerId] ?? null);
  const machinesQuery = useMachinesQuery();
  const machinesIsFetching = machinesQuery.isFetching;
  const machinesRefetch = machinesQuery.refetch;
  const session = useMachineWorkspaceSession(computerId);
  const [filesystemClient, setFilesystemClient] = useState<FilesystemClient | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<FilesystemConnectionStatus>('connecting');
  const [listing, setListing] = useState<FilesystemListing | null>(null);
  const [viewState, setViewState] = useState<FilesystemViewState | null>(null);
  const [isFilesystemLoading, setIsFilesystemLoading] = useState(false);
  const [filesystemError, setFilesystemError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);

  const currentPath = listing?.path ?? '';
  const currentDirectoryName = listing?.name ?? 'workspace';

  const filesystemWebsocketUrl = useMemo(() => {
    if (session.accessSession === null) {
      return null;
    }

    return buildGatewayWebsocketUrl({
      baseUrl: client.baseUrl,
      path: session.accessSession.routes.filesystemWebSocketUrl,
      token: session.accessSession.accessSession.token,
    });
  }, [client.baseUrl, session.accessSession]);

  const agentBaseUrl = useMemo(() => {
    if (session.accessSession === null) {
      return null;
    }

    return buildGatewayHttpUrl({
      baseUrl: client.baseUrl,
      path: session.accessSession.routes.agentBaseUrl,
      token: session.accessSession.accessSession.token,
    });
  }, [client.baseUrl, session.accessSession]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || filesystemWebsocketUrl === null) {
      setFilesystemClient(null);
      setConnectionStatus('closed');
      setListing(null);
      setViewState(null);
      setIsFilesystemLoading(false);
      setHistory([]);
      setHistoryIndex(-1);
      return;
    }

    setConnectionStatus('connecting');
    setListing(null);
    setViewState(null);
    setFilesystemError(null);
    setHistory([]);
    setHistoryIndex(-1);

    let hasReceivedListing = false;
    const nextClient = new FilesystemClient(filesystemWebsocketUrl, {
      initialPath: '',
      onConnectionStatus: setConnectionStatus,
      onError: setFilesystemError,
      onListing: (nextListing) => {
        const isInitialListing = !hasReceivedListing;
        hasReceivedListing = true;
        setListing(nextListing);

        if (isInitialListing) {
          const initialHistory = createInitialNavigationHistory(nextListing.path);
          setHistory(initialHistory);
          setHistoryIndex(initialHistory.length - 1);
        }
      },
      onLoading: setIsFilesystemLoading,
      onOpen: () => {
        setConnectionStatus('alive');
      },
      onViewState: setViewState,
    });

    setFilesystemClient(nextClient);
    nextClient.connect();

    return () => {
      nextClient.close();
      setFilesystemClient((currentClient) => (
        currentClient === nextClient ? null : currentClient
      ));
    };
  }, [authStatus, filesystemWebsocketUrl]);

  const subscribeTo = useCallback(async (
    path: string,
    shouldPushHistory: boolean,
  ): Promise<FilesystemListing | undefined> => {
    setFilesystemError(null);
    const nextListing = await filesystemClient?.subscribe(path);

    if (!shouldPushHistory) {
      return nextListing;
    }

    setHistory((previous) => {
      const trimmed =
        historyIndex >= 0
          ? previous.slice(0, historyIndex + 1)
          : listing === null
            ? []
            : [currentPath];

      if (trimmed[trimmed.length - 1] === path) {
        setHistoryIndex(trimmed.length - 1);
        return trimmed;
      }

      const next = [...trimmed, path];
      const overflow = Math.max(0, next.length - HISTORY_LIMIT);
      const bounded = next.slice(overflow);
      setHistoryIndex(bounded.length - 1);

      return bounded;
    });

    return nextListing;
  }, [currentPath, filesystemClient, historyIndex, listing]);

  const navigateTo = useCallback((path: string): void => {
    void subscribeTo(path, true).catch((error) => {
      setFilesystemError(error instanceof Error ? error.message : 'Failed to load folder.');
    });
  }, [subscribeTo]);

  const goBack = useCallback((): void => {
    if (historyIndex <= 0) {
      return;
    }

    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    void subscribeTo(history[nextIndex] ?? '', false).catch((error) => {
      setFilesystemError(error instanceof Error ? error.message : 'Failed to load folder.');
    });
  }, [history, historyIndex, subscribeTo]);

  const goForward = useCallback((): void => {
    if (historyIndex >= history.length - 1) {
      return;
    }

    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    void subscribeTo(history[nextIndex] ?? '', false).catch((error) => {
      setFilesystemError(error instanceof Error ? error.message : 'Failed to load folder.');
    });
  }, [history, historyIndex, subscribeTo]);

  const value = useMemo<MobileMachineWorkspaceContextValue>(() => ({
    agentBaseUrl,
    canGoBack: historyIndex > 0,
    canGoForward: historyIndex >= 0 && historyIndex < history.length - 1,
    computer,
    connectionStatus,
    currentDirectoryName,
    currentPath,
    error: filesystemError ?? session.error,
    filesystemClient,
    filesystemWebsocketUrl,
    goBack,
    goForward,
    isLoading: machinesIsFetching || session.isLoading || isFilesystemLoading,
    listing,
    navigateTo,
    openFilePath,
    refresh: async () => {
      await machinesRefetch();
      await filesystemClient?.subscribe('');
    },
    session,
    setOpenFilePath,
    viewState,
  }), [
    agentBaseUrl,
    computer,
    connectionStatus,
    currentDirectoryName,
    currentPath,
    filesystemClient,
    filesystemError,
    filesystemWebsocketUrl,
    goBack,
    goForward,
    history.length,
    historyIndex,
    isFilesystemLoading,
    listing,
    machinesIsFetching,
    machinesRefetch,
    navigateTo,
    openFilePath,
    session,
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

const buildGatewayWebsocketUrl = (input: {
  readonly baseUrl: string;
  readonly path: string;
  readonly token: string;
}): string => {
  const url = new URL(input.path, input.baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('accessToken', input.token);

  return url.toString();
};

const buildGatewayHttpUrl = (input: {
  readonly baseUrl: string;
  readonly path: string;
  readonly token: string;
}): string => {
  const url = new URL(input.path, input.baseUrl);
  url.searchParams.set('accessToken', input.token);

  return url.toString();
};

const createInitialNavigationHistory = (path: string): string[] => {
  const segments = path.trim().split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return [];
  }

  return [
    '',
    ...segments.map((_, index) => segments.slice(0, index + 1).join('/')),
  ];
};
