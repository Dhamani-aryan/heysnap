import { useEffect } from 'react'
import { closeActiveAgentRun } from '../../lib/agent/agent-run-controller.ts'
import {
  setActiveAgentBaseUrl,
  useAgentChatStore,
} from '../../stores/agent/agent-chat-store.ts'
import { useAgentThreadListStore } from '../../stores/agent/agent-thread-list-store.ts'

type Options = {
  agentBaseUrl: string | null | undefined
}

export function useAgentConnection({ agentBaseUrl }: Options): void {
  const normalized = agentBaseUrl ?? null
  if (useAgentChatStore.getState().agentBaseUrl !== normalized) {
    setActiveAgentBaseUrl(normalized)
  }

  useEffect(() => {
    if (!agentBaseUrl) return

    return () => {
      closeActiveAgentRun()
      setActiveAgentBaseUrl(null)
      useAgentChatStore.getState().reset()
      useAgentThreadListStore.getState().reset()
    }
  }, [agentBaseUrl])
}
