import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getAgentThread,
  resumeAgentRun,
  type GetAgentThreadResult,
} from '../../lib/agent/agent-client.ts'
import {
  dispatchAgentRuntimeEvent,
  flushBufferedAgentEvents,
} from '../../lib/agent/agent-event-dispatcher.ts'
import { agentQueryKeys } from '../../lib/agent/agent-queries.ts'
import {
  closeActiveAgentRun,
  getActiveAgentRunHandle,
  setActiveAgentRunHandle,
} from '../../lib/agent/agent-run-controller.ts'
import { useAgentChatStore } from '../../stores/agent/agent-chat-store.ts'
import { useAgentThreadListStore } from '../../stores/agent/agent-thread-list-store.ts'

type Options = {
  agentBaseUrl: string
  onThreadResolved?: (threadId: string) => void
}

export function useAgentThread(
  threadId: string | null,
  { agentBaseUrl, onThreadResolved }: Options,
) {
  const enabled = threadId !== null && agentBaseUrl.length > 0

  const query = useQuery({
    queryKey: agentQueryKeys.thread(agentBaseUrl, threadId),
    queryFn: async (): Promise<GetAgentThreadResult> => {
      if (threadId === null) {
        throw new Error('Thread id is required.')
      }
      return getAgentThread(agentBaseUrl, threadId)
    },
    enabled,
  })

  useEffect(() => {
    if (threadId === null) {
      closeActiveAgentRun()
      flushBufferedAgentEvents()
      useAgentChatStore.getState().reset()
      return
    }

    const activeRun = useAgentChatStore.getState().activeRun
    if (getActiveAgentRunHandle() !== null && activeRun?.threadId === threadId) {
      return
    }

    closeActiveAgentRun()
    flushBufferedAgentEvents()
    useAgentChatStore.getState().reset()
    useAgentChatStore.getState().setThreadLoading(threadId)
  }, [threadId])

  useEffect(() => {
    if (query.data === undefined || threadId === null) {
      return
    }

    const activeRun = useAgentChatStore.getState().activeRun
    const hasLiveSelectedThreadRun =
      getActiveAgentRunHandle() !== null &&
      activeRun?.threadId === query.data.thread.id

    if (!hasLiveSelectedThreadRun) {
      useAgentChatStore.getState().loadThread(query.data.thread)
    }

    useAgentThreadListStore.getState().upsertThread(query.data.thread)

    if (
      hasLiveSelectedThreadRun ||
      query.data.activeRun === undefined ||
      getActiveAgentRunHandle() !== null
    ) {
      return
    }

    const handle = resumeAgentRun(agentBaseUrl, query.data.activeRun, {
      onRunStart: ({ runId, threadId: resolvedThreadId }) => {
        useAgentChatStore.getState().markRunStarted({
          runId,
          threadId: resolvedThreadId,
        })
        useAgentThreadListStore
          .getState()
          .setThreadStreaming(resolvedThreadId, true)
        onThreadResolved?.(resolvedThreadId)
      },
      onEvent: (event) => dispatchAgentRuntimeEvent(event, { onThreadResolved }),
      onRunEnd: () => {
        const completedThreadId =
          useAgentChatStore.getState().activeRun?.threadId
        flushBufferedAgentEvents()
        useAgentChatStore.getState().finishRun()
        if (completedThreadId !== undefined && completedThreadId !== null) {
          useAgentThreadListStore
            .getState()
            .setThreadStreaming(completedThreadId, false)
        }
        setActiveAgentRunHandle(null)
      },
      onError: (error) => {
        const failedThreadId = useAgentChatStore.getState().activeRun?.threadId
        flushBufferedAgentEvents()
        useAgentChatStore.getState().failRun(error.message)
        if (failedThreadId !== undefined && failedThreadId !== null) {
          useAgentThreadListStore
            .getState()
            .setThreadStreaming(failedThreadId, false)
        }
        setActiveAgentRunHandle(null)
      },
    })

    setActiveAgentRunHandle(handle)
    void handle.done.catch(() => {
      // Errors are already projected to the store via onError above.
    })
  }, [agentBaseUrl, onThreadResolved, query.data, threadId])

  useEffect(() => {
    if (!query.isError) return
    useAgentChatStore
      .getState()
      .setLoadError(
        query.error instanceof Error
          ? query.error.message
          : 'Failed to load thread.',
      )
  }, [query.error, query.isError])

  return query
}
