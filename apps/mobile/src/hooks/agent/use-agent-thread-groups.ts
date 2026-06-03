import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { retrieveAgentThreadGroups } from '../../lib/agent/agent-client'
import { agentQueryKeys } from '../../lib/agent/agent-queries'
import {
  selectHasStreamingThreads,
  useAgentThreadListStore,
} from '../../stores/agent/agent-thread-list-store'

type Options = {
  agentBaseUrl: string
  agentIdentity: string
  enabled?: boolean
}

const STREAMING_POLL_INTERVAL_MS = 2000

export function useAgentThreadGroups({
  agentBaseUrl,
  agentIdentity,
  enabled = true,
}: Options) {
  const hasStreamingThreads = useAgentThreadListStore(selectHasStreamingThreads)
  const isEnabled =
    enabled && agentBaseUrl.length > 0 && agentIdentity.length > 0

  const query = useQuery({
    queryKey: agentQueryKeys.threadGroups(agentIdentity),
    queryFn: () => retrieveAgentThreadGroups(agentBaseUrl),
    enabled: isEnabled,
    refetchInterval:
      isEnabled && hasStreamingThreads ? STREAMING_POLL_INTERVAL_MS : false,
  })

  useEffect(() => {
    if (!isEnabled) return
    useAgentThreadListStore.getState().setLoading(query.isFetching)
  }, [isEnabled, query.isFetching])

  useEffect(() => {
    if (query.data === undefined) return
    useAgentThreadListStore.getState().replaceGroups(query.data)
  }, [query.data])

  useEffect(() => {
    if (!query.isError) return
    useAgentThreadListStore
      .getState()
      .setError(
        query.error instanceof Error
          ? query.error.message
          : 'Failed to load chats.',
      )
  }, [query.error, query.isError])

  return query
}
