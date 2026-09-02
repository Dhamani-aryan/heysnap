import { useEffect, useRef, useState } from 'react';
import { FilesystemConnectionManager } from '@/lib/filesystem/filesystem-connection-manager';
import {
  FILESYSTEM_HISTORY_LIMIT,
  getActiveFilesystemManager,
  setActiveFilesystemManager,
  useFilesystemStore,
} from '@/stores/filesystem/filesystem-store';
import { writePersistedFilesystemWorkspaceState } from '@/stores/filesystem/filesystem-persistence';

type Options = {
  wsUrl: string | null | undefined;
  previewBaseUrl?: string;
  connectionIdentity: string | null | undefined;
  workspaceIdentity: string;
};

export function useFilesystemConnection({
  wsUrl,
  previewBaseUrl,
  connectionIdentity,
  workspaceIdentity,
}: Options): FilesystemConnectionManager | null {
  const latestUrlsRef = useRef({ wsUrl, previewBaseUrl });
  const [currentManager, setCurrentManager] =
    useState<FilesystemConnectionManager | null>(null);

  useEffect(() => {
    latestUrlsRef.current = { wsUrl, previewBaseUrl };
  }, [previewBaseUrl, wsUrl]);

  useEffect(() => {
    useFilesystemStore.getState().hydrateWorkspace({ workspaceIdentity });
  }, [workspaceIdentity]);

  useEffect(() => {
    const storage = getLocalStorage();
    if (storage === null) return;

    const persistState = (): void => {
      const state = useFilesystemStore.getState();
      if (
        state.workspaceIdentity !== workspaceIdentity ||
        !state.hasHydratedWorkspace
      ) {
        return;
      }

      writePersistedFilesystemWorkspaceState(
        storage,
        workspaceIdentity,
        {
          currentPath: state.currentPath,
          history: state.history,
          historyIndex: state.historyIndex,
          openFileEntry: state.openFileEntry,
          activeSurface: state.activeSurface,
        },
        FILESYSTEM_HISTORY_LIMIT,
      );
    };

    persistState();
    return useFilesystemStore.subscribe(persistState);
  }, [workspaceIdentity]);

  useEffect(() => {
    const manager = getActiveFilesystemManager();
    if (!manager || !wsUrl) return;
    manager.setUrls({ url: wsUrl, previewBaseUrl });
  }, [previewBaseUrl, wsUrl]);

  useEffect(() => {
    const latestUrls = latestUrlsRef.current;
    if (!latestUrls.wsUrl || !connectionIdentity) {
      useFilesystemStore.setState({
        connectionStatus: 'closed',
        isFetching: false,
      });
      setCurrentManager(null);
      return;
    }

    const manager = new FilesystemConnectionManager({
      url: latestUrls.wsUrl,
      initialPath: useFilesystemStore.getState().currentPath,
      previewBaseUrl: latestUrls.previewBaseUrl,
      callbacks: {
        onMessage: (message) => {
          useFilesystemStore.getState().ingestServerMessage(message);
        },
        onStatusChange: (status) => {
          useFilesystemStore.getState().setConnectionStatus(status);
        },
      },
    });

    setActiveFilesystemManager(manager);
    setCurrentManager(manager);
    useFilesystemStore.setState({ isFetching: true, listingError: null });
    manager.connect();

    return () => {
      manager.disconnect();
      if (getActiveFilesystemManager() === manager) {
        setActiveFilesystemManager(null);
      }
      setCurrentManager((current) => (current === manager ? null : current));
    };
  }, [connectionIdentity]);

  return currentManager;
}

function getLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof globalThis === 'undefined') return null;
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  return storage ?? null;
}
