import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { retrieveAgentThreadGroups } from '../../lib/agent/agent-client.ts'
import { agentQueryKeys } from '../../lib/agent/agent-queries.ts'
import {
  selectHasStreamingThreads,
  useAgentThreadListStore,
} from '../../stores/agent/agent-thread-list-store.ts'

type Options = {
  agentBaseUrl: string
  enabled?: boolean
}

const STREAMING_POLL_INTERVAL_MS = 2000

export function useAgentThreadGroups({
  agentBaseUrl,
  enabled = true,
}: Options) {
  const hasStreamingThreads = useAgentThreadListStore(selectHasStreamingThreads)

  const query = useQuery({
    queryKey: agentQueryKeys.threadGroups(agentBaseUrl),
    queryFn: () => retrieveAgentThreadGroups(agentBaseUrl),
    enabled,
    refetchInterval:
      enabled && hasStreamingThreads ? STREAMING_POLL_INTERVAL_MS : false,
  })

  useEffect(() => {
    if (!enabled) return
    useAgentThreadListStore.getState().setLoading(query.isFetching)
  }, [enabled, query.isFetching])

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
