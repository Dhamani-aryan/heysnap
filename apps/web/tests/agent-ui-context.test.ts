import { describe, expect, it } from 'vitest'
import { buildAgentUiContext } from '../src/lib/agent/ui-context.ts'

describe('agent UI context', () => {
  it('includes open files and marks the active file as focused', () => {
    expect(
      buildAgentUiContext({
        openFileTabs: [{ path: 'src/app.tsx' }, { path: 'src/test.ts' }],
        activeFilePath: 'src/test.ts',
        activeLeftPaneSurface: 'file',
        browserWindowId: null,
      }),
    ).toEqual({
      openFiles: [
        { path: 'src/app.tsx', isFocused: false },
        { path: 'src/test.ts', isFocused: true },
      ],
    })
  })

  it('includes Chrome when the browser window exists and marks it focused only on the browser surface', () => {
    expect(
      buildAgentUiContext({
        openFileTabs: [{ path: 'src/app.tsx' }],
        activeFilePath: 'src/app.tsx',
        activeLeftPaneSurface: 'browser',
        browserWindowId: 42,
      }),
    ).toEqual({
      openFiles: [
        { path: 'src/app.tsx', isFocused: false },
        { path: 'chrome', isFocused: true },
      ],
    })
  })
})
