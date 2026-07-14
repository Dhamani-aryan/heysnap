import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  RIGHT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
} from './workspace-layout-constants.ts'
import { WorkspaceLayoutContext } from './workspace-layout-state.ts'

const SIDEBAR_OPEN_KEY = 'workspace:right-sidebar-open'
const SIDEBAR_WIDTH_KEY = 'workspace:right-sidebar-width'

function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return RIGHT_SIDEBAR_DEFAULT_WIDTH
  return Math.min(
    RIGHT_SIDEBAR_MAX_WIDTH,
    Math.max(RIGHT_SIDEBAR_MIN_WIDTH, Math.round(width)),
  )
}

function readInitialOpen(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SIDEBAR_OPEN_KEY) === 'true'
}

function readInitialWidth(): number {
  if (typeof window === 'undefined') return RIGHT_SIDEBAR_DEFAULT_WIDTH
  const stored = Number.parseInt(
    window.localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? '',
    10,
  )
  return Number.isFinite(stored) ? clampWidth(stored) : RIGHT_SIDEBAR_DEFAULT_WIDTH
}

export function WorkspaceLayoutProvider({ children }: { children: ReactNode }) {
  const [isChatExpanded, setIsChatExpanded] = useState(false)
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(readInitialOpen)
  const [rightSidebarWidth, setRightSidebarWidthState] =
    useState(readInitialWidth)

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_OPEN_KEY,
      isRightSidebarOpen ? 'true' : 'false',
    )
  }, [isRightSidebarOpen])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(rightSidebarWidth))
  }, [rightSidebarWidth])

  const toggleRightSidebar = useCallback(() => {
    const nextOpen = !isRightSidebarOpen
    setIsRightSidebarOpen(nextOpen)
    if (!nextOpen) setIsChatExpanded(false)
  }, [isRightSidebarOpen])

  const setRightSidebarOpen = useCallback((open: boolean) => {
    if (!open) setIsChatExpanded(false)
    setIsRightSidebarOpen(open)
  }, [])

  const toggleChatExpanded = useCallback(() => {
    const nextExpanded = !isChatExpanded
    setIsChatExpanded(nextExpanded)
    if (nextExpanded) setIsRightSidebarOpen(true)
  }, [isChatExpanded])

  const setRightSidebarWidth = useCallback((width: number) => {
    setRightSidebarWidthState(clampWidth(width))
  }, [])

  const value = useMemo(
    () => ({
      isChatExpanded,
      toggleChatExpanded,
      isRightSidebarOpen,
      toggleRightSidebar,
      setRightSidebarOpen,
      rightSidebarWidth,
      setRightSidebarWidth,
    }),
    [
      isChatExpanded,
      toggleChatExpanded,
      isRightSidebarOpen,
      toggleRightSidebar,
      setRightSidebarOpen,
      rightSidebarWidth,
      setRightSidebarWidth,
    ],
  )

  return (
    <WorkspaceLayoutContext.Provider value={value}>
      {children}
    </WorkspaceLayoutContext.Provider>
  )
}
