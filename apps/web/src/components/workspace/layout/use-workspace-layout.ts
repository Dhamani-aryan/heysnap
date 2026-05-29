import { useContext } from 'react'
import { WorkspaceLayoutContext } from './workspace-layout-state.ts'

export function useWorkspaceLayout() {
  const ctx = useContext(WorkspaceLayoutContext)
  if (!ctx) {
    throw new Error(
      'useWorkspaceLayout must be used within a WorkspaceLayoutProvider',
    )
  }
  return ctx
}
