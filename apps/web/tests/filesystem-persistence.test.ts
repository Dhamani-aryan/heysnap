import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FILESYSTEM_HISTORY_LIMIT,
  setActiveFilesystemManager,
  useFilesystemStore,
} from '../src/stores/filesystem/filesystem-store.ts'
import {
  buildFilesystemWorkspaceStorageKey,
  normalizePersistedFilesystemWorkspaceState,
  writePersistedFilesystemWorkspaceState,
} from '../src/stores/filesystem/filesystem-persistence.ts'
import type { FilesystemEntry } from '../src/lib/filesystem/types.ts'

const fileEntry = (path: string): FilesystemEntry => ({
  name: path.split('/').at(-1) ?? path,
  path,
  type: 'file',
  size: 10,
  updatedAt: '2026-01-01T00:00:00.000Z',
  isHidden: false,
  isSymlink: false,
})

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

describe('filesystem workspace persistence', () => {
  beforeEach(() => {
    setActiveFilesystemManager(null)
    useFilesystemStore.getState().reset()
    vi.unstubAllGlobals()
  })

  it('restores persisted folder, history, and open tabs after a store reset', () => {
    const storage = createMemoryStorage()
    vi.stubGlobal('window', { localStorage: storage })

    writePersistedFilesystemWorkspaceState(
      storage,
      'machine-1',
      {
        currentPath: 'src/app',
        history: ['', 'src', 'src/app'],
        historyIndex: 2,
        openFileTabs: [fileEntry('src/app/page.tsx')],
        activeFilePath: 'src/app/page.tsx',
        activeLeftPaneSurface: 'file',
      },
      FILESYSTEM_HISTORY_LIMIT,
    )

    useFilesystemStore.getState().hydrateWorkspace({
      workspaceIdentity: 'machine-1',
      canRestoreBrowser: true,
    })

    const state = useFilesystemStore.getState()
    expect(state.currentPath).toBe('src/app')
    expect(state.history).toEqual(['', 'src', 'src/app'])
    expect(state.historyIndex).toBe(2)
    expect(state.openFileTabs.map((tab) => tab.path)).toEqual([
      'src/app/page.tsx',
    ])
    expect(state.activeFilePath).toBe('src/app/page.tsx')
    expect(state.activeLeftPaneSurface).toBe('file')
  })

  it('restores the active file only when the tab still exists', () => {
    const normalized = normalizePersistedFilesystemWorkspaceState(
      {
        currentPath: 'src',
        history: ['src'],
        historyIndex: 0,
        openFileTabs: [fileEntry('src/kept.ts')],
        activeFilePath: 'src/missing.ts',
        activeLeftPaneSurface: 'file',
      },
      FILESYSTEM_HISTORY_LIMIT,
      { canRestoreBrowser: true },
    )

    expect(normalized?.activeFilePath).toBeNull()
    expect(normalized?.activeLeftPaneSurface).toBe('directory')
  })

  it('restores file tabs written before filesystem entry metadata existed', () => {
    const normalized = normalizePersistedFilesystemWorkspaceState(
      {
        currentPath: 'src',
        history: ['src'],
        historyIndex: 0,
        openFileTabs: [
          {
            name: 'page.tsx',
            path: 'src/page.tsx',
            size: 10,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        activeFilePath: 'src/page.tsx',
        activeLeftPaneSurface: 'file',
      },
      FILESYSTEM_HISTORY_LIMIT,
      { canRestoreBrowser: true },
    )

    expect(normalized?.openFileTabs).toEqual([fileEntry('src/page.tsx')])
    expect(normalized?.activeFilePath).toBe('src/page.tsx')
    expect(normalized?.activeLeftPaneSurface).toBe('file')
  })

  it('restores browser surface only when a browser window can be hydrated', () => {
    const input = {
      currentPath: '',
      history: [''],
      historyIndex: 0,
      openFileTabs: [],
      activeFilePath: null,
      activeLeftPaneSurface: 'browser',
    }

    expect(
      normalizePersistedFilesystemWorkspaceState(
        input,
        FILESYSTEM_HISTORY_LIMIT,
        { canRestoreBrowser: true },
      )?.activeLeftPaneSurface,
    ).toBe('browser')
    expect(
      normalizePersistedFilesystemWorkspaceState(
        input,
        FILESYSTEM_HISTORY_LIMIT,
        { canRestoreBrowser: false },
      )?.activeLeftPaneSurface,
    ).toBe('directory')
  })

  it('stores state with a machine-scoped key', () => {
    const storage = createMemoryStorage()

    writePersistedFilesystemWorkspaceState(
      storage,
      'machine/with/slashes',
      {
        currentPath: '',
        history: [''],
        historyIndex: 0,
        openFileTabs: [],
        activeFilePath: null,
        activeLeftPaneSurface: 'directory',
      },
      FILESYSTEM_HISTORY_LIMIT,
    )

    expect(
      storage.getItem(
        buildFilesystemWorkspaceStorageKey('machine/with/slashes'),
      ),
    ).not.toBeNull()
  })

  it('focuses an already-open file from a workspace link', async () => {
    useFilesystemStore.setState({
      openFileTabs: [
        fileEntry('src/app/page.tsx'),
        fileEntry('src/app/other.tsx'),
      ],
      activeFilePath: 'src/app/other.tsx',
      activeLeftPaneSurface: 'browser',
    })

    await useFilesystemStore.getState().openWorkspacePath('src/app/page.tsx')

    const state = useFilesystemStore.getState()
    expect(state.activeFilePath).toBe('src/app/page.tsx')
    expect(state.activeLeftPaneSurface).toBe('file')
  })
})
