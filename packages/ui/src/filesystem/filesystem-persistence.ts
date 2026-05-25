import type { OpenFileTab } from "../components/filesystem";
import type { FilesystemEntry, FilesystemViewState } from "./types";

export type PersistedFilesystemSurface = "directory" | "file";

export interface PersistedFilesystemExplorerState {
  readonly currentPath: string;
  readonly history: string[];
  readonly historyIndex: number;
  readonly openFileTabs: OpenFileTab[];
  readonly activeFilePath: string | null;
  readonly activeLeftPaneSurface: PersistedFilesystemSurface;
}

export interface ReconciledFilesystemViewState {
  readonly openFileTabs: OpenFileTab[];
  readonly activeFilePath: string | null;
  readonly activeLeftPaneSurface: "directory" | "browser" | "file";
}

const PERSISTED_FILESYSTEM_STATE_VERSION = 1;
const STORAGE_KEY_PREFIX = "filesystem-explorer:workspace:v1:";

export const buildFilesystemExplorerStorageKey = (workspacePersistenceKey: string): string =>
  `${STORAGE_KEY_PREFIX}${encodeURIComponent(workspacePersistenceKey)}`;

export const readPersistedFilesystemExplorerState = (
  storage: Pick<Storage, "getItem">,
  storageKey: string,
  historyLimit: number,
): PersistedFilesystemExplorerState | null => {
  let rawValue: string | null;

  try {
    rawValue = storage.getItem(storageKey);
  } catch {
    return null;
  }

  if (rawValue === null) {
    return null;
  }

  try {
    return parsePersistedFilesystemExplorerState(JSON.parse(rawValue) as unknown, historyLimit);
  } catch {
    return null;
  }
};

export const writePersistedFilesystemExplorerState = (
  storage: Pick<Storage, "setItem">,
  storageKey: string,
  state: PersistedFilesystemExplorerState,
  historyLimit: number,
): void => {
  const normalized = normalizePersistedFilesystemExplorerState(state, historyLimit);

  try {
    storage.setItem(storageKey, JSON.stringify({
      version: PERSISTED_FILESYSTEM_STATE_VERSION,
      state: normalized,
    }));
  } catch {
    // Persistence is a convenience layer; storage failures should not interrupt the workspace.
  }
};

export const parsePersistedFilesystemExplorerState = (
  value: unknown,
  historyLimit: number,
): PersistedFilesystemExplorerState | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record["version"] !== PERSISTED_FILESYSTEM_STATE_VERSION) {
    return null;
  }

  return normalizePersistedFilesystemExplorerState(record["state"], historyLimit);
};

export const normalizePersistedFilesystemExplorerState = (
  value: unknown,
  historyLimit: number,
): PersistedFilesystemExplorerState | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const openFileTabs = Array.isArray(record["openFileTabs"])
    ? normalizeOpenFileTabs(record["openFileTabs"])
    : [];
  const activeFilePath = typeof record["activeFilePath"] === "string" &&
    openFileTabs.some((tab) => tab.path === record["activeFilePath"])
    ? record["activeFilePath"]
    : null;
  const activeLeftPaneSurface =
    record["activeLeftPaneSurface"] === "file" && activeFilePath !== null ? "file" : "directory";
  const history = Array.isArray(record["history"])
    ? record["history"].filter((path): path is string => typeof path === "string").slice(-historyLimit)
    : [];
  const historyIndex = normalizeHistoryIndex(record["historyIndex"], history.length);

  return {
    currentPath: typeof record["currentPath"] === "string" ? record["currentPath"] : "",
    history,
    historyIndex,
    openFileTabs,
    activeFilePath,
    activeLeftPaneSurface,
  };
};

export const reconcileFilesystemViewState = (input: {
  readonly currentOpenFileTabs: readonly OpenFileTab[];
  readonly activeFilePath: string | null;
  readonly activeLeftPaneSurface: "directory" | "browser" | "file";
  readonly viewState: FilesystemViewState;
  readonly shouldHydrateFromServer: boolean;
}): ReconciledFilesystemViewState => {
  const serverTabs = input.viewState.openFiles.map(toOpenFileTab);
  const serverTabsByPath = new Map(serverTabs.map((tab) => [tab.path, tab]));
  const openFileTabs = input.shouldHydrateFromServer && input.currentOpenFileTabs.length === 0
    ? serverTabs
    : input.currentOpenFileTabs.map((tab) => serverTabsByPath.get(tab.path) ?? tab);
  const activeFilePath = input.activeFilePath !== null &&
    openFileTabs.some((tab) => tab.path === input.activeFilePath)
    ? input.activeFilePath
    : null;
  const activeLeftPaneSurface = input.activeLeftPaneSurface === "file" && activeFilePath === null
    ? "directory"
    : input.activeLeftPaneSurface;

  return {
    openFileTabs,
    activeFilePath,
    activeLeftPaneSurface,
  };
};

const normalizeHistoryIndex = (value: unknown, historyLength: number): number => {
  if (historyLength === 0) {
    return -1;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    return historyLength - 1;
  }

  return Math.min(historyLength - 1, Math.max(0, value));
};

const normalizeOpenFileTabs = (values: readonly unknown[]): OpenFileTab[] => {
  const tabs: OpenFileTab[] = [];
  const seenPaths = new Set<string>();

  for (const value of values) {
    if (typeof value !== "object" || value === null) {
      continue;
    }

    const record = value as Record<string, unknown>;
    const path = typeof record["path"] === "string" ? record["path"] : null;
    const name = typeof record["name"] === "string" ? record["name"] : null;
    const size = typeof record["size"] === "number" || record["size"] === null ? record["size"] : null;
    const updatedAt = typeof record["updatedAt"] === "string" ? record["updatedAt"] : null;

    if (path === null || name === null || updatedAt === null || seenPaths.has(path)) {
      continue;
    }

    seenPaths.add(path);
    tabs.push({ name, path, size, updatedAt });
  }

  return tabs;
};

const toOpenFileTab = (entry: FilesystemEntry): OpenFileTab => ({
  name: entry.name,
  path: entry.path,
  size: entry.size,
  updatedAt: entry.updatedAt,
});
