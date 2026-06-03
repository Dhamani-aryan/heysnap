import { useCallback, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { editAgentThreadUserMessage } from '../../lib/agent/agent-client'
import {
  dispatchAgentRuntimeEvent,
  flushBufferedAgentEvents,
} from '../../lib/agent/agent-event-dispatcher'
import { agentQueryKeys } from '../../lib/agent/agent-queries'
import {
  getActiveAgentRunHandle,
  setActiveAgentRunHandle,
} from '../../lib/agent/agent-run-controller'
import type {
  AgentContent,
  AgentThreadSummary,
  AgentUiContext,
} from '../../lib/agent/types'
import type { ActiveRunState } from '../../lib/agent/agent-events'
import {
  getActiveAgentBaseUrl,
  useAgentChatStore,
} from '../../stores/agent/agent-chat-store'
import { useAgentThreadListStore } from '../../stores/agent/agent-thread-list-store'

type Options = {
  agentBaseUrl: string
  agentIdentity: string
  currentPath: string
  uiContext?: AgentUiContext
  selectedThreadId: string | null
  onSelectThread?: (thread: AgentThreadSummary) => void
  onThreadResolved?: (threadId: string) => void
}

type SubmitInput = {
  readonly messageId: string
  readonly content: AgentContent
}

export function useAgentEditMessage({
  agentBaseUrl,
  agentIdentity,
  currentPath,
  uiContext,
  selectedThreadId,
  onSelectThread,
  onThreadResolved,
}: Options) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async ({ messageId, content }: SubmitInput) => {
      if (getActiveAgentRunHandle() !== null) {
        throw new Error('An agent run is already active.')
      }

      if (selectedThreadId === null) {
        throw new Error('A thread must be selected to edit a message.')
      }

      const startedAt = Date.now()
      const optimisticRun: ActiveRunState = {
        runId: null,
        threadId: selectedThreadId,
        startedAt,
        optimisticUserMessageId: messageId,
      }
      let latestThreadSummary: AgentThreadSummary | null = null

      useAgentChatStore.getState().setRunError(null)
      useAgentChatStore.getState().startEditedUserMessageRun({
        messageId,
        content,
        activeRun: optimisticRun,
      })

      const handle = editAgentThreadUserMessage(
        () => getActiveAgentBaseUrl() ?? agentBaseUrl,
        {
          threadId: selectedThreadId,
          path: currentPath,
          content,
          uiContext,
        },
        {
          onRunStart: ({ runId, threadId }) => {
            useAgentChatStore.getState().markRunStarted({ runId, threadId })
            useAgentThreadListStore
              .getState()
              .setThreadStreaming(threadId, true)
            onThreadResolved?.(threadId)
            void queryClient.invalidateQueries({
              queryKey: agentQueryKeys.threadGroups(agentIdentity),
            })
          },
          onEvent: (event) => {
            if (
              event.type === 'thread.created' ||
              event.type === 'thread.updated'
            ) {
              latestThreadSummary = event.thread
            }
            dispatchAgentRuntimeEvent(event, { onThreadResolved })
          },
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

            if (latestThreadSummary !== null) {
              useAgentThreadListStore
                .getState()
                .upsertThread({ ...latestThreadSummary, isStreaming: false })
              onSelectThread?.({ ...latestThreadSummary, isStreaming: false })
            }
          },
          onError: (error) => {
            const failedThreadId =
              useAgentChatStore.getState().activeRun?.threadId
            flushBufferedAgentEvents()
            useAgentChatStore.getState().failRun(error.message)
            if (failedThreadId !== undefined && failedThreadId !== null) {
              useAgentThreadListStore
                .getState()
                .setThreadStreaming(failedThreadId, false)
            }
          },
        },
      )

      setActiveAgentRunHandle(handle)
      await handle.done
    },
    onSettled: () => {
      setActiveAgentRunHandle(null)
      void queryClient.invalidateQueries({
        queryKey: agentQueryKeys.threadGroups(agentIdentity),
      })
      if (selectedThreadId !== null) {
        void queryClient.invalidateQueries({
          queryKey: agentQueryKeys.thread(agentIdentity, selectedThreadId),
        })
      }
    },
  })

  const submit = useCallback(
    (input: SubmitInput): boolean => {
      if (getActiveAgentRunHandle() !== null || selectedThreadId === null) {
        return false
      }
      mutation.mutate(input)
      return true
    },
    [mutation, selectedThreadId],
  )

  return useMemo(() => ({ submit, mutation }), [submit, mutation])
}
