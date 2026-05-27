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
  useEffect(() => {
    if (!agentBaseUrl) return

    setActiveAgentBaseUrl(agentBaseUrl)

    return () => {
      closeActiveAgentRun()
      setActiveAgentBaseUrl(null)
      useAgentChatStore.getState().reset()
      useAgentThreadListStore.getState().reset()
    }
  }, [agentBaseUrl])
}
