import { create } from 'zustand';
import { getParentPath, createInitialNavigationHistory } from '@/lib/filesystem/filesystem-paths';
import type { FilesystemConnectionManager } from '@/lib/filesystem/filesystem-connection-manager';
import type {
  FilesystemConnectionStatus,
  FilesystemEntry,
  FilesystemListing,
  FilesystemServerMessage,
} from '@/lib/filesystem/types';
import {
  readPersistedFilesystemWorkspaceState,
  reconcileFilesystemViewState,
} from './filesystem-persistence';

export const FILESYSTEM_HISTORY_LIMIT = 64;

export type FilesystemSurface = 'directory' | 'file';
export type FilesystemClipboardMode = 'copy' | 'cut';

export type FilesystemClipboard = {
  readonly mode: FilesystemClipboardMode;
  readonly entries: FilesystemEntry[];
};

let activeManager: FilesystemConnectionManager | null = null;

export function setActiveFilesystemManager(
  manager: FilesystemConnectionManager | null,
): void {
  activeManager = manager;
}

export function getActiveFilesystemManager(): FilesystemConnectionManager | null {
  return activeManager;
}

type FilesystemState = {
  workspaceIdentity: string | null;
  hasHydratedWorkspace: boolean;
  connectionStatus: FilesystemConnectionStatus;
  currentPath: string;
  listing: FilesystemListing | null;
  isFetching: boolean;
  listingError: string | null;
  history: string[];
  historyIndex: number;
  openFileEntry: FilesystemEntry | null;
  activeSurface: FilesystemSurface;
  hasHydratedOpenFile: boolean;
  filesystemClipboard: FilesystemClipboard | null;
};

type FilesystemActions = {
  hydrateWorkspace: (input: { readonly workspaceIdentity: string }) => void;
  ingestServerMessage: (message: FilesystemServerMessage) => void;
  setConnectionStatus: (status: FilesystemConnectionStatus) => void;
  navigate: (path: string) => Promise<void>;
  openWorkspacePath: (path: string) => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  refresh: () => Promise<void>;
  openFile: (entry: FilesystemEntry) => void;
  closeOpenFile: () => void;
  showDirectory: () => void;
  setFilesystemClipboard: (
    mode: FilesystemClipboardMode,
    entries: readonly FilesystemEntry[],
  ) => void;
  clearFilesystemClipboard: () => void;
  reset: () => void;
};

const initialState: FilesystemState = {
  workspaceIdentity: null,
  hasHydratedWorkspace: false,
  connectionStatus: 'idle',
  currentPath: '',
  listing: null,
  isFetching: false,
  listingError: null,
  history: [''],
  historyIndex: 0,
  openFileEntry: null,
  activeSurface: 'directory',
  hasHydratedOpenFile: false,
  filesystemClipboard: null,
};

export const useFilesystemStore = create<FilesystemState & FilesystemActions>(
  (set, get) => ({
    ...initialState,

    hydrateWorkspace: ({ workspaceIdentity }) => {
      const current = get();
      if (
        current.workspaceIdentity === workspaceIdentity &&
        current.hasHydratedWorkspace
      ) {
        return;
      }

      const storage = getLocalStorage();
      const persisted =
        storage === null
          ? null
          : readPersistedFilesystemWorkspaceState(
              storage,
              workspaceIdentity,
              FILESYSTEM_HISTORY_LIMIT,
            );

      if (persisted === null) {
        set({
          ...initialState,
          workspaceIdentity,
          hasHydratedWorkspace: true,
        });
        return;
      }

      set({
        ...initialState,
        workspaceIdentity,
        hasHydratedWorkspace: true,
        currentPath: persisted.currentPath,
        history: persisted.history,
        historyIndex: persisted.historyIndex,
        openFileEntry: persisted.openFileEntry,
        activeSurface: persisted.activeSurface,
        hasHydratedOpenFile: true,
      });
    },

    ingestServerMessage: (message) => {
      switch (message.type) {
        case 'snapshot': {
          const { history, historyIndex } = get();
          const nextHistory =
            history.length === 1 &&
            historyIndex === 0 &&
            history[0] === '' &&
            message.listing.path.length > 0
              ? createInitialNavigationHistory(message.listing.path)
              : history;
          set({
            listing: message.listing,
            currentPath: message.listing.path,
            isFetching: false,
            listingError: null,
            history: nextHistory,
            historyIndex:
              nextHistory === history ? historyIndex : nextHistory.length - 1,
          });
          return;
        }
        case 'hello': {
          const viewState = message.viewState;
          const state = get();
          if (viewState !== undefined) {
            const reconciled = reconcileFilesystemViewState({
              currentOpenFileEntry: state.openFileEntry,
              activeSurface: state.activeSurface,
              viewState,
              shouldHydrateFromServer: !state.hasHydratedOpenFile,
            });
            set({
              openFileEntry: reconciled.openFileEntry,
              activeSurface: reconciled.activeSurface,
              hasHydratedOpenFile: true,
            });
            syncOpenFile(reconciled.openFileEntry);
            return;
          }

          set({ hasHydratedOpenFile: true });
          syncOpenFile(state.openFileEntry);
          return;
        }
        case 'error': {
          if (message.requestId === undefined) {
            set({ listingError: message.message, isFetching: false });
          }
          return;
        }
        case 'ack':
        case 'pong':
          return;
      }
    },

    setConnectionStatus: (status) => {
      set({ connectionStatus: status });
    },

    navigate: async (path) => {
      const manager = getActiveFilesystemManager();
      if (!manager) return;
      const { history, historyIndex } = get();
      if (path === history[historyIndex]) return;

      const truncated = history.slice(0, historyIndex + 1);
      const appended = [...truncated, path];
      const nextHistory =
        appended.length > FILESYSTEM_HISTORY_LIMIT
          ? appended.slice(appended.length - FILESYSTEM_HISTORY_LIMIT)
          : appended;

      set({
        history: nextHistory,
        historyIndex: nextHistory.length - 1,
        currentPath: path,
        isFetching: true,
        listingError: null,
      });

      try {
        await manager.subscribe(path);
      } catch (error) {
        set({
          history,
          historyIndex,
          isFetching: false,
          listingError: (error as Error).message,
        });
      }
    },

    openWorkspacePath: async (path) => {
      const normalizedPath = normalizeWorkspacePath(path);
      if (normalizedPath === null) return;

      const openUnknownFile = () => {
        const now = new Date().toISOString();
        get().openFile({
          name: getBasename(normalizedPath),
          path: normalizedPath,
          type: 'file',
          size: null,
          updatedAt: now,
          isHidden: false,
          isSymlink: false,
        });
      };

      const openResolvedEntry = async (entry: FilesystemEntry) => {
        if (entry.type === 'directory') {
          await get().navigate(entry.path);
          get().showDirectory();
          return;
        }

        get().openFile(entry);
      };

      if (normalizedPath.length === 0) {
        await get().navigate('');
        get().showDirectory();
        return;
      }

      const visibleEntry = get().listing?.entries.find(
        (entry) => entry.path === normalizedPath,
      );
      if (visibleEntry !== undefined) {
        await openResolvedEntry(visibleEntry);
        return;
      }

      if (get().openFileEntry?.path === normalizedPath) {
        set({ activeSurface: 'file' });
        return;
      }

      const manager = getActiveFilesystemManager();
      if (!manager) return;

      const parentPath = getParentPath(normalizedPath);
      if (get().listing?.path !== parentPath) {
        await get().navigate(parentPath);
        if (get().listing?.path !== parentPath) return;
      }

      const parentListing = get().listing;
      const targetEntry =
        parentListing?.path === parentPath
          ? parentListing.entries.find((entry) => entry.path === normalizedPath)
          : undefined;

      if (targetEntry !== undefined) {
        await openResolvedEntry(targetEntry);
        return;
      }

      openUnknownFile();
    },

    goBack: async () => {
      const manager = getActiveFilesystemManager();
      if (!manager) return;
      const { history, historyIndex } = get();
      const hasHistoryBack = historyIndex > 0;
      const nextIndex = hasHistoryBack ? historyIndex - 1 : 0;
      const path = hasHistoryBack
        ? (history[nextIndex] ?? '')
        : getParentPath(get().currentPath);
      if (!hasHistoryBack && path === get().currentPath) return;
      const nextHistory = hasHistoryBack
        ? history
        : createInitialNavigationHistory(path);
      const nextHistoryIndex = hasHistoryBack ? nextIndex : nextHistory.length - 1;

      set({
        history: nextHistory,
        historyIndex: nextHistoryIndex,
        currentPath: path,
        isFetching: true,
        listingError: null,
      });

      try {
        await manager.subscribe(path);
      } catch (error) {
        set({
          history,
          historyIndex,
          isFetching: false,
          listingError: (error as Error).message,
        });
      }
    },

    goForward: async () => {
      const manager = getActiveFilesystemManager();
      if (!manager) return;
      const { history, historyIndex } = get();
      if (historyIndex >= history.length - 1) return;
      const nextIndex = historyIndex + 1;
      const path = history[nextIndex] ?? '';

      set({
        historyIndex: nextIndex,
        currentPath: path,
        isFetching: true,
        listingError: null,
      });

      try {
        await manager.subscribe(path);
      } catch (error) {
        set({
          historyIndex,
          isFetching: false,
          listingError: (error as Error).message,
        });
      }
    },

    refresh: async () => {
      const manager = getActiveFilesystemManager();
      if (!manager) return;
      set({ isFetching: true, listingError: null });
      try {
        await manager.refresh();
      } catch (error) {
        set({
          isFetching: false,
          listingError: (error as Error).message,
        });
      }
    },

    openFile: (entry) => {
      if (entry.type !== 'file') return;
      set({
        openFileEntry: entry,
        activeSurface: 'file',
      });
      syncOpenFile(entry);
    },

    closeOpenFile: () => {
      set({
        openFileEntry: null,
        activeSurface: 'directory',
      });
      syncOpenFile(null);
    },

    showDirectory: () => {
      set({ activeSurface: 'directory' });
    },

    setFilesystemClipboard: (mode, entries) => {
      set({ filesystemClipboard: { mode, entries: [...entries] } });
    },

    clearFilesystemClipboard: () => {
      set({ filesystemClipboard: null });
    },

    reset: () => {
      set({ ...initialState });
    },
  }),
);

function syncOpenFile(entry: FilesystemEntry | null): void {
  const manager = getActiveFilesystemManager();
  if (!manager) return;
  void manager.setOpenFiles(entry === null ? [] : [entry.path]).catch(() => undefined);
}

function normalizeWorkspacePath(rawPath: string): string | null {
  const path = rawPath.trim().replaceAll('\\', '/');
  if (path.includes('\0')) return null;
  if (path.length === 0) return '';

  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part.length === 0 || part === '.') continue;
    if (part === '..') return null;
    parts.push(part);
  }
  return parts.join('/');
}

function getBasename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function getLocalStorage(): Pick<Storage, 'getItem'> | null {
  if (typeof globalThis === 'undefined') return null;
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  return storage ?? null;
}
