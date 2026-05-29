import { useEffect } from 'react'
import { FilesystemConnectionManager } from '../../lib/filesystem/filesystem-connection-manager.ts'
import {
  setActiveFilesystemManager,
  useFilesystemStore,
} from '../../stores/filesystem/filesystem-store.ts'

type Options = {
  wsUrl: string | null | undefined
  previewBaseUrl?: string
}

export function useFilesystemConnection({
  wsUrl,
  previewBaseUrl,
}: Options): void {
  useEffect(() => {
    if (!wsUrl) return

    const manager = new FilesystemConnectionManager({
      url: wsUrl,
      previewBaseUrl,
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
      setActiveFilesystemManager(null)
      useFilesystemStore.getState().reset()
    }
  }, [wsUrl, previewBaseUrl])
}
