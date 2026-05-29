import { useCallback, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  startAgentRun,
  steerAgentRun,
} from '../../lib/agent/agent-client.ts'
import {
  dispatchAgentRuntimeEvent,
  flushBufferedAgentEvents,
} from '../../lib/agent/agent-event-dispatcher.ts'
import { agentQueryKeys } from '../../lib/agent/agent-queries.ts'
import {
  getActiveAgentRunHandle,
  setActiveAgentRunHandle,
} from '../../lib/agent/agent-run-controller.ts'
import type {
  AgentContent,
  AgentHarnessName,
  AgentThreadSummary,
  AgentUiContext,
  UserMessage,
} from '../../lib/agent/types.ts'
import type { ActiveRunState } from '../../lib/agent/agent-events.ts'
import { useAgentChatStore } from '../../stores/agent/agent-chat-store.ts'
import { useAgentThreadListStore } from '../../stores/agent/agent-thread-list-store.ts'

type Options = {
  agentBaseUrl: string
  currentPath: string
  uiContext?: AgentUiContext
  selectedThreadId: string | null
  onSelectThread?: (thread: AgentThreadSummary) => void
  onThreadResolved?: (threadId: string) => void
}

type SubmitInput = {
  readonly content: AgentContent
  readonly harness?: AgentHarnessName
  readonly provider?: string
  readonly model?: string
}

export function useAgentRun({
  agentBaseUrl,
  currentPath,
  uiContext,
  selectedThreadId,
  onSelectThread,
  onThreadResolved,
}: Options) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (input: SubmitInput) => {
      if (getActiveAgentRunHandle() !== null) {
        throw new Error('An agent run is already active.')
      }

      const startedAt = Date.now()
      const optimisticUserMessage = createOptimisticUserMessage(
        input.content,
        currentPath,
        startedAt,
      )
      const optimisticRun: ActiveRunState = {
        runId: null,
        threadId: selectedThreadId,
        startedAt,
        optimisticUserMessageId: optimisticUserMessage.id,
      }
      let latestThreadSummary: AgentThreadSummary | null = null

      useAgentChatStore.getState().setRunError(null)
      useAgentChatStore
        .getState()
        .addOptimisticUserMessage(optimisticUserMessage, optimisticRun)

      const handle = startAgentRun(
        agentBaseUrl,
        {
          threadId: selectedThreadId ?? undefined,
          path: currentPath,
          content: input.content,
          uiContext,
          harness: input.harness,
          provider: input.provider,
          model: input.model,
        },
        {
          onRunStart: ({ runId, threadId }) => {
            useAgentChatStore.getState().markRunStarted({ runId, threadId })
            useAgentThreadListStore
              .getState()
              .setThreadStreaming(threadId, true)
            onThreadResolved?.(threadId)
            void queryClient.invalidateQueries({
              queryKey: agentQueryKeys.threadGroups(agentBaseUrl),
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
            toast.error(error.message)
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
        queryKey: agentQueryKeys.threadGroups(agentBaseUrl),
      })
    },
  })

  const submit = useCallback(
    (input: SubmitInput): boolean => {
      if (getActiveAgentRunHandle() !== null) return false
      mutation.mutate(input)
      return true
    },
    [mutation],
  )

  const cancel = useCallback((): void => {
    getActiveAgentRunHandle()?.cancel()
  }, [])

  const steer = useCallback(
    async (input: { readonly content: AgentContent }): Promise<boolean> => {
      const activeRun = useAgentChatStore.getState().activeRun

      if (
        getActiveAgentRunHandle() === null ||
        activeRun?.threadId === undefined ||
        activeRun.threadId === null ||
        activeRun.runId === null
      ) {
        useAgentChatStore
          .getState()
          .setRunError('The active turn is not ready for steering yet.')
        return false
      }

      try {
        useAgentChatStore.getState().setRunError(null)
        await steerAgentRun(agentBaseUrl, {
          threadId: activeRun.threadId,
          runId: activeRun.runId,
          path: currentPath,
          content: input.content,
          uiContext,
        })
        return true
      } catch (error) {
        useAgentChatStore
          .getState()
          .setRunError(
            error instanceof Error
              ? error.message
              : 'Failed to steer the active turn.',
          )
        return false
      }
    },
    [agentBaseUrl, currentPath, uiContext],
  )

  return useMemo(
    () => ({ submit, cancel, steer, mutation }),
    [submit, cancel, steer, mutation],
  )
}

function createOptimisticUserMessage(
  content: AgentContent,
  path: string,
  timestamp: number,
): UserMessage {
  return {
    role: 'user',
    id: `optimistic-user-${String(timestamp)}`,
    timestamp,
    content,
    path,
  }
}
