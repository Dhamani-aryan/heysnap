import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useAgentChatStore } from '../../stores/agent/agent-chat-store.ts'

function decodeRouteParam(value: string | undefined): string | null {
  if (value === undefined) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function useAgentThreadRoute() {
  const params = useParams({ strict: false }) as {
    computerId?: string
    threadId?: string
  }
  const navigate = useNavigate()

  const computerId = params.computerId ?? null
  const threadId = useMemo(() => decodeRouteParam(params.threadId), [params.threadId])

  useEffect(() => {
    useAgentChatStore.getState().setSelectedThreadId(threadId)
  }, [threadId])

  const navigateToThread = useCallback(
    (nextThreadId: string, options: { replace?: boolean } = {}) => {
      if (computerId === null) return
      const encoded = encodeURIComponent(nextThreadId)
      void navigate({
        to: '/machines/$computerId/$threadId',
        params: { computerId, threadId: encoded },
        replace: options.replace ?? false,
      })
    },
    [computerId, navigate],
  )

  const navigateToNewThread = useCallback(
    (options: { replace?: boolean } = {}) => {
      if (computerId === null) return
      void navigate({
        to: '/machines/$computerId',
        params: { computerId },
        replace: options.replace ?? false,
      })
    },
    [computerId, navigate],
  )

  return useMemo(
    () => ({ computerId, threadId, navigateToThread, navigateToNewThread }),
    [computerId, threadId, navigateToThread, navigateToNewThread],
  )
}
