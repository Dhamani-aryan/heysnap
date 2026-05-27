import {
  ArrowUp02Icon,
  Folder01Icon,
  Pdf02Icon,
  PlusSignIcon,
  VoiceIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from 'react'
import type { AgentContent } from '../../lib/agent/types.ts'
import {
  EMPTY_PROMPT_DRAFT,
  selectPromptDraft,
  useAgentPromptDraftStore,
  type PromptAttachment,
} from '../../stores/agent/agent-prompt-draft-store.ts'

const PDF_MIME_TYPE = 'application/pdf'
const DEFAULT_ATTACHMENT_MIME_TYPE = 'application/octet-stream'
const PROMPT_MAX_HEIGHT = 220

export type PromptVoiceState =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'transcribing'
export type PromptModelChoice = 'gpt' | 'claude'

export type PromptModelPickerState = {
  readonly value: PromptModelChoice
  readonly disabled?: boolean
  readonly onChange: (value: PromptModelChoice) => void
}

export type PromptInputProps = {
  readonly threadId: string | null
  readonly isRunning?: boolean
  readonly activeFolderName?: string
  readonly modelPicker?: PromptModelPickerState
  readonly voiceState?: PromptVoiceState
  readonly autoFocus?: boolean
  readonly autoFocusToken?: number
  readonly placeholder?: string
  readonly onVoiceToggle?: () => void
  readonly onCancel?: () => void
  readonly onSubmit: (input: {
    readonly content: AgentContent
  }) => boolean | void | Promise<boolean | void>
}

const getAttachmentId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${String(Date.now())}-${Math.random().toString(36).slice(2)}`
}

const formatAttachmentSize = (size: number | undefined): string | null => {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return null
  }
  if (size < 1024) return `${String(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

const getMimeTypeExtension = (mimeType: string): string => {
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.trim().toLowerCase()
  if (subtype === 'jpeg') return 'jpg'
  return subtype !== undefined && subtype.length > 0 ? subtype : 'png'
}

const getClipboardFileName = (file: File, index: number): string => {
  const trimmedName = file.name.trim()
  if (trimmedName.length > 0) return trimmedName
  const extension = getMimeTypeExtension(file.type)
  return `clipboard-image-${String(Date.now())}-${String(index + 1)}.${extension}`
}

const getClipboardAttachmentFiles = (
  clipboardData: DataTransfer | null,
): File[] => {
  if (clipboardData === null) return []
  const files = Array.from(clipboardData.files)
  if (files.length > 0) {
    return files.map((file, index) =>
      file.name.trim().length > 0
        ? file
        : new File([file], getClipboardFileName(file, index), {
            type: file.type,
            lastModified: file.lastModified,
          }),
    )
  }
  return Array.from(clipboardData.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
    .map((file, index) =>
      file.name.trim().length > 0
        ? file
        : new File([file], getClipboardFileName(file, index), {
            type: file.type,
            lastModified: file.lastModified,
          }),
    )
}

const toPromptAttachment = async (file: File): Promise<PromptAttachment> => {
  const content = arrayBufferToBase64(await file.arrayBuffer())
  return {
    id: getAttachmentId(),
    type: file.type.startsWith('image/') ? 'image' : 'file',
    fileName: file.name,
    mimeType:
      file.type !== ''
        ? file.type
        : file.name.toLowerCase().endsWith('.pdf')
          ? PDF_MIME_TYPE
          : DEFAULT_ATTACHMENT_MIME_TYPE,
    size: file.size,
    content,
  }
}

const eventHasFiles = (event: ReactDragEvent): boolean => {
  return Array.from(event.dataTransfer.types).includes('Files')
}

const toAgentContent = (
  text: string,
  attachments: readonly PromptAttachment[],
): AgentContent => {
  const trimmed = text.trim()
  return [
    ...(trimmed.length > 0
      ? [{ type: 'text' as const, content: trimmed }]
      : []),
    ...attachments.map((attachment) =>
      attachment.type === 'image'
        ? {
            type: 'image' as const,
            data: attachment.content,
            mimeType: attachment.mimeType,
            metadata: {
              filename: attachment.fileName,
              size: attachment.size,
            },
          }
        : {
            type: 'file' as const,
            data: attachment.content,
            mimeType: attachment.mimeType,
            filename: attachment.fileName,
            metadata: { size: attachment.size },
          },
    ),
  ]
}

export function PromptInput({
  threadId,
  isRunning = false,
  activeFolderName,
  modelPicker,
  voiceState = 'idle',
  autoFocus = false,
  autoFocusToken,
  placeholder = "What's Next..",
  onVoiceToggle,
  onCancel,
  onSubmit,
}: PromptInputProps) {
  const draft = useAgentPromptDraftStore(selectPromptDraft(threadId))
  const setText = useAgentPromptDraftStore((s) => s.setText)
  const setAttachments = useAgentPromptDraftStore((s) => s.setAttachments)
  const clearDraft = useAgentPromptDraftStore((s) => s.clearDraft)

  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const previousAutoFocusTokenRef = useRef(autoFocusToken)

  const text = draft.text
  const attachments = draft.attachments
  const canSubmit = text.trim().length > 0 || attachments.length > 0
  const isVoiceRecording = voiceState === 'recording'
  const isVoiceLoading =
    voiceState === 'starting' || voiceState === 'transcribing'
  const shouldShowVoiceControl =
    onVoiceToggle !== undefined || isVoiceRecording || isVoiceLoading

  const focusTextareaAtEnd = useCallback((): void => {
    const textarea = textareaRef.current
    if (textarea === null) return
    textarea.focus()
    const cursorPosition = textarea.value.length
    textarea.setSelectionRange(cursorPosition, cursorPosition)
  }, [])

  const resizeTextarea = useCallback((): void => {
    const textarea = textareaRef.current
    if (textarea === null || textarea.clientWidth <= 0) return
    textarea.style.height = 'auto'
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, PROMPT_MAX_HEIGHT))}px`
  }, [])

  useLayoutEffect(() => {
    resizeTextarea()
  }, [text, resizeTextarea])

  useEffect(() => {
    const container = containerRef.current
    if (container === null || typeof ResizeObserver === 'undefined') return
    let animationFrame = 0
    const scheduleResize = (): void => {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(resizeTextarea)
    }
    const observer = new ResizeObserver(scheduleResize)
    observer.observe(container)
    scheduleResize()
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(animationFrame)
    }
  }, [resizeTextarea])

  useEffect(() => {
    const shouldFocusForToken =
      autoFocusToken !== undefined &&
      previousAutoFocusTokenRef.current !== autoFocusToken
    previousAutoFocusTokenRef.current = autoFocusToken
    if (!autoFocus && !shouldFocusForToken) return
    window.requestAnimationFrame(focusTextareaAtEnd)
  }, [autoFocus, autoFocusToken, focusTextareaAtEnd])

  const handleAttachmentFiles = async (
    files: FileList | File[],
  ): Promise<void> => {
    const nextFiles = Array.from(files)
    if (nextFiles.length === 0) return
    setAttachmentError(null)
    try {
      const newAttachments = await Promise.all(
        nextFiles.map((file) => toPromptAttachment(file)),
      )
      setAttachments(threadId, [...attachments, ...newAttachments])
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : 'Failed to read attachment.',
      )
    } finally {
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handlePaste = (
    event: ReactClipboardEvent<HTMLTextAreaElement>,
  ): void => {
    const files = getClipboardAttachmentFiles(event.clipboardData)
    if (files.length === 0) return
    event.preventDefault()
    void handleAttachmentFiles(files)
  }

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit || isSubmitting) return
    setIsSubmitting(true)
    try {
      const didSubmit = await onSubmit({
        content: toAgentContent(text, attachments),
      })
      if (didSubmit === false) return
      clearDraft(threadId)
      setAttachmentError(null)
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = ''
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePrimaryAction = (): void => {
    if (isRunning && !canSubmit) {
      onCancel?.()
      return
    }
    void handleSubmit()
  }

  const isAbortAction = isRunning && !canSubmit
  const isSendAction = !isAbortAction
  const isSolidSendButton = canSubmit || isAbortAction
  const sendButtonClasses = isSolidSendButton
    ? 'bg-primary text-white hover:bg-primary-hover'
    : 'send-button-idle text-white dark:text-white/55'

  return (
    <div
      ref={containerRef}
      onClick={() => textareaRef.current?.focus()}
      onDragEnter={(event) => {
        if (!eventHasFiles(event)) return
        event.preventDefault()
        event.stopPropagation()
        dragDepthRef.current += 1
        setIsDragActive(true)
      }}
      onDragOver={(event) => {
        if (!eventHasFiles(event)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (!eventHasFiles(event)) return
        event.preventDefault()
        event.stopPropagation()
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setIsDragActive(false)
      }}
      onDrop={(event) => {
        if (!eventHasFiles(event)) return
        event.preventDefault()
        event.stopPropagation()
        dragDepthRef.current = 0
        setIsDragActive(false)
        void handleAttachmentFiles(event.dataTransfer.files)
      }}
      className="relative box-border w-full cursor-text rounded-[18px] border border-black/[0.08] bg-[#f9f9f9] p-[7px] shadow-[0_6px_18px_rgba(0,0,0,0.08),0_0_0_0.5px_rgba(0,0,0,0.025)] [backdrop-filter:blur(28px)_saturate(1.8)] dark:border-white/[0.08] dark:bg-[#1a1a1a] dark:shadow-[0_6px_18px_rgba(0,0,0,0.24),inset_0_0.5px_0_rgba(255,255,255,0.06)]"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files === null) return
          void handleAttachmentFiles(event.target.files)
        }}
      />

      {attachments.length > 0 ? (
        <div className="mb-[8px] flex flex-wrap gap-[8px] px-[4px]">
          {attachments.map((attachment) => (
            <AttachmentPreview
              key={attachment.id}
              attachment={attachment}
              onRemove={() => {
                setAttachments(
                  threadId,
                  attachments.filter((candidate) => candidate.id !== attachment.id),
                )
              }}
            />
          ))}
        </div>
      ) : null}

      {attachmentError !== null ? (
        <p className="m-0 px-[4px] pb-[6px] text-[12px] leading-[18px] text-[#ff6363]">
          {attachmentError}
        </p>
      ) : null}

      <textarea
        ref={textareaRef}
        value={text}
        placeholder={placeholder}
        maxLength={200000}
        rows={1}
        className="block min-h-[34px] w-full resize-none border-0 bg-transparent px-[4px] py-[6px] text-[13px] leading-[1.55] text-heading shadow-none outline-none placeholder:text-black/30 dark:placeholder:text-white/25"
        onChange={(event) => setText(threadId, event.target.value)}
        onPaste={handlePaste}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void handleSubmit()
          }
        }}
      />

      <div className="flex items-center justify-between gap-[8px] px-[4px] pt-[10px]">
        <div className="flex min-w-0 flex-1 items-center gap-[6px] overflow-hidden">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              fileInputRef.current?.click()
            }}
            aria-label="Add attachment"
            title="Add attachment"
            className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[6px] text-black/40 transition-colors duration-[120ms] hover:bg-secondary-hover hover:text-black/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:rgba(0,0,0,0.12)] dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/65 dark:focus-visible:[outline-color:rgba(255,255,255,0.12)]"
          >
            <HugeiconsIcon
              icon={PlusSignIcon}
              size={18}
              color="currentColor"
              strokeWidth={1.9}
            />
          </button>

          {activeFolderName !== undefined ? (
            <div
              title={activeFolderName}
              aria-label={`Current folder: ${activeFolderName}`}
              className="inline-flex h-[28px] min-w-0 max-w-[min(220px,100%)] items-center gap-[6px] rounded-[6px] px-[8px] text-[12px] font-medium leading-[28px] text-ghost transition-colors duration-[120ms] hover:bg-ghost/10"
            >
              <HugeiconsIcon
                icon={Folder01Icon}
                size={14}
                color="currentColor"
                strokeWidth={1.9}
              />
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                {activeFolderName}
              </span>
            </div>
          ) : null}

          {modelPicker !== undefined ? (
            <label
              title={
                modelPicker.disabled === true
                  ? 'Model can only be changed before starting a new chat'
                  : 'Choose model'
              }
              onClick={(event) => event.stopPropagation()}
              className="inline-flex h-[28px] shrink-0 items-center"
            >
              <span className="sr-only">Model</span>
              <select
                value={modelPicker.value}
                disabled={modelPicker.disabled === true}
                aria-label="Model"
                onChange={(event) =>
                  modelPicker.onChange(event.target.value as PromptModelChoice)
                }
                className="h-[28px] min-w-[82px] cursor-pointer rounded-[6px] border-0 bg-black/[0.04] px-[8px] pr-[24px] text-[12px] font-semibold leading-[28px] text-black/65 outline-none transition-colors duration-[120ms] hover:enabled:bg-black/[0.07] hover:enabled:text-black/80 disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:rgba(0,0,0,0.12)] dark:bg-white/[0.07] dark:text-white/70 dark:hover:enabled:bg-white/10 dark:hover:enabled:text-white/85 dark:focus-visible:[outline-color:rgba(255,255,255,0.12)]"
              >
                <option value="gpt">GPT</option>
                <option value="claude">Claude</option>
              </select>
            </label>
          ) : null}
        </div>

        <div className="inline-flex shrink-0 items-center gap-[6px]">
          {shouldShowVoiceControl ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                if (isVoiceLoading) return
                onVoiceToggle?.()
              }}
              disabled={isVoiceLoading || onVoiceToggle === undefined}
              data-recording={isVoiceRecording ? 'true' : undefined}
              data-loading={isVoiceLoading ? 'true' : undefined}
              aria-label={
                isVoiceRecording
                  ? 'Stop voice input'
                  : isVoiceLoading
                    ? 'Transcribing voice input'
                    : 'Start voice input'
              }
              title={
                isVoiceRecording
                  ? 'Stop voice input'
                  : isVoiceLoading
                    ? 'Transcribing voice input'
                    : 'Start voice input'
              }
              className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[6px] text-black/40 transition-colors duration-[120ms] hover:bg-secondary-hover hover:text-black/65 disabled:opacity-60 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/65"
            >
              {isVoiceLoading ? (
                <span
                  aria-hidden="true"
                  className="inline-flex items-center gap-[2px]"
                >
                  <span className="h-[4px] w-[4px] animate-pulse rounded-full bg-current" />
                  <span className="h-[4px] w-[4px] animate-pulse rounded-full bg-current [animation-delay:120ms]" />
                  <span className="h-[4px] w-[4px] animate-pulse rounded-full bg-current [animation-delay:240ms]" />
                </span>
              ) : isVoiceRecording ? (
                <span
                  aria-hidden="true"
                  className="inline-flex items-end gap-[2px]"
                >
                  {Array.from({ length: 4 }, (_, index) => (
                    <span
                      key={index}
                      className="h-[10px] w-[2px] animate-pulse rounded-[1px] bg-current"
                      style={{ animationDelay: `${String(index * 90)}ms` }}
                    />
                  ))}
                </span>
              ) : (
                <HugeiconsIcon
                  icon={VoiceIcon}
                  size={16}
                  color="currentColor"
                  strokeWidth={1.9}
                />
              )}
            </button>
          ) : null}

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              handlePrimaryAction()
            }}
            disabled={isSubmitting || (!isRunning && !canSubmit)}
            aria-label={
              isAbortAction
                ? 'Stop response'
                : isRunning
                  ? 'Send steer'
                  : 'Send prompt'
            }
            title={
              isAbortAction
                ? 'Stop response'
                : isRunning
                  ? 'Send steer'
                  : 'Send prompt'
            }
            className={`inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full transition-colors duration-[120ms] disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:rgba(0,0,0,0.12)] dark:focus-visible:[outline-color:rgba(255,255,255,0.12)] ${sendButtonClasses}`}
          >
            {isSendAction ? (
              <HugeiconsIcon
                icon={ArrowUp02Icon}
                size={16}
                color="currentColor"
                strokeWidth={1.9}
              />
            ) : (
              <span
                aria-hidden="true"
                className="block h-[9px] w-[9px] rounded-[2px] bg-white"
              />
            )}
          </button>
        </div>
      </div>

      {isDragActive ? (
        <div className="pointer-events-none absolute inset-0 z-[20] flex items-center justify-center rounded-[18px] border border-dashed border-black/20 bg-white/70 text-[14px] text-black/70 [backdrop-filter:blur(4px)] dark:border-white/25 dark:bg-black/30 dark:text-white/80">
          Drop files to attach
        </div>
      ) : null}
    </div>
  )
}

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: PromptAttachment
  onRemove: () => void
}) {
  const dataUrl = `data:${attachment.mimeType};base64,${attachment.content}`
  const sizeLabel = formatAttachmentSize(attachment.size)

  if (attachment.type === 'image') {
    return (
      <div className="relative overflow-hidden rounded-[16px] border border-black/[0.08] bg-secondary-hover dark:border-white/[0.1]">
        <img
          src={dataUrl}
          alt={attachment.fileName}
          className="block h-[56px] w-[56px] object-cover"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55 px-[6px] py-[2px]">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[9px] font-medium text-white">
            {attachment.fileName}
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          aria-label={`Remove ${attachment.fileName}`}
          className="absolute right-[4px] top-[4px] inline-flex h-[20px] w-[20px] items-center justify-center rounded-full bg-black/55 text-[13px] font-medium leading-none text-white transition-colors duration-[120ms] hover:bg-black/70"
        >
          x
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-w-[168px] max-w-[220px] items-center gap-[8px] rounded-[16px] border border-black/[0.08] bg-secondary-hover px-[10px] py-[6px] text-black dark:border-white/[0.1] dark:text-white">
      <div className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[8px] bg-primary/15 text-primary">
        <HugeiconsIcon
          icon={Pdf02Icon}
          size={16}
          color="currentColor"
          strokeWidth={1.8}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium leading-[20px]">
          {attachment.fileName}
        </div>
        <div className="text-[11px] leading-[16px] text-black/45 dark:text-white/45">
          {sizeLabel ?? 'Document'}
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
        aria-label={`Remove ${attachment.fileName}`}
        className="inline-flex h-[24px] w-[24px] items-center justify-center rounded-full text-[12px] text-black/50 transition-colors duration-[120ms] hover:bg-black/5 hover:text-black/75 dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-white/75"
      >
        x
      </button>
    </div>
  )
}

export { EMPTY_PROMPT_DRAFT }
