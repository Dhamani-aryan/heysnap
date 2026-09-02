import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import {
  getActiveAgentBaseUrl,
  useAgentChatStore,
} from '../../stores/agent/agent-chat-store.ts'
import { useAgentThreadListStore } from '../../stores/agent/agent-thread-list-store.ts'

type Options = {
  agentBaseUrl: string
  agentIdentity: string
  onThreadResolved?: (threadId: string) => void
}

export function useAgentThread(
  threadId: string | null,
  { agentBaseUrl, agentIdentity, onThreadResolved }: Options,
) {
  const queryClient = useQueryClient()
  const enabled =
    threadId !== null && agentBaseUrl.length > 0 && agentIdentity.length > 0
  const invalidateThread = useCallback(
    (targetThreadId: string | null | undefined): void => {
      if (targetThreadId === undefined || targetThreadId === null) {
        return
      }

      void queryClient.invalidateQueries({
        queryKey: agentQueryKeys.thread(agentIdentity, targetThreadId),
      })
    },
    [agentIdentity, queryClient],
  )

  const query = useQuery({
    queryKey: agentQueryKeys.thread(agentIdentity, threadId),
    queryFn: async (): Promise<GetAgentThreadResult> => {
      if (threadId === null) {
        throw new Error('Thread id is required.')
      }
      return getAgentThread(agentBaseUrl, threadId)
    },
    enabled,
  })

  useEffect(() => {
    const chatStore = useAgentChatStore.getState()

    if (threadId === null) {
      closeActiveAgentRun()
      flushBufferedAgentEvents()
      if (
        chatStore.selectedThreadId !== null ||
        chatStore.messageOrder.length > 0 ||
        chatStore.activeRun !== null
      ) {
        chatStore.reset()
      }
      return
    }

    const activeRun = chatStore.activeRun
    if (getActiveAgentRunHandle() !== null && activeRun?.threadId === threadId) {
      return
    }

    if (
      chatStore.selectedThreadId === threadId &&
      (chatStore.messageOrder.length > 0 ||
        chatStore.loadStatus === 'success' ||
        chatStore.loadStatus === 'loading')
    ) {
      return
    }

    closeActiveAgentRun()
    flushBufferedAgentEvents()
    chatStore.reset()
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

    const handle = resumeAgentRun(
      () => getActiveAgentBaseUrl() ?? agentBaseUrl,
      query.data.activeRun,
      {
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
        onEvent: (event) =>
          dispatchAgentRuntimeEvent(event, { onThreadResolved }),
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
          void queryClient.invalidateQueries({
            queryKey: agentQueryKeys.threadGroups(agentIdentity),
          })
          invalidateThread(completedThreadId)
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
          void queryClient.invalidateQueries({
            queryKey: agentQueryKeys.threadGroups(agentIdentity),
          })
          invalidateThread(failedThreadId)
        },
      },
    )

    setActiveAgentRunHandle(handle)
    void handle.done.catch(() => {
      // Errors are already projected to the store via onError above.
    })
  }, [
    agentBaseUrl,
    agentIdentity,
    invalidateThread,
    onThreadResolved,
    query.data,
    queryClient,
    threadId,
  ])

  useEffect(() => {
    if (!enabled || threadId === null) {
      return
    }

    const invalidateWhenIdle = (): void => {
      if (
        document.visibilityState === 'hidden' ||
        getActiveAgentRunHandle() !== null
      ) {
        return
      }

      invalidateThread(threadId)
    }

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        invalidateWhenIdle()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', invalidateWhenIdle)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', invalidateWhenIdle)
    }
  }, [enabled, invalidateThread, threadId])

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
