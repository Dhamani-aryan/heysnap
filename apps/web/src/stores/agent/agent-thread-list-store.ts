import { create } from 'zustand'
import type {
  AgentThreadGroup,
  AgentThreadSummary,
} from '../../lib/agent/types.ts'

type AgentThreadListState = {
  groups: readonly AgentThreadGroup[]
  isLoading: boolean
  hasLoaded: boolean
  error: string | null
  setLoading: (isLoading: boolean) => void
  replaceGroups: (groups: readonly AgentThreadGroup[]) => void
  setError: (message: string | null) => void
  upsertThread: (thread: AgentThreadSummary) => void
  setThreadStreaming: (threadId: string, isStreaming: boolean) => void
  reset: () => void
}

export const useAgentThreadListStore = create<AgentThreadListState>((set) => ({
  groups: [],
  isLoading: false,
  hasLoaded: false,
  error: null,

  setLoading: (isLoading) => {
    set({
      isLoading,
      ...(isLoading ? { error: null } : {}),
    })
  },

  replaceGroups: (groups) => {
    set({
      groups: sortGroupsByLatestThread(
        groups.map((group) => ({
          path: group.path,
          threads: sortThreadsByUpdatedAt(group.threads),
        })),
      ),
      isLoading: false,
      hasLoaded: true,
      error: null,
    })
  },

  setError: (message) => {
    set({
      isLoading: false,
      hasLoaded: true,
      error: message,
    })
  },

  upsertThread: (thread) => {
    set((state) => {
      const targetPath =
        thread.lastPath.trim().length > 0 ? thread.lastPath : thread.startPath
      const groupPath = targetPath.trim()
      let didPlaceThread = false
      const groups = state.groups.map((group) => {
        const existingThread = group.threads.find(
          (currentThread) => currentThread.id === thread.id,
        )
        const withoutThread = group.threads.filter(
          (currentThread) => currentThread.id !== thread.id,
        )

        if (group.path !== groupPath && existingThread === undefined) {
          return group
        }

        if (group.path !== groupPath) {
          return { ...group, threads: withoutThread }
        }

        didPlaceThread = true
        return {
          ...group,
          threads: sortThreadsByUpdatedAt([thread, ...withoutThread]),
        }
      })

      if (!didPlaceThread) {
        groups.unshift({ path: groupPath, threads: [thread] })
      }

      return {
        groups: sortGroupsByLatestThread(
          groups
            .map((group) => ({
              ...group,
              threads: sortThreadsByUpdatedAt(group.threads),
            }))
            .filter((group) => group.threads.length > 0),
        ),
        hasLoaded: true,
        error: null,
      }
    })
  },

  setThreadStreaming: (threadId, isStreaming) => {
    set((state) => {
      let didChange = false
      const groups = state.groups.map((group) => {
        const threads = group.threads.map((thread) => {
          if (thread.id !== threadId || thread.isStreaming === isStreaming) {
            return thread
          }

          didChange = true
          return { ...thread, isStreaming }
        })

        return didChange ? { ...group, threads } : group
      })

      return didChange ? { groups } : state
    })
  },

  reset: () => {
    set({
      groups: [],
      isLoading: false,
      hasLoaded: false,
      error: null,
    })
  },
}))

export function selectHasThreads(state: AgentThreadListState): boolean {
  return state.groups.some((group) => group.threads.length > 0)
}

export function selectHasStreamingThreads(state: AgentThreadListState): boolean {
  return state.groups.some((group) =>
    group.threads.some((thread) => thread.isStreaming === true),
  )
}

function sortThreadsByUpdatedAt(
  threads: readonly AgentThreadSummary[],
): AgentThreadSummary[] {
  return [...threads].sort((left, right) => right.updatedAt - left.updatedAt)
}

function sortGroupsByLatestThread(
  groups: readonly AgentThreadGroup[],
): AgentThreadGroup[] {
  return [...groups].sort((left, right) => {
    const leftUpdatedAt = left.threads[0]?.updatedAt ?? Number.NEGATIVE_INFINITY
    const rightUpdatedAt = right.threads[0]?.updatedAt ?? Number.NEGATIVE_INFINITY

    return rightUpdatedAt - leftUpdatedAt || left.path.localeCompare(right.path)
  })
}
