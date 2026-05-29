import { toast } from 'sonner'
import { useAgentChatStore } from '../../stores/agent/agent-chat-store.ts'
import { useAgentThreadListStore } from '../../stores/agent/agent-thread-list-store.ts'
import {
  cancelDeltaFlush,
  scheduleDeltaFlush,
} from './agent-run-controller.ts'
import type { AgentRunEvent } from './types.ts'

type DispatcherOptions = {
  readonly onThreadResolved?: (threadId: string) => void
}

export function flushBufferedAgentEvents(): void {
  cancelDeltaFlush()
  useAgentChatStore.getState().flushBufferedRuntimeEvents()
}

export function dispatchAgentRuntimeEvent(
  event: AgentRunEvent,
  options: DispatcherOptions = {},
): void {
  if (event.type === 'thread.created' || event.type === 'thread.updated') {
    const activeRun = useAgentChatStore.getState().activeRun
    useAgentThreadListStore.getState().upsertThread({
      ...event.thread,
      isStreaming:
        activeRun?.threadId === event.thread.id ||
        event.thread.isStreaming === true,
    })
    options.onThreadResolved?.(event.thread.id)
  }

  if (event.type === 'runtime.error') {
    toast.error(event.error.message)
  }

  if (event.type === 'content.delta') {
    useAgentChatStore.getState().bufferRuntimeEvent(event)
    scheduleDeltaFlush(() => {
      useAgentChatStore.getState().flushBufferedRuntimeEvents()
    })
    return
  }

  flushBufferedAgentEvents()
  useAgentChatStore.getState().applyRuntimeEvent(event)
}
