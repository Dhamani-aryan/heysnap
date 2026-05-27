import { useState, type ReactNode } from 'react'
import { WorkspaceLayoutProvider } from './workspace-layout-context.tsx'
import { useWorkspaceLayout } from './use-workspace-layout.ts'
import { WorkspaceToolbar } from './workspace-toolbar.tsx'
import { WorkspaceRightSidebar } from './workspace-right-sidebar.tsx'

const FRAME_INSET_PX = 10

export function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceLayoutProvider>
      <WorkspaceLayoutShell>{children}</WorkspaceLayoutShell>
    </WorkspaceLayoutProvider>
  )
}

function WorkspaceLayoutShell({ children }: { children: ReactNode }) {
  const { isRightSidebarOpen, rightSidebarWidth } = useWorkspaceLayout()
  const [isResizing, setIsResizing] = useState(false)

  const cardRight = isRightSidebarOpen
    ? `${rightSidebarWidth + FRAME_INSET_PX * 2}px`
    : `${FRAME_INSET_PX}px`

  return (
    <main
      data-right-sidebar-open={isRightSidebarOpen ? 'true' : undefined}
      className="grid h-[100dvh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-sidebar text-heading"
    >
      <WorkspaceToolbar />
      <div className="relative min-h-0 overflow-hidden">
        <section
          data-resizing={isResizing ? 'true' : undefined}
          className="absolute top-0 overflow-hidden rounded-[10px] bg-background transition-[right] duration-[180ms] ease-out data-[resizing=true]:transition-none"
          style={{
            left: `${FRAME_INSET_PX}px`,
            bottom: `${FRAME_INSET_PX}px`,
            right: cardRight,
          }}
        >
          {children}
        </section>
        <WorkspaceRightSidebar
          insetPx={FRAME_INSET_PX}
          isResizing={isResizing}
          onResizingChange={setIsResizing}
        />
      </div>
    </main>
  )
}
