import { useCallback } from 'react'
import { useAuth } from '../../hooks/auth/use-auth.ts'
import { useAgentRun } from '../../hooks/agent/use-agent-run.ts'
import { useAgentChatStore } from '../../stores/agent/agent-chat-store.ts'
import { useAgentModelSelectionStore } from '../../stores/agent/agent-model-selection-store.ts'
import { useAgentPromptFocusStore } from '../../stores/agent/agent-prompt-focus-store.ts'
import { useFilesystemStore } from '../../stores/filesystem/filesystem-store.ts'
import {
  getNewThreadModelSelection,
  getThreadModelChoice,
} from '../../lib/agent/model-selection.ts'
import type { AgentContent, AgentThreadSummary } from '../../lib/agent/types.ts'
import { PromptInput } from './prompt-input.tsx'

type Props = {
  onThreadResolved?: (threadId: string) => void
  autoFocus?: boolean
}

export function AgentPromptInputContainer({
  onThreadResolved,
  autoFocus = false,
}: Props = {}) {
  const auth = useAuth()
  const agentBaseUrl = useAgentChatStore((s) => s.agentBaseUrl)
  const selectedThreadId = useAgentChatStore((s) => s.selectedThreadId)
  const activeRun = useAgentChatStore((s) => s.activeRun)
  const promptModelChoice = useAgentModelSelectionStore(
    (s) => s.promptModelChoice,
  )
  const setPromptModelChoice = useAgentModelSelectionStore(
    (s) => s.setPromptModelChoice,
  )
  const autoFocusToken = useAgentPromptFocusStore((s) => s.focusToken)
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

  const isRunning = activeRun !== null
  const allowModelSelection = auth.user?.allowPiModels === true
  const canChangeModel =
    allowModelSelection && selectedThreadId === null && !isRunning

  const handleSubmit = useCallback(
    (input: {
      content: AgentContent
    }): boolean | Promise<boolean> => {
      if (agentBaseUrl === null) return false
      if (isRunning) return agentRun.steer(input)
      return agentRun.submit({
        ...input,
        ...getNewThreadModelSelection({
          allowModelSelection,
          selectedThreadId,
          promptModelChoice,
        }),
      })
    },
    [
      agentBaseUrl,
      agentRun,
      allowModelSelection,
      isRunning,
      promptModelChoice,
      selectedThreadId,
    ],
  )

  return (
    <PromptInput
      threadId={selectedThreadId}
      activeFolderName={activeFolderName}
      isRunning={isRunning}
      autoFocus={autoFocus}
      autoFocusToken={autoFocusToken}
      modelPicker={
        allowModelSelection
          ? {
              value:
                selectedThreadId === null
                  ? promptModelChoice
                  : getThreadModelChoice(selectedThreadId),
              disabled: !canChangeModel,
              onChange: setPromptModelChoice,
            }
          : undefined
      }
      onSubmit={handleSubmit}
      onCancel={agentRun.cancel}
    />
  )
}
