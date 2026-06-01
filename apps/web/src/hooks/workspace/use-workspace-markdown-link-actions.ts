import { useCallback, useMemo } from 'react'
import { focusBrowserTab } from '../../lib/browser/browser-ui-actions.ts'
import { useFilesystemStore } from '../../stores/filesystem/filesystem-store.ts'

export function useWorkspaceMarkdownLinkActions(): {
  readonly openWorkspacePath: (path: string) => void
  readonly openChromeTab: (tabId: number) => void
} {
  const openWorkspacePath = useCallback((path: string): void => {
    void useFilesystemStore.getState().openWorkspacePath(path)
  }, [])

  const openChromeTab = useCallback((tabId: number): void => {
    useFilesystemStore.getState().showBrowser()
    focusBrowserTab(tabId)
  }, [])

  return useMemo(
    () => ({ openWorkspacePath, openChromeTab }),
    [openChromeTab, openWorkspacePath],
  )
}
