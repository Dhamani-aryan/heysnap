import type {
  FilesystemEntry,
  FilesystemViewState,
} from '../../lib/filesystem/types.ts'
import type { LeftPaneSurface } from './filesystem-store.ts'

export type PersistedFilesystemWorkspaceState = {
  readonly currentPath: string
  readonly history: string[]
  readonly historyIndex: number
  readonly openFileTabs: FilesystemEntry[]
  readonly activeFilePath: string | null
  readonly activeLeftPaneSurface: LeftPaneSurface
}

export type ReconciledFilesystemViewState = {
  readonly openFileTabs: FilesystemEntry[]
  readonly activeFilePath: string | null
  readonly activeLeftPaneSurface: LeftPaneSurface
}

const PERSISTED_FILESYSTEM_WORKSPACE_VERSION = 1
const STORAGE_KEY_PREFIX = 'heysnap:filesystem-workspace:v1:'

export function buildFilesystemWorkspaceStorageKey(
  workspaceIdentity: string,
): string {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(workspaceIdentity)}`
}

export function readPersistedFilesystemWorkspaceState(
  storage: Pick<Storage, 'getItem'>,
  workspaceIdentity: string,
  historyLimit: number,
  options: { readonly canRestoreBrowser: boolean },
): PersistedFilesystemWorkspaceState | null {
  let rawValue: string | null

  try {
    rawValue = storage.getItem(
      buildFilesystemWorkspaceStorageKey(workspaceIdentity),
    )
  } catch {
    return null
  }

  if (rawValue === null) return null

  try {
    return parsePersistedFilesystemWorkspaceState(
      JSON.parse(rawValue) as unknown,
      historyLimit,
      options,
    )
  } catch {
    return null
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
    { canRestoreBrowser: true },
  )
  if (normalized === null) return

  try {
    storage.setItem(
      buildFilesystemWorkspaceStorageKey(workspaceIdentity),
      JSON.stringify({
        version: PERSISTED_FILESYSTEM_WORKSPACE_VERSION,
        state: normalized,
      }),
    )
  } catch {
    // Persistence is best-effort and should never interrupt the workspace.
  }
}

export function parsePersistedFilesystemWorkspaceState(
  value: unknown,
  historyLimit: number,
  options: { readonly canRestoreBrowser: boolean },
): PersistedFilesystemWorkspaceState | null {
  if (typeof value !== 'object' || value === null) return null

  const record = value as Record<string, unknown>
  if (record.version !== PERSISTED_FILESYSTEM_WORKSPACE_VERSION) return null

  return normalizePersistedFilesystemWorkspaceState(
    record.state,
    historyLimit,
    options,
  )
}

export function normalizePersistedFilesystemWorkspaceState(
  value: unknown,
  historyLimit: number,
  options: { readonly canRestoreBrowser: boolean },
): PersistedFilesystemWorkspaceState | null {
  if (typeof value !== 'object' || value === null) return null

  const record = value as Record<string, unknown>
  const currentPath =
    typeof record.currentPath === 'string' ? record.currentPath : ''
  const history = normalizeHistory(record.history, currentPath, historyLimit)
  const historyIndex = normalizeHistoryIndex(record.historyIndex, history.length)
  const openFileTabs = Array.isArray(record.openFileTabs)
    ? normalizeOpenFileTabs(record.openFileTabs)
    : []
  const activeFilePath =
    typeof record.activeFilePath === 'string' &&
    openFileTabs.some((tab) => tab.path === record.activeFilePath)
      ? record.activeFilePath
      : null
  const activeLeftPaneSurface = normalizeSurface(
    record.activeLeftPaneSurface,
    activeFilePath,
    options.canRestoreBrowser,
  )

  return {
    currentPath,
    history,
    historyIndex,
    openFileTabs,
    activeFilePath,
    activeLeftPaneSurface,
  }
}

export function reconcileFilesystemViewState(input: {
  readonly currentOpenFileTabs: readonly FilesystemEntry[]
  readonly activeFilePath: string | null
  readonly activeLeftPaneSurface: LeftPaneSurface
  readonly viewState: FilesystemViewState
  readonly shouldHydrateFromServer: boolean
}): ReconciledFilesystemViewState {
  const serverTabs = input.viewState.openFiles.filter(
    (entry): entry is FilesystemEntry => entry.type === 'file',
  )
  const serverTabsByPath = new Map(serverTabs.map((tab) => [tab.path, tab]))
  const openFileTabs =
    input.shouldHydrateFromServer && input.currentOpenFileTabs.length === 0
      ? serverTabs
      : input.currentOpenFileTabs.map(
          (tab) => serverTabsByPath.get(tab.path) ?? tab,
        )
  const activeFilePath =
    input.activeFilePath !== null &&
    openFileTabs.some((tab) => tab.path === input.activeFilePath)
      ? input.activeFilePath
      : null
  const activeLeftPaneSurface =
    input.activeLeftPaneSurface === 'file' && activeFilePath === null
      ? 'directory'
      : input.activeLeftPaneSurface

  return {
    openFileTabs,
    activeFilePath,
    activeLeftPaneSurface,
  }
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
    : []

  return history.length > 0 ? history : [currentPath]
}

function normalizeHistoryIndex(value: unknown, historyLength: number): number {
  if (historyLength === 0) return -1
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return historyLength - 1
  }
  return Math.min(historyLength - 1, Math.max(0, value))
}

function normalizeSurface(
  value: unknown,
  activeFilePath: string | null,
  canRestoreBrowser: boolean,
): LeftPaneSurface {
  if (value === 'browser' && canRestoreBrowser) return 'browser'
  if (value === 'file' && activeFilePath !== null) return 'file'
  return 'directory'
}

function normalizeOpenFileTabs(values: readonly unknown[]): FilesystemEntry[] {
  const tabs: FilesystemEntry[] = []
  const seenPaths = new Set<string>()

  for (const value of values) {
    if (typeof value !== 'object' || value === null) continue

    const record = value as Record<string, unknown>
    const path = typeof record.path === 'string' ? record.path : null
    const name = typeof record.name === 'string' ? record.name : null
    const size =
      typeof record.size === 'number' || record.size === null
        ? record.size
        : null
    const updatedAt =
      typeof record.updatedAt === 'string' ? record.updatedAt : null

    if (
      path === null ||
      name === null ||
      updatedAt === null ||
      record.type !== 'file' ||
      seenPaths.has(path)
    ) {
      continue
    }

    seenPaths.add(path)
    tabs.push({
      name,
      path,
      type: 'file',
      size,
      updatedAt,
      isHidden: record.isHidden === true,
      isSymlink: record.isSymlink === true,
    })
  }

  return tabs
}
