"use client";

import { ArrowUp02Icon, Folder01Icon, Pdf02Icon, PlusSignIcon, VoiceIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { AgentContent } from "./types";

const PDF_MIME_TYPE = "application/pdf";
const ATTACHMENT_ACCEPT = "";
const DEFAULT_ATTACHMENT_MIME_TYPE = "application/octet-stream";
const PROMPT_MAX_HEIGHT = 220;

export type PromptAttachment = {
  readonly id: string;
  readonly type: "image" | "file";
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  readonly content: string;
};

export type PromptVoiceState = "idle" | "starting" | "recording" | "transcribing";

export interface RightPromptComposerProps {
  readonly isRunning?: boolean;
  readonly draftSeed?: { readonly id: number; readonly text: string } | null;
  readonly draft?: string;
  readonly attachments?: readonly PromptAttachment[];
  readonly activeFolderName?: string;
  readonly voiceState?: PromptVoiceState;
  readonly autoFocus?: boolean;
  readonly autoFocusToken?: number;
  readonly onDraftChange?: (draft: string) => void;
  readonly onAttachmentsChange?: (attachments: PromptAttachment[]) => void;
  readonly onVoiceToggle?: () => void;
  readonly onCancel?: () => void;
  readonly onSubmit?: (input: { readonly content: AgentContent }) => boolean | void | Promise<boolean | void>;
}

const getAttachmentId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const formatAttachmentSize = (size: number | undefined): string | null => {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return null;
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  let binary = "";
  const bytes = new Uint8Array(buffer);

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

const getClipboardFileName = (file: File, index: number): string => {
  const trimmedName = file.name.trim();

  if (trimmedName.length > 0) {
    return trimmedName;
  }

  const extension = getMimeTypeExtension(file.type);
  return `clipboard-image-${Date.now()}-${index + 1}.${extension}`;
};

const getMimeTypeExtension = (mimeType: string): string => {
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim().toLowerCase();

  if (subtype === "jpeg") {
    return "jpg";
  }

  return subtype !== undefined && subtype.length > 0 ? subtype : "png";
};

export const getClipboardAttachmentFiles = (clipboardData: DataTransfer | null): File[] => {
  if (clipboardData === null) {
    return [];
  }

  const files = Array.from(clipboardData.files);

  if (files.length > 0) {
    return files.map((file, index) => (
      file.name.trim().length > 0
        ? file
        : new File([file], getClipboardFileName(file, index), { type: file.type, lastModified: file.lastModified })
    ));
  }

  return Array.from(clipboardData.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
    .map((file, index) => (
      file.name.trim().length > 0
        ? file
        : new File([file], getClipboardFileName(file, index), { type: file.type, lastModified: file.lastModified })
    ));
};

const toPromptAttachment = async (file: File): Promise<PromptAttachment> => {
  const content = arrayBufferToBase64(await file.arrayBuffer());

  return {
    id: getAttachmentId(),
    type: file.type.startsWith("image/") ? "image" : "file",
    fileName: file.name,
    mimeType: file.type || (file.name.toLowerCase().endsWith(".pdf") ? PDF_MIME_TYPE : DEFAULT_ATTACHMENT_MIME_TYPE),
    size: file.size,
    content,
  };
};

const eventHasFiles = (event: { readonly dataTransfer?: DataTransfer | null }): boolean => {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
};

const toAgentContent = (text: string, attachments: readonly PromptAttachment[]): AgentContent => {
  const content: AgentContent = [
    ...(text.trim().length > 0 ? [{ type: "text" as const, content: text.trim() }] : []),
    ...attachments.map((attachment) =>
      attachment.type === "image"
        ? {
            type: "image" as const,
            data: attachment.content,
            mimeType: attachment.mimeType,
            metadata: { filename: attachment.fileName, size: attachment.size },
          }
        : {
            type: "file" as const,
            data: attachment.content,
            mimeType: attachment.mimeType,
            filename: attachment.fileName,
            metadata: { size: attachment.size },
          },
    ),
  ];

  return content;
};

export const RightPromptComposer = ({
  isRunning = false,
  draftSeed = null,
  draft: controlledDraft,
  attachments: controlledAttachments,
  activeFolderName,
  voiceState = "idle",
  autoFocus = false,
  autoFocusToken,
  onDraftChange,
  onAttachmentsChange,
  onVoiceToggle,
  onCancel,
  onSubmit,
}: RightPromptComposerProps): React.ReactElement => {
  const [internalDraft, setInternalDraft] = useState("");
  const [internalAttachments, setInternalAttachments] = useState<PromptAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const promptInputRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const previousAutoFocusTokenRef = useRef(autoFocusToken);
  const draft = controlledDraft ?? internalDraft;
  const attachments = controlledAttachments ?? internalAttachments;
  const canSubmit = draft.trim().length > 0 || attachments.length > 0;
  const isVoiceRecording = voiceState === "recording";
  const isVoiceLoading = voiceState === "starting" || voiceState === "transcribing";
  const shouldShowVoiceIndicator = isVoiceRecording || isVoiceLoading;
  const shouldShowVoiceControl = onVoiceToggle !== undefined;

  const focusTextareaAtEnd = useCallback((): void => {
    const textarea = textareaRef.current;

    if (textarea === null) {
      return;
    }

    textarea.focus();
    const cursorPosition = textarea.value.length;
    textarea.setSelectionRange(cursorPosition, cursorPosition);
  }, []);

  const setDraftValue = useCallback((nextDraft: string): void => {
    if (controlledDraft === undefined) {
      setInternalDraft(nextDraft);
    }

    onDraftChange?.(nextDraft);
  }, [controlledDraft, onDraftChange]);

  const setAttachmentValues = useCallback((nextAttachments: PromptAttachment[]): void => {
    if (controlledAttachments === undefined) {
      setInternalAttachments(nextAttachments);
    }

    onAttachmentsChange?.(nextAttachments);
  }, [controlledAttachments, onAttachmentsChange]);

  const resizeTextarea = useCallback((): void => {
    const textarea = textareaRef.current;

    if (textarea === null || textarea.clientWidth <= 0) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, PROMPT_MAX_HEIGHT)}px`;
  }, []);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [draft, resizeTextarea]);

  useEffect(() => {
    const promptInput = promptInputRef.current;

    if (promptInput === null || typeof ResizeObserver === "undefined") {
      return;
    }

    let animationFrame = 0;
    const scheduleResize = (): void => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(resizeTextarea);
    };
    const observer = new ResizeObserver(scheduleResize);

    observer.observe(promptInput);
    scheduleResize();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [resizeTextarea]);

  useEffect(() => {
    const shouldFocusForToken = autoFocusToken !== undefined && previousAutoFocusTokenRef.current !== autoFocusToken;
    previousAutoFocusTokenRef.current = autoFocusToken;

    if (!autoFocus && !shouldFocusForToken) {
      return;
    }

    window.requestAnimationFrame(focusTextareaAtEnd);
  }, [autoFocus, autoFocusToken, focusTextareaAtEnd]);

  useEffect(() => {
    if (draftSeed === null) {
      return;
    }

    setDraftValue(draftSeed.text);
    setAttachmentError(null);
    window.requestAnimationFrame(focusTextareaAtEnd);
  }, [draftSeed, focusTextareaAtEnd, setDraftValue]);

  const handleAttachmentFiles = async (files: FileList | File[]): Promise<void> => {
    const nextFiles = Array.from(files);

    if (nextFiles.length === 0) {
      return;
    }

    setAttachmentError(null);

    try {
      const nextAttachments = await Promise.all(nextFiles.map((file) => toPromptAttachment(file)));
      setAttachmentValues([...attachments, ...nextAttachments]);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Failed to read attachment.");
    } finally {
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = getClipboardAttachmentFiles(event.clipboardData);

    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    void handleAttachmentFiles(files);
  };

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      const didSubmit = await onSubmit?.({ content: toAgentContent(draft, attachments) });

      if (didSubmit === false) {
        return;
      }

      setDraftValue("");
      setAttachmentValues([]);
      setAttachmentError(null);

      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrimaryAction = (): void => {
    if (isRunning && !canSubmit) {
      onCancel?.();
      return;
    }

    void handleSubmit();
  };

  const isAbortAction = isRunning && !canSubmit;
  const isSendAction = !isAbortAction;

  return (
    <div
      ref={promptInputRef}
      className="prompt-input"
      onClick={() => textareaRef.current?.focus()}
      onDragEnter={(event) => {
        if (!eventHasFiles(event)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        dragDepthRef.current += 1;
        setIsDragActive(true);
      }}
      onDragOver={(event) => {
        if (!eventHasFiles(event)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!eventHasFiles(event)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

        if (dragDepthRef.current === 0) {
          setIsDragActive(false);
        }
      }}
      onDrop={(event) => {
        if (!eventHasFiles(event)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        dragDepthRef.current = 0;
        setIsDragActive(false);
        void handleAttachmentFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple
        className="prompt-file-input"
        onChange={(event) => {
          if (event.target.files === null) {
            return;
          }

          void handleAttachmentFiles(event.target.files);
        }}
      />

      {attachments.length > 0 ? (
        <div className="prompt-attachments">
          {attachments.map((attachment) => (
            <PromptAttachmentPreview
              key={attachment.id}
              attachment={attachment}
              onRemove={() => {
                setAttachmentValues(attachments.filter((candidate) => candidate.id !== attachment.id));
              }}
            />
          ))}
        </div>
      ) : null}

      {attachmentError === null ? null : <p className="prompt-attachment-error">{attachmentError}</p>}

      <textarea
        ref={textareaRef}
        value={draft}
        placeholder="What's Next.."
        maxLength={200000}
        rows={1}
        className="prompt-textarea"
        onChange={(event) => setDraftValue(event.target.value)}
        onPaste={handlePaste}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void handleSubmit();
          }
        }}
      />

      <div className="prompt-actions">
        <div className="prompt-leading-actions">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="prompt-attachment-button"
            aria-label="Add attachment"
            title="Add attachment"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={18} color="currentColor" strokeWidth={1.9} />
          </button>

          {activeFolderName === undefined ? null : (
            <div className="prompt-folder-chip" title={activeFolderName} aria-label={`Current folder: ${activeFolderName}`}>
              <HugeiconsIcon icon={Folder01Icon} size={14} color="currentColor" strokeWidth={1.9} />
              <span>{activeFolderName}</span>
            </div>
          )}
        </div>

        <div className="prompt-trailing-actions">
          {shouldShowVoiceControl || shouldShowVoiceIndicator ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();

                if (isVoiceLoading) {
                  return;
                }

                onVoiceToggle?.();
              }}
              disabled={isVoiceLoading || onVoiceToggle === undefined}
              className="prompt-voice-button"
              data-recording={isVoiceRecording ? "true" : undefined}
              data-loading={isVoiceLoading ? "true" : undefined}
              aria-label={isVoiceRecording ? "Stop voice input" : isVoiceLoading ? "Transcribing voice input" : "Start voice input"}
              title={isVoiceRecording ? "Stop voice input" : isVoiceLoading ? "Transcribing voice input" : "Start voice input"}
            >
              {isVoiceLoading ? (
                <span className="prompt-voice-loading" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              ) : isVoiceRecording ? (
                <span className="prompt-voice-bars" aria-hidden="true">
                  {Array.from({ length: 8 }, (_, index) => (
                    <span key={index} />
                  ))}
                </span>
              ) : (
                <HugeiconsIcon icon={VoiceIcon} size={16} color="currentColor" strokeWidth={1.9} />
              )}
            </button>
          ) : null}

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handlePrimaryAction();
            }}
            disabled={isSubmitting || (!isRunning && !canSubmit)}
            className={isAbortAction ? "prompt-send-button active running" : canSubmit ? "prompt-send-button active" : "prompt-send-button"}
            aria-label={isAbortAction ? "Stop response" : isRunning ? "Send steer" : "Send prompt"}
            title={isAbortAction ? "Stop response" : isRunning ? "Send steer" : "Send prompt"}
          >
            {isSendAction ? (
              <HugeiconsIcon
                icon={ArrowUp02Icon}
                size={16}
                color="currentColor"
                strokeWidth={1.9}
              />
            ) : (
              <span className="prompt-stop-square" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {isDragActive ? <div className="prompt-drop-overlay">Drop files to attach</div> : null}
    </div>
  );
};

const PromptAttachmentPreview = ({
  attachment,
  onRemove,
}: {
  readonly attachment: PromptAttachment;
  readonly onRemove: () => void;
}): React.ReactElement => {
  const dataUrl = `data:${attachment.mimeType};base64,${attachment.content}`;
  const sizeLabel = formatAttachmentSize(attachment.size);

  if (attachment.type === "image") {
    return (
      <div className="prompt-image-attachment">
        <img src={dataUrl} alt={attachment.fileName} className="prompt-image-preview" />
        <div className="prompt-image-name">
          <div>{attachment.fileName}</div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="prompt-image-remove"
          aria-label={`Remove ${attachment.fileName}`}
        >
          x
        </button>
      </div>
    );
  }

  return (
    <div className="prompt-file-attachment">
      <div className="prompt-file-icon">
        <HugeiconsIcon icon={Pdf02Icon} size={16} color="currentColor" strokeWidth={1.8} />
      </div>
      <div className="prompt-file-meta">
        <div className="prompt-file-name">{attachment.fileName}</div>
        <div className="prompt-file-size">{sizeLabel ?? "Document"}</div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="prompt-file-remove"
        aria-label={`Remove ${attachment.fileName}`}
      >
        x
      </button>
    </div>
  );
};
