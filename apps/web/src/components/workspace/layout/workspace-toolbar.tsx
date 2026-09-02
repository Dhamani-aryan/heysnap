import {
  useCallback,
  useRef,
  useState,
  type Ref,
  type ReactNode,
} from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  LayoutAlignLeftIcon,
  LayoutAlignRightIcon,
  PlusSignIcon,
  SmartPhone02Icon,
  WorkHistoryIcon,
} from '@hugeicons/core-free-icons'
import { ThemeToggle } from '../../theme-toggle.tsx'
import { useWorkspaceLayout } from './use-workspace-layout.ts'
import { useFilesystemStore } from '../../../stores/filesystem/filesystem-store.ts'
import { WorkspaceTabsStrip } from './workspace-tabs.tsx'
import { ThreadHistoryPopover } from '../../agent/thread-history-popover.tsx'
import { useAgentChatStore } from '../../../stores/agent/agent-chat-store.ts'
import { useAgentThreadRoute } from '../../../hooks/agent/use-agent-thread-route.ts'
import { useAuth } from '../../../hooks/auth/use-auth.ts'
import type { AgentThreadSummary } from '../../../lib/agent/types.ts'
import { WorkspaceMobileDrawer } from './workspace-mobile-drawer.tsx'
import { useBrowserViewPublisher } from '../../../hooks/browser/use-browser-view-publisher.ts'

type WorkspaceToolbarProps = {
  browserViewPublishWebSocketUrl?: string
}

export function WorkspaceToolbar({
  browserViewPublishWebSocketUrl,
}: WorkspaceToolbarProps) {
  const {
    isChatExpanded,
    isRightSidebarOpen,
    toggleChatExpanded,
    toggleRightSidebar,
  } = useWorkspaceLayout()
  const goBack = useFilesystemStore((s) => s.goBack)
  const goForward = useFilesystemStore((s) => s.goForward)
  const canGoBack = useFilesystemStore(
    (s) => s.historyIndex > 0 || s.currentPath.length > 0,
  )
  const canGoForward = useFilesystemStore(
    (s) => s.historyIndex < s.history.length - 1,
  )
  const agentBaseUrl = useAgentChatStore((s) => s.agentBaseUrl)
  const agentIdentity = useAgentChatStore((s) => s.agentIdentity)
  const selectedThreadId = useAgentChatStore((s) => s.selectedThreadId)
  const { navigateToThread, navigateToNewThread } = useAgentThreadRoute()
  const auth = useAuth()
  const allowBrowserStream = auth.user?.allowBrowserStream === true

  const historyButtonRef = useRef<HTMLButtonElement | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false)

  const closeHistory = useCallback(() => setIsHistoryOpen(false), [])
  const closeMobileDrawer = useCallback(() => setIsMobileDrawerOpen(false), [])
  useBrowserViewPublisher({
    enabled: allowBrowserStream && browserViewPublishWebSocketUrl !== undefined,
    streamEnabled: allowBrowserStream && isMobileDrawerOpen,
    url: browserViewPublishWebSocketUrl,
  })
  const toggleHistory = useCallback(
    () => setIsHistoryOpen((current) => !current),
    [],
  )
  const toggleMobileDrawer = useCallback(
    () => setIsMobileDrawerOpen((current) => !current),
    [],
  )
  const handleSelectThread = useCallback(
    (thread: AgentThreadSummary) => {
      navigateToThread(thread.id)
      setIsHistoryOpen(false)
    },
    [navigateToThread],
  )
  const handleNewThread = useCallback(() => {
    navigateToNewThread()
  }, [navigateToNewThread])

  const sidebarLabel = isRightSidebarOpen
    ? 'Close right sidebar'
    : 'Open right sidebar'
  const chatExpandedLabel = isChatExpanded
    ? 'Restore split view'
    : 'Expand chat'

  return (
    <header className="relative z-[4] flex h-[44px] flex-shrink-0 items-center gap-[8px] px-sm">
      <NavPill
        onBack={() => void goBack()}
        onForward={() => void goForward()}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
      />
      <WorkspaceTabsStrip />
      {allowBrowserStream ? (
        <ToolbarIconButton
          icon={SmartPhone02Icon}
          label="Mobile"
          onClick={toggleMobileDrawer}
          pressed={isMobileDrawerOpen}
        />
      ) : null}
      <ThemeToggle compact />
      <div className="relative">
        <ToolbarIconButton
          ref={historyButtonRef}
          icon={WorkHistoryIcon}
          label="History"
          onClick={toggleHistory}
          pressed={isHistoryOpen}
        />
        {isHistoryOpen && agentBaseUrl !== null && agentIdentity !== null ? (
          <ThreadHistoryPopover
            agentBaseUrl={agentBaseUrl}
            agentIdentity={agentIdentity}
            selectedThreadId={selectedThreadId}
            onClose={closeHistory}
            onSelectThread={handleSelectThread}
            anchorRef={historyButtonRef}
          />
        ) : null}
      </div>
      <ToolbarIconButton
        icon={PlusSignIcon}
        label="New"
        onClick={handleNewThread}
      />
      <ToolbarIconButton
        icon={LayoutAlignLeftIcon}
        label={chatExpandedLabel}
        onClick={toggleChatExpanded}
        pressed={isChatExpanded}
      />
      <ToolbarIconButton
        icon={LayoutAlignRightIcon}
        label={sidebarLabel}
        onClick={toggleRightSidebar}
        pressed={isRightSidebarOpen}
      />
      {allowBrowserStream ? (
        <WorkspaceMobileDrawer
          open={isMobileDrawerOpen}
          onClose={closeMobileDrawer}
        />
      ) : null}
    </header>
  )
}

function NavPill({
  onBack,
  onForward,
  canGoBack,
  canGoForward,
}: {
  onBack: () => void
  onForward: () => void
  canGoBack: boolean
  canGoForward: boolean
}) {
  return (
    <div className="flex h-[26px] w-[60px] flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f9f9f9] shadow-[0_4px_16px_rgba(0,0,0,0.08)] outline outline-1 outline-[rgba(0,0,0,0.035)] dark:bg-[#1a1a1a] dark:outline-[rgba(255,255,255,0.06)]">
      <NavPillButton
        onClick={onBack}
        label="Back"
        position="left"
        disabled={!canGoBack}
      >
        <ChevronGlyph direction="left" />
      </NavPillButton>
      <NavPillButton
        onClick={onForward}
        label="Forward"
        position="right"
        disabled={!canGoForward}
      >
        <ChevronGlyph direction="right" />
      </NavPillButton>
    </div>
  )
}

function NavPillButton({
  children,
  onClick,
  label,
  position,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  label: string
  position: 'left' | 'right'
  disabled?: boolean
}) {
  const radius =
    position === 'left'
      ? 'rounded-l-full rounded-r-none'
      : 'rounded-r-full rounded-l-none'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`flex h-[26px] w-[30px] items-center justify-center ${radius} text-black/50 transition-colors duration-150 hover:bg-[#f5f5f5] hover:text-[#111] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-black/50 dark:text-[#a3a3a3] dark:hover:bg-[#1a1a1a] dark:hover:text-[#f5f5f5] dark:disabled:hover:bg-transparent dark:disabled:hover:text-[#a3a3a3]`}
    >
      {children}
    </button>
  )
}

function ChevronGlyph({ direction }: { direction: 'left' | 'right' }) {
  const rotate = direction === 'left' ? 90 : -90
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      style={{ transform: `rotate(${rotate}deg)` }}
      aria-hidden="true"
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type ToolbarIconButtonProps = {
  icon: IconSvgElement
  label: string
  onClick?: () => void
  pressed?: boolean
  ref?: Ref<HTMLButtonElement>
}

function ToolbarIconButton({
  icon,
  label,
  onClick,
  pressed,
  ref,
}: ToolbarIconButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-subheading transition-[transform,background-color,color] duration-150 ease-out hover:bg-sidebar-hover hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ghost active:scale-[0.97] aria-pressed:bg-sidebar-active aria-pressed:text-heading"
    >
      <HugeiconsIcon icon={icon} size={18} strokeWidth={1.75} />
    </button>
  )
}
