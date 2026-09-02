import { create } from 'zustand'
import {
  applyAgentRuntimeEvent,
  applyEditedUserMessage,
  applyOptimisticUserMessage,
  coalesceDeltaEvents,
  createEmptyAgentChatData,
  loadThreadIntoData,
  type ActiveRunState,
  type AgentChatData,
} from '../../lib/agent/agent-events.ts'
import type {
  AgentContent,
  AgentRunEvent,
  AgentThread,
  UserMessage,
} from '../../lib/agent/types.ts'

export function setActiveAgentConnection(input: {
  readonly agentBaseUrl: string | null
  readonly agentIdentity: string | null
}): void {
  useAgentChatStore.setState(input)
}

export function getActiveAgentBaseUrl(): string | null {
  return useAgentChatStore.getState().agentBaseUrl
}

type AgentChatActions = {
  setSelectedThreadId: (threadId: string | null) => void
  setThreadLoading: (threadId: string) => void
  setLoadError: (message: string) => void
  setRunError: (message: string | null) => void
  loadThread: (thread: AgentThread | null) => void
  reset: () => void
  addOptimisticUserMessage: (
    message: UserMessage,
    activeRun: ActiveRunState,
  ) => void
  startEditedUserMessageRun: (input: {
    readonly messageId: string
    readonly content: AgentContent
    readonly activeRun: ActiveRunState
  }) => void
  markRunStarted: (input: {
    readonly runId: string
    readonly threadId: string
  }) => void
  bufferRuntimeEvent: (event: AgentRunEvent) => void
  flushBufferedRuntimeEvents: () => void
  applyRuntimeEvent: (event: AgentRunEvent) => void
  finishRun: () => void
  failRun: (message: string) => void
}

type AgentConnectionState = {
  agentBaseUrl: string | null
  agentIdentity: string | null
}

export type AgentChatState = AgentChatData &
  AgentConnectionState &
  AgentChatActions

export const useAgentChatStore = create<AgentChatState>((set, get) => ({
  ...createEmptyAgentChatData(),
  agentBaseUrl: null,
  agentIdentity: null,

  setSelectedThreadId: (threadId) => {
    set({ selectedThreadId: threadId })
  },

  setThreadLoading: (threadId) => {
    set({
      selectedThreadId: threadId,
      loadStatus: 'loading',
      loadError: null,
    })
  },

  setLoadError: (message) => {
    set({
      loadStatus: 'error',
      loadError: message,
    })
  },

  setRunError: (message) => {
    set({
      runError: message,
      error: message,
    })
  },

  loadThread: (thread) => {
    set((state) => loadThreadIntoData(state, thread))
  },

  reset: () => {
    set(createEmptyAgentChatData())
  },

  addOptimisticUserMessage: (message, activeRun) => {
    set((state) => applyOptimisticUserMessage(state, message, activeRun))
  },

  startEditedUserMessageRun: (input) => {
    set((state) => applyEditedUserMessage(state, input))
  },

  markRunStarted: ({ runId, threadId }) => {
    set((state) => ({
      activeRun:
        state.activeRun === null
          ? {
              runId,
              threadId,
              startedAt: Date.now(),
              optimisticUserMessageId: null,
            }
          : { ...state.activeRun, runId, threadId },
    }))
  },

  bufferRuntimeEvent: (event) => {
    set((state) => ({
      pendingDeltaBuffer: [...state.pendingDeltaBuffer, event],
    }))
  },

  flushBufferedRuntimeEvents: () => {
    const events = get().pendingDeltaBuffer
    if (events.length === 0) {
      return
    }

    set((state) => {
      let next: AgentChatData = { ...state, pendingDeltaBuffer: [] }
      for (const event of coalesceDeltaEvents(events)) {
        next = applyAgentRuntimeEvent(next, event)
      }
      return next
    })
  },

  applyRuntimeEvent: (event) => {
    set((state) => applyAgentRuntimeEvent(state, event))
  },

  finishRun: () => {
    set((state) => ({
      activeRun: null,
      activeCompactionItemIds: [],
      streamingMessageIds: [],
      pendingDeltaBuffer: [],
      runError: null,
      error: null,
      activeTurn:
        state.activeTurn === null || state.activeTurn.completedAt !== null
          ? state.activeTurn
          : {
              ...state.activeTurn,
              status: 'completed',
              completedAt: Date.now(),
            },
    }))
  },

  failRun: (message) => {
    set({
      activeRun: null,
      activeCompactionItemIds: [],
      streamingMessageIds: [],
      pendingDeltaBuffer: [],
      runError: message,
      error: message,
    })
  },
}))
