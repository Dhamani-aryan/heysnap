import { useMemo } from 'react'
import { buildAgentUiContext } from '../../lib/agent/ui-context.ts'
import { useBrowserStore } from '../../stores/browser/browser-store.ts'
import { useFilesystemStore } from '../../stores/filesystem/filesystem-store.ts'
import type { AgentUiContext } from '../../lib/agent/types.ts'

export function useAgentUiContext(): AgentUiContext {
  const openFileTabs = useFilesystemStore((s) => s.openFileTabs)
  const activeFilePath = useFilesystemStore((s) => s.activeFilePath)
  const activeLeftPaneSurface = useFilesystemStore(
    (s) => s.activeLeftPaneSurface,
  )
  const browserWindowId = useBrowserStore((s) => s.windowId)

  return useMemo(
    () =>
      buildAgentUiContext({
        openFileTabs,
        activeFilePath,
        activeLeftPaneSurface,
        browserWindowId,
      }),
    [activeFilePath, activeLeftPaneSurface, browserWindowId, openFileTabs],
  )
}
