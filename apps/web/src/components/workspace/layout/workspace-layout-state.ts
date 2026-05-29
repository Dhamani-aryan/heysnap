import { createContext } from 'react'

export type WorkspaceLayoutValue = {
  isRightSidebarOpen: boolean
  toggleRightSidebar: () => void
  setRightSidebarOpen: (open: boolean) => void
  rightSidebarWidth: number
  setRightSidebarWidth: (width: number) => void
}

export const WorkspaceLayoutContext =
  createContext<WorkspaceLayoutValue | null>(null)
