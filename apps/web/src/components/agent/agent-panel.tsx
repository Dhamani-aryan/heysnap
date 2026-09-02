import { useCallback } from 'react'
import { useAgentEditMessage } from '../../hooks/agent/use-agent-edit-message.ts'
import { useAgentUiContext } from '../../hooks/agent/use-agent-ui-context.ts'
import { useAgentThread } from '../../hooks/agent/use-agent-thread.ts'
import { useAgentThreadRoute } from '../../hooks/agent/use-agent-thread-route.ts'
import { useAgentChatStore } from '../../stores/agent/agent-chat-store.ts'
import { useFilesystemStore } from '../../stores/filesystem/filesystem-store.ts'
import { AgentPromptInputContainer } from './agent-prompt-input-container.tsx'
import { AgentTimeline } from './agent-timeline.tsx'

type Props = {
  readonly showPrompt?: boolean
  readonly onOpenWorkspacePath?: (path: string) => void
  readonly onOpenChromeTab?: (tabId: number) => void
}

export function AgentPanel({
  showPrompt = true,
  onOpenWorkspacePath,
  onOpenChromeTab,
}: Props = {}) {
  const agentBaseUrl = useAgentChatStore((s) => s.agentBaseUrl)
  const agentIdentity = useAgentChatStore((s) => s.agentIdentity)
  const selectedThreadId = useAgentChatStore((s) => s.selectedThreadId)
  const hasMessages = useAgentChatStore((s) => s.messageOrder.length > 0)
  const activeRun = useAgentChatStore((s) => s.activeRun)
  const loadStatus = useAgentChatStore((s) => s.loadStatus)
  const loadError = useAgentChatStore((s) => s.loadError)
  const currentPath = useFilesystemStore((s) => s.currentPath)
  const { navigateToThread } = useAgentThreadRoute()
  const uiContext = useAgentUiContext()

  const handleThreadResolved = useCallback(
    (threadId: string) => {
      if (selectedThreadId !== threadId) {
        navigateToThread(threadId, { replace: true })
      }
    },
    [navigateToThread, selectedThreadId],
  )

  useAgentThread(selectedThreadId, {
    agentBaseUrl: agentBaseUrl ?? '',
    agentIdentity: agentIdentity ?? '',
    onThreadResolved: handleThreadResolved,
  })

  const editMessage = useAgentEditMessage({
    agentBaseUrl: agentBaseUrl ?? '',
    agentIdentity: agentIdentity ?? '',
    currentPath,
    uiContext,
    selectedThreadId,
    onThreadResolved: handleThreadResolved,
  })

  const isRunning = activeRun !== null

  if (selectedThreadId === null && !hasMessages && !isRunning) {
    return (
      <div className="flex h-full flex-col">
        <div className="pointer-events-auto flex flex-1 items-center justify-center px-[20px]">
          <p className="m-0 text-center text-[20px] font-medium leading-[1.35] tracking-[-0.01em] text-heading">
            Let's get some shit done today
          </p>
        </div>
        {showPrompt ? (
          <div className="pointer-events-auto px-[10px] pb-[10px] pt-[8px]">
            <AgentPromptInputContainer onThreadResolved={handleThreadResolved} />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="right-prompt-surface">
      <div className="agent-thread-scroll">
        {loadError !== null ? (
          <div className="agent-panel-state error">{loadError}</div>
        ) : null}
        {(loadStatus !== 'loading' || hasMessages) && loadError === null ? (
          <AgentTimeline
            currentPath={currentPath}
            onOpenChromeTab={onOpenChromeTab}
            onOpenFilePath={onOpenWorkspacePath}
            onSubmitUserMessageEdit={editMessage.submit}
          />
        ) : null}
      </div>
      {showPrompt ? (
        <div className="pointer-events-auto px-[10px] pb-[10px] pt-[8px]">
          <AgentPromptInputContainer onThreadResolved={handleThreadResolved} />
        </div>
      ) : null}
    </div>
  )
}
