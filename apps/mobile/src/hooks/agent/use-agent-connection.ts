import { useEffect } from 'react'
import { closeActiveAgentRun } from '../../lib/agent/agent-run-controller'
import {
  setActiveAgentConnection,
  useAgentChatStore,
} from '../../stores/agent/agent-chat-store'
import { useAgentThreadListStore } from '../../stores/agent/agent-thread-list-store'

type Options = {
  agentBaseUrl: string | null | undefined
  agentIdentity: string | null | undefined
}

export function useAgentConnection({
  agentBaseUrl,
  agentIdentity,
}: Options): void {
  const normalized = agentBaseUrl ?? null
  const normalizedIdentity = agentIdentity ?? null

  useEffect(() => {
    const previousIdentity = useAgentChatStore.getState().agentIdentity
    if (
      normalizedIdentity !== null &&
      previousIdentity !== null &&
      previousIdentity !== normalizedIdentity
    ) {
      closeActiveAgentRun()
      useAgentChatStore.getState().reset()
      useAgentThreadListStore.getState().reset()
    }

    setActiveAgentConnection({
      agentBaseUrl: normalized,
      agentIdentity: normalizedIdentity,
    })
  }, [normalized, normalizedIdentity])
}
