import { create } from 'zustand'
import type { FilesystemConnectionManager } from '../../lib/filesystem/filesystem-connection-manager.ts'
import type {
  FilesystemConnectionStatus,
  FilesystemEntry,
  FilesystemListing,
  FilesystemServerMessage,
} from '../../lib/filesystem/types.ts'

const HISTORY_LIMIT = 64

export type LeftPaneSurface = 'directory' | 'file' | 'browser'

let activeManager: FilesystemConnectionManager | null = null

export function setActiveFilesystemManager(
  manager: FilesystemConnectionManager | null,
): void {
  activeManager = manager
}

export function getActiveFilesystemManager(): FilesystemConnectionManager | null {
  return activeManager
}

type FilesystemState = {
  connectionStatus: FilesystemConnectionStatus
  currentPath: string
  listing: FilesystemListing | null
  isFetching: boolean
  listingError: string | null
  history: string[]
  historyIndex: number
  openFileTabs: FilesystemEntry[]
  activeFilePath: string | null
  activeLeftPaneSurface: LeftPaneSurface
  hasHydratedOpenFiles: boolean
}

type FilesystemActions = {
  ingestServerMessage: (message: FilesystemServerMessage) => void
  setConnectionStatus: (status: FilesystemConnectionStatus) => void
  navigate: (path: string) => Promise<void>
  goBack: () => Promise<void>
  goForward: () => Promise<void>
  refresh: () => Promise<void>
  openFile: (entry: FilesystemEntry) => void
  closeFileTab: (path: string) => void
  selectFileTab: (path: string) => void
  showDirectory: () => void
  showBrowser: () => void
  reset: () => void
}

const initialState: FilesystemState = {
  connectionStatus: 'idle',
  currentPath: '',
  listing: null,
  isFetching: false,
  listingError: null,
  history: [''],
  historyIndex: 0,
  openFileTabs: [],
  activeFilePath: null,
  activeLeftPaneSurface: 'directory',
  hasHydratedOpenFiles: false,
}

export const useFilesystemStore = create<FilesystemState & FilesystemActions>(
  (set, get) => ({
    ...initialState,

    ingestServerMessage: (message) => {
      switch (message.type) {
        case 'snapshot': {
          set({
            listing: message.listing,
            currentPath: message.listing.path,
            isFetching: false,
            listingError: null,
          })
          return
        }
        case 'hello': {
          if (!get().hasHydratedOpenFiles) {
            const openFiles = message.viewState?.openFiles ?? []
            set({
              openFileTabs: [...openFiles],
              hasHydratedOpenFiles: true,
            })
            return
          }
          syncOpenFiles(get().openFileTabs)
          return
        }
        case 'error': {
          if (message.requestId === undefined) {
            set({ listingError: message.message, isFetching: false })
          }
          return
        }
        case 'ack':
        case 'pong':
          return
      }
    },

    setConnectionStatus: (status) => {
      set({ connectionStatus: status })
    },

    navigate: async (path) => {
      const manager = getActiveFilesystemManager()
      if (!manager) return
      const { history, historyIndex } = get()
      if (path === history[historyIndex]) return

      const truncated = history.slice(0, historyIndex + 1)
      const appended = [...truncated, path]
      const nextHistory =
        appended.length > HISTORY_LIMIT
          ? appended.slice(appended.length - HISTORY_LIMIT)
          : appended

      set({
        history: nextHistory,
        historyIndex: nextHistory.length - 1,
        currentPath: path,
        isFetching: true,
        listingError: null,
      })

      try {
        await manager.subscribe(path)
      } catch (error) {
        set({
          history,
          historyIndex,
          isFetching: false,
          listingError: (error as Error).message,
        })
      }
    },

    goBack: async () => {
      const manager = getActiveFilesystemManager()
      if (!manager) return
      const { history, historyIndex } = get()
      if (historyIndex <= 0) return
      const nextIndex = historyIndex - 1
      const path = history[nextIndex] ?? ''

      set({
        historyIndex: nextIndex,
        currentPath: path,
        isFetching: true,
        listingError: null,
      })

      try {
        await manager.subscribe(path)
      } catch (error) {
        set({
          historyIndex,
          isFetching: false,
          listingError: (error as Error).message,
        })
      }
    },

    goForward: async () => {
      const manager = getActiveFilesystemManager()
      if (!manager) return
      const { history, historyIndex } = get()
      if (historyIndex >= history.length - 1) return
      const nextIndex = historyIndex + 1
      const path = history[nextIndex] ?? ''

      set({
        historyIndex: nextIndex,
        currentPath: path,
        isFetching: true,
        listingError: null,
      })

      try {
        await manager.subscribe(path)
      } catch (error) {
        set({
          historyIndex,
          isFetching: false,
          listingError: (error as Error).message,
        })
      }
    },

    refresh: async () => {
      const manager = getActiveFilesystemManager()
      if (!manager) return
      set({ isFetching: true, listingError: null })
      try {
        await manager.refresh()
      } catch (error) {
        set({
          isFetching: false,
          listingError: (error as Error).message,
        })
      }
    },

    openFile: (entry) => {
      if (entry.type !== 'file') return
      const { openFileTabs } = get()
      const exists = openFileTabs.some((tab) => tab.path === entry.path)
      const nextTabs = exists
        ? openFileTabs.map((tab) => (tab.path === entry.path ? entry : tab))
        : [...openFileTabs, entry]
      set({
        openFileTabs: nextTabs,
        activeFilePath: entry.path,
        activeLeftPaneSurface: 'file',
      })
      syncOpenFiles(nextTabs)
    },

    closeFileTab: (path) => {
      const { openFileTabs, activeFilePath, activeLeftPaneSurface } = get()
      const index = openFileTabs.findIndex((tab) => tab.path === path)
      if (index < 0) return
      const nextTabs = openFileTabs.filter((tab) => tab.path !== path)
      const wasActive = activeFilePath === path
      const nextActiveFilePath = wasActive
        ? (nextTabs[index]?.path ?? nextTabs[index - 1]?.path ?? null)
        : activeFilePath
      const nextSurface: LeftPaneSurface =
        wasActive && nextActiveFilePath === null
          ? 'directory'
          : activeLeftPaneSurface
      set({
        openFileTabs: nextTabs,
        activeFilePath: nextActiveFilePath,
        activeLeftPaneSurface: nextSurface,
      })
      syncOpenFiles(nextTabs)
    },

    selectFileTab: (path) => {
      const { openFileTabs } = get()
      if (!openFileTabs.some((tab) => tab.path === path)) return
      set({ activeFilePath: path, activeLeftPaneSurface: 'file' })
    },

    showDirectory: () => {
      set({ activeLeftPaneSurface: 'directory' })
    },

    showBrowser: () => {
      set({ activeLeftPaneSurface: 'browser' })
    },

    reset: () => {
      set({ ...initialState })
    },
  }),
)

function syncOpenFiles(tabs: readonly FilesystemEntry[]): void {
  const manager = getActiveFilesystemManager()
  if (!manager) return
  void manager.setOpenFiles(tabs.map((tab) => tab.path)).catch(() => undefined)
}
