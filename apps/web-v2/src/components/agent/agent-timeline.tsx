import {
  CopyIcon,
  Edit03Icon,
  Pdf02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { LegendList, type LegendListRef } from '@legendapp/list/react'
import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import {
  getAssistantMarkdown,
  getTextContent,
} from '../../lib/agent/agent-events.ts'
import type { AgentTimelineRow } from '../../lib/agent/agent-events.ts'
import type {
  AgentContent,
  AgentMessage,
  FileContent,
  ImageContent,
} from '../../lib/agent/types.ts'
import { useAgentChatStore } from '../../stores/agent/agent-chat-store.ts'

const ChatMarkdown = lazy(() =>
  import('./chat-markdown.tsx').then((module) => ({ default: module.ChatMarkdown })),
)

export type AgentTimelineProps = {
  readonly currentPath: string
  readonly workspaceRoot?: string
  readonly onOpenFilePath?: (path: string) => void
  readonly onSubmitUserMessageEdit?: (input: {
    readonly messageId: string
    readonly content: AgentContent
  }) => boolean | void
}

export const AgentTimeline = memo(function AgentTimeline({
  currentPath,
  workspaceRoot,
  onOpenFilePath,
  onSubmitUserMessageEdit,
}: AgentTimelineProps) {
  const listRef = useRef<LegendListRef | null>(null)
  const rows = useAgentChatStore((state) => state.timelineRows)

  useEffect(() => {
    if (rows.length > 0) {
      return
    }

    listRef.current?.scrollToEnd?.({ animated: false })
  }, [rows.length])

  if (rows.length === 0) {
    return <AgentPanelState label="No displayable messages in this thread." />
  }

  return (
    <LegendList<AgentTimelineRow>
      ref={listRef}
      data={rows as AgentTimelineRow[]}
      keyExtractor={(row) => row.id}
      estimatedItemSize={96}
      initialScrollAtEnd
      maintainScrollAtEnd
      maintainScrollAtEndThreshold={0.1}
      maintainVisibleContentPosition
      className="agent-thread-list"
      ListHeaderComponent={<div className="agent-thread-list-spacer" />}
      ListFooterComponent={<div className="agent-thread-list-spacer bottom" />}
      renderItem={({ item }) => (
        <TimelineRowContent
          row={item}
          currentPath={currentPath}
          workspaceRoot={workspaceRoot}
          onOpenFilePath={onOpenFilePath}
          onSubmitUserMessageEdit={onSubmitUserMessageEdit}
        />
      )}
    />
  )
})

const TimelineRowContent = memo(function TimelineRowContent({
  row,
  currentPath,
  workspaceRoot,
  onOpenFilePath,
  onSubmitUserMessageEdit,
}: {
  readonly row: AgentTimelineRow
  readonly currentPath: string
  readonly workspaceRoot?: string
  readonly onOpenFilePath?: (path: string) => void
  readonly onSubmitUserMessageEdit?: (input: {
    readonly messageId: string
    readonly content: AgentContent
  }) => boolean | void
}) {
  if (row.kind === 'status') {
    return <TurnStatusRow messageId={row.messageId} />
  }

  if (row.role === 'user') {
    return (
      <UserMessageBubble
        messageId={row.messageId}
        onSubmitUserMessageEdit={onSubmitUserMessageEdit}
      />
    )
  }

  return (
    <AssistantMessageBlock
      messageId={row.messageId}
      currentPath={currentPath}
      workspaceRoot={workspaceRoot}
      onOpenFilePath={onOpenFilePath}
    />
  )
})

const TurnStatusRow = memo(function TurnStatusRow({
  messageId,
}: {
  readonly messageId: string
}) {
  const statusLabel = useAgentChatStore((state) => {
    if (state.activeRun === null) {
      return 'Worked'
    }

    const activeUserMessageId = findLastUserMessageKey(
      state.messageOrder,
      state.messagesById,
    )
    if (activeUserMessageId !== messageId) {
      return 'Worked'
    }

    return state.activeTurn?.status === 'reconnecting' ? 'Reconnecting' : 'Working'
  })

  return (
    <div className="agent-message-row status">
      <div
        className={`agent-turn-status ${statusLabel === 'Worked' ? 'worked' : 'working'}`}
      >
        {statusLabel}
      </div>
    </div>
  )
})

const UserMessageBubble = memo(function UserMessageBubble({
  messageId,
  onSubmitUserMessageEdit,
}: {
  readonly messageId: string
  readonly onSubmitUserMessageEdit?: (input: {
    readonly messageId: string
    readonly content: AgentContent
  }) => boolean | void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const message = useAgentChatStore((state) => {
    const currentMessage = state.messagesById[messageId]
    return currentMessage?.role === 'user' ? currentMessage : null
  })
  const isLatestUserMessage = useAgentChatStore(
    (state) =>
      findLastUserMessageKey(state.messageOrder, state.messagesById) === messageId,
  )
  const isStreaming = useAgentChatStore((state) => state.activeRun !== null)
  const isTurnCompleted = useAgentChatStore((state) => {
    if (state.activeRun === null) {
      return true
    }

    const activeUserMessageId = findLastUserMessageKey(
      state.messageOrder,
      state.messagesById,
    )
    return activeUserMessageId !== messageId
  })

  if (message === null) {
    return null
  }

  const text = getTextContent(message.content)
  const canEdit =
    isLatestUserMessage && !isStreaming && onSubmitUserMessageEdit !== undefined
  const attachments = message.content.filter(
    (block): block is ImageContent | FileContent =>
      block.type === 'image' || block.type === 'file',
  )
  const actions: MessageAction[] = [
    {
      label: 'Copy message',
      icon: CopyIcon,
      onClick: () => copyText(text),
    },
  ]

  if (isLatestUserMessage) {
    actions.push({
      label: 'Edit message',
      icon: Edit03Icon,
      disabled: !canEdit,
      onClick: () => {
        if (canEdit) {
          setIsEditing(true)
        }
      },
    })
  }

  const handleSubmitEdit = (nextText: string): boolean => {
    const didSubmit = onSubmitUserMessageEdit?.({
      messageId,
      content: [{ type: 'text', content: nextText }],
    })

    if (didSubmit === false) {
      return false
    }

    setIsEditing(false)
    return true
  }

  return (
    <div className="agent-message-row user">
      {isEditing ? (
        <UserMessageEditBox
          initialText={text}
          onCancel={() => setIsEditing(false)}
          onSubmit={handleSubmitEdit}
        />
      ) : (
        <>
          {attachments.length > 0 ? (
            <div className="agent-user-attachments">
              {attachments.map((attachment, index) => (
                <UserAttachment
                  key={`${message.id}:${String(index)}`}
                  attachment={attachment}
                />
              ))}
            </div>
          ) : null}
          {text.length > 0 ? (
            <div className="agent-user-bubble">
              <div className="agent-user-text">{text}</div>
            </div>
          ) : null}
        </>
      )}
      {!isEditing && (isTurnCompleted || isLatestUserMessage) && text.length > 0 ? (
        <MessageActions actions={actions} />
      ) : null}
    </div>
  )
})

function UserMessageEditBox({
  initialText,
  onCancel,
  onSubmit,
}: {
  readonly initialText: string
  readonly onCancel: () => void
  readonly onSubmit: (text: string) => boolean
}) {
  const [draft, setDraft] = useState(initialText)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const canSubmit =
    draft.trim().length > 0 && draft.trim() !== initialText.trim()
  const initialRowCount = Math.max(1, initialText.split(/\r\n|\r|\n/u).length)

  useLayoutEffect(() => {
    const textarea = textareaRef.current

    if (textarea === null) {
      return
    }

    textarea.style.height = 'auto'
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 320))}px`
  }, [draft])

  useEffect(() => {
    textareaRef.current?.focus()
    textareaRef.current?.setSelectionRange(initialText.length, initialText.length)
  }, [initialText])

  const submit = (): void => {
    if (!canSubmit) {
      return
    }

    onSubmit(draft.trim())
  }

  return (
    <div className="agent-user-edit-box">
      <textarea
        ref={textareaRef}
        className="agent-user-edit-textarea"
        value={draft}
        rows={initialRowCount}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }

          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      <div className="agent-user-edit-actions">
        <button type="button" className="agent-user-edit-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="agent-user-edit-send"
          disabled={!canSubmit}
          onClick={submit}
        >
          Send
        </button>
      </div>
    </div>
  )
}

function UserAttachment({
  attachment,
}: {
  readonly attachment: ImageContent | FileContent
}) {
  if (attachment.type === 'image' && attachment.data.length > 0) {
    return (
      <div className="agent-user-image-attachment">
        <img
          src={`data:${attachment.mimeType};base64,${attachment.data}`}
          alt="Attached image"
        />
      </div>
    )
  }

  const filename =
    attachment.type === 'file'
      ? attachment.filename
      : typeof attachment.metadata?.['filename'] === 'string'
        ? (attachment.metadata['filename'] as string)
        : 'Attached image'
  const size =
    typeof attachment.metadata?.['size'] === 'number'
      ? (attachment.metadata['size'] as number)
      : undefined
  const detail = size === undefined ? 'Document' : formatAttachmentSize(size)

  return (
    <div className="agent-user-file-attachment">
      <div className="agent-user-file-icon">
        <HugeiconsIcon
          icon={Pdf02Icon}
          size={16}
          color="currentColor"
          strokeWidth={1.8}
        />
      </div>
      <div className="agent-user-file-meta">
        <span>{filename}</span>
        <small>{detail}</small>
      </div>
    </div>
  )
}

function formatAttachmentSize(size: number): string {
  if (size < 1024) {
    return `${String(size)} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const AssistantMessageBlock = memo(function AssistantMessageBlock({
  messageId,
  currentPath,
  workspaceRoot,
  onOpenFilePath,
}: {
  readonly messageId: string
  readonly currentPath: string
  readonly workspaceRoot?: string
  readonly onOpenFilePath?: (path: string) => void
}) {
  const markdown = useAgentChatStore((state) => {
    const message = state.messagesById[messageId]
    return message?.role === 'assistant' ? getAssistantMarkdown(message) : ''
  })
  const isTurnCompleted = useAgentChatStore(
    (state) => !state.streamingMessageIds.includes(messageId),
  )
  const showCompactionStatus = useAgentChatStore(
    (state) =>
      state.activeCompactionItemIds.length > 0 &&
      findLastAssistantMessageKey(state.messageOrder, state.messagesById) ===
        messageId,
  )

  return (
    <div className="agent-message-row assistant group-assistant">
      {markdown.length > 0 ? (
        <div className="agent-assistant-markdown">
          <Suspense fallback={<div className="chat-markdown" />}>
            <ChatMarkdown
              text={markdown}
              cwd={currentPath}
              isStreaming={!isTurnCompleted}
              workspaceRoot={workspaceRoot}
              onOpenFilePath={onOpenFilePath}
            />
          </Suspense>
        </div>
      ) : null}
      {showCompactionStatus ? (
        <div className="agent-compaction-status">
          Compacting conversation and continuing
        </div>
      ) : null}
      {isTurnCompleted && markdown.length > 0 ? (
        <MessageActions
          actions={[
            {
              label: 'Copy response',
              icon: CopyIcon,
              onClick: () => copyText(markdown),
            },
          ]}
        />
      ) : null}
    </div>
  )
})

type MessageAction = {
  readonly label: string
  readonly icon: IconSvgElement
  readonly disabled?: boolean
  readonly onClick: () => void
}

function findLastAssistantMessageKey(
  messageOrder: readonly string[],
  messagesById: Readonly<Record<string, AgentMessage>>,
): string | null {
  for (let index = messageOrder.length - 1; index >= 0; index -= 1) {
    const messageId = messageOrder[index]
    const message = messageId === undefined ? undefined : messagesById[messageId]

    if (message?.role === 'assistant') {
      return messageId ?? null
    }
  }

  return null
}

const MessageActions = memo(function MessageActions({
  actions,
}: {
  readonly actions: readonly MessageAction[]
}) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null)

  const handleClick = useCallback((action: MessageAction): void => {
    if (action.disabled === true) {
      return
    }

    action.onClick()

    if (!action.label.toLowerCase().includes('copy')) {
      return
    }

    setCopiedLabel(action.label)
    window.setTimeout(() => setCopiedLabel(null), 1000)
  }, [])

  return (
    <div className="agent-message-actions">
      {actions.map((action) => {
        const isCopied = copiedLabel === action.label

        return (
          <button
            key={action.label}
            type="button"
            className="agent-message-action-button"
            disabled={action.disabled}
            onClick={handleClick.bind(null, action)}
            aria-label={isCopied ? 'Copied' : action.label}
            title={isCopied ? 'Copied' : action.label}
          >
            <HugeiconsIcon
              icon={isCopied ? Tick02Icon : action.icon}
              size={15}
              color="currentColor"
              strokeWidth={1.8}
            />
          </button>
        )
      })}
    </div>
  )
})

function copyText(text: string): void {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
    return
  }

  void navigator.clipboard.writeText(text)
}

function AgentPanelState({ label }: { readonly label: string }) {
  return <div className="agent-panel-state">{label}</div>
}

function findLastUserMessageKey(
  messageOrder: readonly string[],
  messagesById: Readonly<Record<string, AgentMessage>>,
): string | null {
  for (let index = messageOrder.length - 1; index >= 0; index -= 1) {
    const messageId = messageOrder[index]
    const message = messageId === undefined ? undefined : messagesById[messageId]

    if (message?.role === 'user') {
      return messageId ?? null
    }
  }

  return null
}
