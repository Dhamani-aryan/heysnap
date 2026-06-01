import { useEffect, useRef } from 'react'
import { FilesystemConnectionManager } from '../../lib/filesystem/filesystem-connection-manager.ts'
import {
  FILESYSTEM_HISTORY_LIMIT,
  getActiveFilesystemManager,
  setActiveFilesystemManager,
  useFilesystemStore,
} from '../../stores/filesystem/filesystem-store.ts'
import { useBrowserStore } from '../../stores/browser/browser-store.ts'
import { writePersistedFilesystemWorkspaceState } from '../../stores/filesystem/filesystem-persistence.ts'

type Options = {
  wsUrl: string | null | undefined
  previewBaseUrl?: string
  connectionIdentity: string | null | undefined
  workspaceIdentity: string
}

export function useFilesystemConnection({
  wsUrl,
  previewBaseUrl,
  connectionIdentity,
  workspaceIdentity,
}: Options): void {
  const latestUrlsRef = useRef({ wsUrl, previewBaseUrl })

  useEffect(() => {
    latestUrlsRef.current = { wsUrl, previewBaseUrl }
  }, [previewBaseUrl, wsUrl])

  useEffect(() => {
    const browserStore = useBrowserStore.getState()
    if (!browserStore.isWindowHydrated) {
      browserStore.hydrateWindowFromStorage()
    }
    const nextBrowserStore = useBrowserStore.getState()
    useFilesystemStore.getState().hydrateWorkspace({
      workspaceIdentity,
      canRestoreBrowser: nextBrowserStore.windowId !== null,
    })
  }, [workspaceIdentity])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const persistState = (): void => {
      const state = useFilesystemStore.getState()
      if (
        state.workspaceIdentity !== workspaceIdentity ||
        !state.hasHydratedWorkspace
      ) {
        return
      }

      writePersistedFilesystemWorkspaceState(
        window.localStorage,
        workspaceIdentity,
        {
          currentPath: state.currentPath,
          history: state.history,
          historyIndex: state.historyIndex,
          openFileTabs: state.openFileTabs,
          activeFilePath: state.activeFilePath,
          activeLeftPaneSurface: state.activeLeftPaneSurface,
        },
        FILESYSTEM_HISTORY_LIMIT,
      )
    }

    persistState()
    return useFilesystemStore.subscribe(persistState)
  }, [workspaceIdentity])

  useEffect(() => {
    const manager = getActiveFilesystemManager()
    if (!manager || !wsUrl) return
    manager.setUrls({ url: wsUrl, previewBaseUrl })
  }, [previewBaseUrl, wsUrl])

  useEffect(() => {
    const latestUrls = latestUrlsRef.current
    if (!latestUrls.wsUrl || !connectionIdentity) return

    const manager = new FilesystemConnectionManager({
      url: latestUrls.wsUrl,
      initialPath: useFilesystemStore.getState().currentPath,
      previewBaseUrl: latestUrls.previewBaseUrl,
      callbacks: {
        onMessage: (message) => {
          useFilesystemStore.getState().ingestServerMessage(message)
        },
        onStatusChange: (status) => {
          useFilesystemStore.getState().setConnectionStatus(status)
        },
      },
    })

    setActiveFilesystemManager(manager)
    useFilesystemStore.setState({ isFetching: true })
    manager.connect()

    return () => {
      manager.disconnect()
      if (getActiveFilesystemManager() === manager) {
        setActiveFilesystemManager(null)
      }
    }
  }, [connectionIdentity])
}
