import type { FilesystemEntry } from '../filesystem/types.ts'
import type { AgentUiContext } from './types.ts'

type WorkspaceSurface = 'directory' | 'file' | 'browser'

export type BuildAgentUiContextInput = {
  readonly openFileTabs: readonly Pick<FilesystemEntry, 'path'>[]
  readonly activeFilePath: string | null
  readonly activeLeftPaneSurface: WorkspaceSurface
  readonly browserWindowId: number | null
}

export function buildAgentUiContext({
  openFileTabs,
  activeFilePath,
  activeLeftPaneSurface,
  browserWindowId,
}: BuildAgentUiContextInput): AgentUiContext {
  return {
    openFiles: [
      ...openFileTabs.map((tab) => ({
        path: tab.path,
        isFocused:
          activeLeftPaneSurface === 'file' && tab.path === activeFilePath,
      })),
      ...(browserWindowId !== null
        ? [
            {
              path: 'chrome',
              isFocused: activeLeftPaneSurface === 'browser',
            },
          ]
        : []),
    ],
  }
}
