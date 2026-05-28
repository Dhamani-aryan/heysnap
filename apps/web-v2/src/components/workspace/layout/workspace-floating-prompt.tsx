import { useCallback } from 'react'
import { useAgentThreadRoute } from '../../../hooks/agent/use-agent-thread-route.ts'
import { useAgentChatStore } from '../../../stores/agent/agent-chat-store.ts'
import {
  selectPromptDraft,
  useAgentPromptDraftStore,
} from '../../../stores/agent/agent-prompt-draft-store.ts'
import { AgentPromptInputContainer } from '../../agent/agent-prompt-input-container.tsx'
import { useWorkspaceLayout } from './use-workspace-layout.ts'

export function WorkspaceFloatingPrompt() {
  const { isRightSidebarOpen } = useWorkspaceLayout()
  const selectedThreadId = useAgentChatStore((s) => s.selectedThreadId)
  const draft = useAgentPromptDraftStore(selectPromptDraft(selectedThreadId))
  const { navigateToThread } = useAgentThreadRoute()

  const handleThreadResolved = useCallback(
    (threadId: string) => {
      if (selectedThreadId !== threadId) {
        navigateToThread(threadId, { replace: true })
      }
    },
    [navigateToThread, selectedThreadId],
  )

  const hasContent = draft.text.length > 0 || draft.attachments.length > 0

  if (isRightSidebarOpen || !hasContent) return null

  return (
    <div className="workspace-floating-prompt">
      <AgentPromptInputContainer
        onThreadResolved={handleThreadResolved}
        autoFocus
      />
    </div>
  )
}
