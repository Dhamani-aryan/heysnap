import type {
  FilesystemEntry,
  FilesystemViewState,
} from '@/lib/filesystem/types';
import type { FilesystemSurface } from './filesystem-store';

export type PersistedFilesystemWorkspaceState = {
  readonly currentPath: string;
  readonly history: string[];
  readonly historyIndex: number;
  readonly openFileEntry: FilesystemEntry | null;
  readonly activeSurface: FilesystemSurface;
};

export type ReconciledFilesystemViewState = {
  readonly openFileEntry: FilesystemEntry | null;
  readonly activeSurface: FilesystemSurface;
};

const PERSISTED_FILESYSTEM_WORKSPACE_VERSION = 1;
const STORAGE_KEY_PREFIX = 'heysnap:mobile-filesystem-workspace:v1:';

export function buildFilesystemWorkspaceStorageKey(
  workspaceIdentity: string,
): string {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(workspaceIdentity)}`;
}

export function readPersistedFilesystemWorkspaceState(
  storage: Pick<Storage, 'getItem'>,
  workspaceIdentity: string,
  historyLimit: number,
): PersistedFilesystemWorkspaceState | null {
  let rawValue: string | null;

  try {
    rawValue = storage.getItem(
      buildFilesystemWorkspaceStorageKey(workspaceIdentity),
    );
  } catch {
    return null;
  }

  if (rawValue === null) return null;

  try {
    return parsePersistedFilesystemWorkspaceState(
      JSON.parse(rawValue) as unknown,
      historyLimit,
    );
  } catch {
    return null;
  }
}

export function writePersistedFilesystemWorkspaceState(
  storage: Pick<Storage, 'setItem'>,
  workspaceIdentity: string,
  state: PersistedFilesystemWorkspaceState,
  historyLimit: number,
): void {
  const normalized = normalizePersistedFilesystemWorkspaceState(
    state,
    historyLimit,
  );
  if (normalized === null) return;

  try {
    storage.setItem(
      buildFilesystemWorkspaceStorageKey(workspaceIdentity),
      JSON.stringify({
        version: PERSISTED_FILESYSTEM_WORKSPACE_VERSION,
        state: normalized,
      }),
    );
  } catch {
    // Persistence is best-effort and should never interrupt the workspace.
  }
}

export function parsePersistedFilesystemWorkspaceState(
  value: unknown,
  historyLimit: number,
): PersistedFilesystemWorkspaceState | null {
  if (typeof value !== 'object' || value === null) return null;

  const record = value as Record<string, unknown>;
  if (record.version !== PERSISTED_FILESYSTEM_WORKSPACE_VERSION) return null;

  return normalizePersistedFilesystemWorkspaceState(
    record.state,
    historyLimit,
  );
}

export function normalizePersistedFilesystemWorkspaceState(
  value: unknown,
  historyLimit: number,
): PersistedFilesystemWorkspaceState | null {
  if (typeof value !== 'object' || value === null) return null;

  const record = value as Record<string, unknown>;
  const currentPath =
    typeof record.currentPath === 'string' ? record.currentPath : '';
  const history = normalizeHistory(record.history, currentPath, historyLimit);
  const historyIndex = normalizeHistoryIndex(record.historyIndex, history.length);
  const openFileEntry = normalizeOpenFileEntry(record.openFileEntry);
  const activeSurface = normalizeSurface(record.activeSurface, openFileEntry);

  return {
    currentPath,
    history,
    historyIndex,
    openFileEntry,
    activeSurface,
  };
}

export function reconcileFilesystemViewState(input: {
  readonly currentOpenFileEntry: FilesystemEntry | null;
  readonly activeSurface: FilesystemSurface;
  readonly viewState: FilesystemViewState;
  readonly shouldHydrateFromServer: boolean;
}): ReconciledFilesystemViewState {
  const serverOpenFiles = input.viewState.openFiles.filter(
    (entry): entry is FilesystemEntry => entry.type === 'file',
  );
  const serverOpenFile =
    input.currentOpenFileEntry === null
      ? null
      : serverOpenFiles.find(
          (entry) => entry.path === input.currentOpenFileEntry?.path,
        ) ?? input.currentOpenFileEntry;
  const openFileEntry =
    input.shouldHydrateFromServer && input.currentOpenFileEntry === null
      ? serverOpenFiles[0] ?? null
      : serverOpenFile;
  const activeSurface =
    input.activeSurface === 'file' && openFileEntry === null
      ? 'directory'
      : input.activeSurface;

  return {
    openFileEntry,
    activeSurface,
  };
}

function normalizeHistory(
  value: unknown,
  currentPath: string,
  historyLimit: number,
): string[] {
  const history = Array.isArray(value)
    ? value
        .filter((path): path is string => typeof path === 'string')
        .slice(-historyLimit)
    : [];

  return history.length > 0 ? history : [currentPath];
}

function normalizeHistoryIndex(value: unknown, historyLength: number): number {
  if (historyLength === 0) return -1;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return historyLength - 1;
  }
  return Math.min(historyLength - 1, Math.max(0, value));
}

function normalizeSurface(
  value: unknown,
  openFileEntry: FilesystemEntry | null,
): FilesystemSurface {
  if (value === 'file' && openFileEntry !== null) return 'file';
  return 'directory';
}

function normalizeOpenFileEntry(value: unknown): FilesystemEntry | null {
  if (typeof value !== 'object' || value === null) return null;

  const record = value as Record<string, unknown>;
  const path = typeof record.path === 'string' ? record.path : null;
  const name = typeof record.name === 'string' ? record.name : null;
  const size =
    typeof record.size === 'number' || record.size === null
      ? record.size
      : null;
  const updatedAt =
    typeof record.updatedAt === 'string' ? record.updatedAt : null;

  if (record.type !== undefined && record.type !== 'file') return null;
  if (path === null || name === null || updatedAt === null) return null;

  return {
    name,
    path,
    type: 'file',
    size,
    updatedAt,
    isHidden: record.isHidden === true,
    isSymlink: record.isSymlink === true,
  };
}
