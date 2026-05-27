import { useCallback } from 'react'
import { useAgentRun } from '../../hooks/agent/use-agent-run.ts'
import { useAgentChatStore } from '../../stores/agent/agent-chat-store.ts'
import { useFilesystemStore } from '../../stores/filesystem/filesystem-store.ts'
import type { AgentContent, AgentThreadSummary } from '../../lib/agent/types.ts'
import { PromptInput } from './prompt-input.tsx'

type Props = {
  onThreadResolved?: (threadId: string) => void
}

export function AgentPromptInputContainer({ onThreadResolved }: Props = {}) {
  const agentBaseUrl = useAgentChatStore((s) => s.agentBaseUrl)
  const selectedThreadId = useAgentChatStore((s) => s.selectedThreadId)
  const activeRun = useAgentChatStore((s) => s.activeRun)
  const currentPath = useFilesystemStore((s) => s.currentPath)
  const activeFolderName = useFilesystemStore(
    (s) => s.listing?.name ?? 'workspace',
  )

  const handleSelectThread = useCallback(
    (thread: AgentThreadSummary) => {
      onThreadResolved?.(thread.id)
    },
    [onThreadResolved],
  )

  const agentRun = useAgentRun({
    agentBaseUrl: agentBaseUrl ?? '',
    currentPath,
    selectedThreadId,
    onSelectThread: handleSelectThread,
    onThreadResolved,
  })

  const handleSubmit = useCallback(
    (input: { content: AgentContent }): boolean => {
      if (agentBaseUrl === null) return false
      return agentRun.submit(input)
    },
    [agentBaseUrl, agentRun],
  )

  const isRunning = activeRun !== null

  return (
    <PromptInput
      threadId={selectedThreadId}
      activeFolderName={activeFolderName}
      isRunning={isRunning}
      onSubmit={handleSubmit}
      onCancel={agentRun.cancel}
    />
  )
}
