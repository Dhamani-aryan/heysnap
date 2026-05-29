import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAgentThreadRoute } from '../../../hooks/agent/use-agent-thread-route.ts'
import { getAssistantMarkdown } from '../../../lib/agent/agent-events.ts'
import type { AgentMessage } from '../../../lib/agent/types.ts'
import { useAgentChatStore } from '../../../stores/agent/agent-chat-store.ts'
import {
  selectPromptDraft,
  useAgentPromptDraftStore,
} from '../../../stores/agent/agent-prompt-draft-store.ts'
import { useFilesystemStore } from '../../../stores/filesystem/filesystem-store.ts'
import { AgentPromptInputContainer } from '../../agent/agent-prompt-input-container.tsx'
import { useWorkspaceLayout } from './use-workspace-layout.ts'

const ChatMarkdown = lazy(() =>
  import('../../agent/chat-markdown.tsx').then((module) => ({
    default: module.ChatMarkdown,
  })),
)

type AgentStatusResponse = {
  readonly id: string
  readonly markdown: string
  readonly isStreaming: boolean
}

export function WorkspaceBottomCenterStack() {
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
  const hasPromptContent = draft.text.length > 0 || draft.attachments.length > 0

  if (isRightSidebarOpen) return null

  return (
    <div
      className="workspace-bottom-center-stack"
      data-with-prompt={hasPromptContent ? 'true' : 'false'}
    >
      <WorkspaceAgentStatus />
      {hasPromptContent ? (
        <div className="workspace-floating-prompt">
          <AgentPromptInputContainer
            autoFocus
            onThreadResolved={handleThreadResolved}
          />
        </div>
      ) : null}
    </div>
  )
}

function WorkspaceAgentStatus() {
  const activeRun = useAgentChatStore((s) => s.activeRun)
  const messageOrder = useAgentChatStore((s) => s.messageOrder)
  const messagesById = useAgentChatStore((s) => s.messagesById)
  const streamingMessageIds = useAgentChatStore((s) => s.streamingMessageIds)
  const currentPath = useFilesystemStore((s) => s.currentPath)
  const latestAssistantResponse = useMemo<AgentStatusResponse | null>(() => {
    if (activeRun === null) return null

    const lastUserMessageIndex = findLastUserMessageIndex(
      messageOrder,
      messagesById,
    )
    let latestResponse: AgentStatusResponse | null = null

    for (const messageId of messageOrder.slice(lastUserMessageIndex + 1)) {
      const message = messagesById[messageId]
      if (message?.role !== 'assistant') continue

      const markdown = getAssistantMarkdown(message)
      if (markdown.length === 0) continue

      latestResponse = {
        id: messageId,
        markdown,
        isStreaming: streamingMessageIds.includes(messageId),
      }
    }

    return latestResponse
  }, [activeRun, messageOrder, messagesById, streamingMessageIds])

  const isAgentRunning = activeRun !== null
  const [retainedAssistantResponse, setRetainedAssistantResponse] =
    useState<AgentStatusResponse | null>(null)
  const latestAssistantResponseRef = useRef<AgentStatusResponse | null>(null)
  const wasAgentRunningRef = useRef(isAgentRunning)

  useEffect(() => {
    if (!isAgentRunning || latestAssistantResponse === null) return

    latestAssistantResponseRef.current = latestAssistantResponse
    const timeoutId = window.setTimeout(() => {
      setRetainedAssistantResponse(null)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [isAgentRunning, latestAssistantResponse])

  useEffect(() => {
    if (isAgentRunning) {
      wasAgentRunningRef.current = true
      return
    }

    if (!wasAgentRunningRef.current) return

    wasAgentRunningRef.current = false
    const finalResponse =
      latestAssistantResponse ?? latestAssistantResponseRef.current

    if (finalResponse === null) return

    let clearTimeoutId = 0
    const retainTimeoutId = window.setTimeout(() => {
      setRetainedAssistantResponse({ ...finalResponse, isStreaming: false })
      clearTimeoutId = window.setTimeout(() => {
        setRetainedAssistantResponse(null)
      }, 10_000)
    }, 0)

    return () => {
      window.clearTimeout(retainTimeoutId)
      window.clearTimeout(clearTimeoutId)
    }
  }, [isAgentRunning, latestAssistantResponse])

  const visibleAssistantResponse = isAgentRunning
    ? latestAssistantResponse
    : retainedAssistantResponse

  if (!isAgentRunning && retainedAssistantResponse === null) return null

  return (
    <div
      className="workspace-agent-status-dialog"
      data-state={visibleAssistantResponse === null ? 'working' : 'response'}
      role="status"
      aria-live="polite"
    >
      {visibleAssistantResponse === null ? (
        <div className="workspace-agent-status-working">
          <span>Working</span>
        </div>
      ) : (
        <div className="workspace-agent-status-scroll">
          <div
            key={visibleAssistantResponse.id}
            className="workspace-agent-status-message"
            data-streaming={
              visibleAssistantResponse.isStreaming ? 'true' : 'false'
            }
          >
            <Suspense fallback={<div className="chat-markdown" />}>
              <ChatMarkdown
                text={visibleAssistantResponse.markdown}
                cwd={currentPath}
                isStreaming={visibleAssistantResponse.isStreaming}
              />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  )
}

function findLastUserMessageIndex(
  messageOrder: readonly string[],
  messagesById: Readonly<Record<string, AgentMessage>>,
): number {
  for (let index = messageOrder.length - 1; index >= 0; index -= 1) {
    const messageId = messageOrder[index]
    const message = messageId === undefined ? undefined : messagesById[messageId]

    if (message?.role === 'user') {
      return index
    }
  }

  return -1
}
