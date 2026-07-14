import { useCallback, type PointerEvent as ReactPointerEvent } from 'react'
import { useWorkspaceLayout } from './use-workspace-layout.ts'
import { AgentPanel } from '../../agent/agent-panel.tsx'
import { useWorkspaceMarkdownLinkActions } from '../../../hooks/workspace/use-workspace-markdown-link-actions.ts'

type Props = {
  insetPx: number
  isResizing: boolean
  onResizingChange: (resizing: boolean) => void
}

export function WorkspaceRightSidebar({
  insetPx,
  isResizing,
  onResizingChange,
}: Props) {
  const {
    isChatExpanded,
    isRightSidebarOpen,
    rightSidebarWidth,
    setRightSidebarWidth,
  } = useWorkspaceLayout()
  const { openWorkspacePath, openChromeTab } = useWorkspaceMarkdownLinkActions()

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = rightSidebarWidth

      onResizingChange(true)
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handleMove = (moveEvent: PointerEvent) => {
        const delta = startX - moveEvent.clientX
        setRightSidebarWidth(startWidth + delta)
      }
      const handleUp = () => {
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        onResizingChange(false)
      }
      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
    },
    [rightSidebarWidth, setRightSidebarWidth, onResizingChange],
  )

  return (
    <aside
      aria-label="Right sidebar"
      aria-hidden={!isRightSidebarOpen}
      data-open={isRightSidebarOpen ? 'true' : 'false'}
      data-expanded={isChatExpanded ? 'true' : undefined}
      data-resizing={isResizing ? 'true' : undefined}
      className="pointer-events-none absolute top-0 z-[3] flex translate-x-[calc(100%+12px)] flex-col overflow-visible transition-[left,width,transform] duration-[180ms] ease-out data-[open=true]:pointer-events-auto data-[open=true]:translate-x-0 data-[resizing=true]:transition-none"
      style={{
        left: isChatExpanded ? `${insetPx}px` : undefined,
        width: isChatExpanded
          ? `calc(100% - ${insetPx * 2}px)`
          : `${rightSidebarWidth}px`,
        right: `${insetPx}px`,
        bottom: `${insetPx}px`,
      }}
    >
      {isRightSidebarOpen && !isChatExpanded ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right sidebar"
          onPointerDown={handleResizePointerDown}
          data-resizing={isResizing ? 'true' : undefined}
          className="group absolute bottom-0 top-0 z-[1] flex w-[14px] cursor-col-resize items-center justify-center"
          style={{ left: `-${insetPx + 7}px` }}
        >
          <span
            aria-hidden="true"
            className="block h-[32px] w-[3px] rounded-full bg-black/15 transition-[background-color,height] duration-150 ease-out group-hover:h-[44px] group-hover:bg-black/35 dark:bg-white/20 dark:group-hover:bg-white/40"
          />
        </div>
      ) : null}
      <div className="pointer-events-auto flex flex-1 flex-col overflow-hidden">
        <AgentPanel
          showPrompt={isRightSidebarOpen}
          onOpenWorkspacePath={openWorkspacePath}
          onOpenChromeTab={openChromeTab}
        />
      </div>
    </aside>
  )
}
