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
import { AgentRuntimeProvider } from '@ank1015-app/ui/agent-hooks';
import { FilesystemClient, type FilesystemConnectionStatus } from '@ank1015-app/ui/filesystem-client';
import type {
  FilesystemEntry,
  FilesystemListing,
  FilesystemViewState,
} from '@ank1015-app/ui/filesystem-types';
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
  session: MachineWorkspaceSessionState;
  closeOpenFile: () => void;
  setSelectedAgentThreadId: Dispatch<SetStateAction<string | null>>;
  setOpenFilePath: (path: string | null) => void;
  viewState: FilesystemViewState | null;
};

const MobileMachineWorkspaceContext = createContext<MobileMachineWorkspaceContextValue | null>(null);
const HISTORY_LIMIT = 64;
const isFilesystemConnectionErrorMessage = (message: string): boolean =>
  message === 'Filesystem connection failed.' ||
  message === 'Filesystem connection closed.' ||
  message === 'Filesystem connection is not open.';

const toFilesystemErrorMessage = (message: string | null): string | null => {
  if (message === null || isFilesystemConnectionErrorMessage(message)) {
    return null;
  }

  return message;
};

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
  const [openFileEntry, setOpenFileEntry] = useState<FilesystemEntry | null>(null);
  const [selectedAgentThreadId, setSelectedAgentThreadId] = useState<string | null>(null);
  const openFileRequestRef = useRef(0);

  const currentPath = listing?.path ?? '';
  const currentDirectoryName = listing?.name ?? 'workspace';
  const openFilePath = openFileEntry?.path ?? null;

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

  const filesystemPreviewBaseUrl = useMemo(() => {
    if (session.accessSession?.routes.filesystemPreviewBaseUrl === undefined) {
      return null;
    }

    return buildGatewayHttpUrl({
      baseUrl: client.baseUrl,
      path: session.accessSession.routes.filesystemPreviewBaseUrl,
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
    setSelectedAgentThreadId(null);
  }, [computerId]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || filesystemWebsocketUrl === null) {
      setFilesystemClient(null);
      setConnectionStatus('closed');
      setListing(null);
      setViewState(null);
      setIsFilesystemLoading(false);
      setHistory([]);
      setHistoryIndex(-1);
      setOpenFileEntry(null);
      return;
    }

    setConnectionStatus('connecting');
    setListing(null);
    setViewState(null);
    setFilesystemError(null);
    setHistory([]);
    setHistoryIndex(-1);
    setOpenFileEntry(null);

    let hasReceivedListing = false;
    const nextClient = new FilesystemClient(filesystemWebsocketUrl, {
      initialPath: '',
      onConnectionStatus: setConnectionStatus,
      onError: (message) => {
        setFilesystemError(toFilesystemErrorMessage(message));
      },
      onFileUpdates: ({ entries: updatedEntries }) => {
        if (updatedEntries.length === 0) {
          return;
        }

        const updatedEntriesByPath = new Map(
          updatedEntries.map((entry) => [entry.path, entry]),
        );

        setOpenFileEntry((currentEntry) => {
          if (currentEntry === null) {
            return null;
          }

          const updatedEntry = updatedEntriesByPath.get(currentEntry.path);
          if (updatedEntry !== undefined) {
            return updatedEntry.type === 'file' ? updatedEntry : null;
          }

          return currentEntry;
        });

        setListing((currentListing) => {
          if (currentListing === null) {
            return currentListing;
          }

          let didChange = false;
          const nextEntries = currentListing.entries.map((entry) => {
            const updatedEntry = updatedEntriesByPath.get(entry.path);

            if (updatedEntry === undefined) {
              return entry;
            }

            didChange = true;
            return updatedEntry;
          });

          return didChange ? { ...currentListing, entries: nextEntries } : currentListing;
        });
      },
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

  useEffect(() => {
    const paths = openFilePath === null ? [] : [openFilePath];

    void filesystemClient?.watchFiles(paths).catch((error) => {
      setFilesystemError(toFilesystemErrorMessage(
        error instanceof Error ? error.message : 'Failed to watch open file.',
      ));
    });
  }, [filesystemClient, openFilePath]);

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

  const closeOpenFile = useCallback((): void => {
    openFileRequestRef.current += 1;
    setOpenFileEntry(null);
  }, []);

  const openFile = useCallback((path: string): void => {
    const normalizedPath = normalizeOpenFilePath(path);
    const requestId = openFileRequestRef.current + 1;
    openFileRequestRef.current = requestId;
    setOpenFileEntry(null);

    if (normalizedPath === null) {
      return;
    }

    const commitOpenFileEntry = (entry: FilesystemEntry): void => {
      setTimeout(() => {
        if (openFileRequestRef.current === requestId) {
          setOpenFileEntry(entry);
        }
      }, 0);
    };

    const openResolvedEntry = (entry: FilesystemEntry): void => {
      if (entry.type === 'directory') {
        navigateTo(entry.path);
        return;
      }

      commitOpenFileEntry(entry);
    };

    if (normalizedPath.length === 0) {
      navigateTo('');
      return;
    }

    const visibleEntry = listing?.entries.find((entry) => entry.path === normalizedPath);
    if (visibleEntry !== undefined) {
      openResolvedEntry(visibleEntry);
      return;
    }

    const parentPath = getParentPath(normalizedPath);
    void (async () => {
      const parentListing =
        listing?.path === parentPath
          ? listing
          : await subscribeTo(parentPath, true);
      const targetEntry = parentListing?.entries.find((entry) => entry.path === normalizedPath);

      if (targetEntry !== undefined) {
        openResolvedEntry(targetEntry);
        return;
      }

      commitOpenFileEntry(createUnknownFileEntry(normalizedPath));
    })().catch((error) => {
      if (openFileRequestRef.current === requestId) {
        setFilesystemError(error instanceof Error ? error.message : 'Failed to open file.');
      }
    });
  }, [listing, navigateTo, subscribeTo]);

  const setOpenFilePath = useCallback((path: string | null): void => {
    if (path === null) {
      closeOpenFile();
      return;
    }

    openFile(path);
  }, [closeOpenFile, openFile]);

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
    filesystemPreviewBaseUrl,
    filesystemWebsocketUrl,
    goBack,
    goForward,
    isLoading: machinesIsFetching || session.isLoading || isFilesystemLoading,
    listing,
    navigateTo,
    openFile,
    openFileEntry,
    openFilePath,
    refresh: async () => {
      await machinesRefetch();
      await filesystemClient?.subscribe('');
    },
    selectedAgentThreadId,
    session,
    closeOpenFile,
    setSelectedAgentThreadId,
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
    filesystemPreviewBaseUrl,
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
    openFile,
    openFileEntry,
    openFilePath,
    selectedAgentThreadId,
    session,
    closeOpenFile,
    setOpenFilePath,
    viewState,
  ]);

  const contextContent = (
    <MobileMachineWorkspaceContext.Provider value={value}>
      {children}
    </MobileMachineWorkspaceContext.Provider>
  );

  if (agentBaseUrl === null) {
    return contextContent;
  }

  return (
    <AgentRuntimeProvider key={computerId} agentBaseUrl={agentBaseUrl}>
      {contextContent}
    </AgentRuntimeProvider>
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

const normalizeOpenFilePath = (path: string): string | null => {
  const parts: string[] = [];

  for (const part of path.trim().replaceAll('\\', '/').split('/')) {
    if (part.length === 0 || part === '.') {
      continue;
    }

    if (part === '..') {
      if (parts.length === 0) {
        return null;
      }

      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return parts.join('/');
};

const getParentPath = (path: string): string => {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  segments.pop();
  return segments.join('/');
};

const createUnknownFileEntry = (path: string): FilesystemEntry => ({
  name: path.split('/').filter(Boolean).at(-1) ?? path,
  path,
  type: 'file',
  size: null,
  updatedAt: new Date().toISOString(),
  isHidden: false,
  isSymlink: false,
});
