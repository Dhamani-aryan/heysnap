"use client";

import { ArrowUp02Icon, Pdf02Icon, PlusSignIcon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLayoutEffect, useRef, useState } from "react";

import type { AgentContent } from "./types";

const PDF_MIME_TYPE = "application/pdf";
const ATTACHMENT_ACCEPT = `image/*,${PDF_MIME_TYPE}`;
const PROMPT_MAX_HEIGHT = 220;

export type PromptAttachment = {
  readonly id: string;
  readonly type: "image" | "file";
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  readonly content: string;
};

export interface RightPromptComposerProps {
  readonly isRunning?: boolean;
  readonly onCancel?: () => void;
  readonly onSubmit?: (input: { readonly content: AgentContent }) => boolean | void;
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

const isSupportedAttachmentFile = (file: File): boolean => {
  if (file.type === PDF_MIME_TYPE) {
    return true;
  }

  return file.type.startsWith("image/");
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  let binary = "";
  const bytes = new Uint8Array(buffer);

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

const toPromptAttachment = async (file: File): Promise<PromptAttachment> => {
  const content = arrayBufferToBase64(await file.arrayBuffer());

  return {
    id: getAttachmentId(),
    type: file.type === PDF_MIME_TYPE ? "file" : "image",
    fileName: file.name,
    mimeType: file.type || (file.name.toLowerCase().endsWith(".pdf") ? PDF_MIME_TYPE : ""),
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
  onCancel,
  onSubmit,
}: RightPromptComposerProps): React.ReactElement => {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const canSubmit = draft.trim().length > 0 || attachments.length > 0;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (textarea === null) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, PROMPT_MAX_HEIGHT)}px`;
  }, [draft]);

  const handleAttachmentFiles = async (files: FileList | File[]): Promise<void> => {
    const nextFiles = Array.from(files);

    if (nextFiles.length === 0) {
      return;
    }

    const supported = nextFiles.filter(isSupportedAttachmentFile);
    const rejected = nextFiles.filter((file) => !isSupportedAttachmentFile(file));

    setAttachmentError(rejected.length > 0 ? "Only images and PDFs are supported." : null);

    if (supported.length === 0) {
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
      return;
    }

    try {
      const nextAttachments = await Promise.all(supported.map((file) => toPromptAttachment(file)));
      setAttachments((current) => [...current, ...nextAttachments]);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Failed to read attachment.");
    } finally {
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSubmit = (): void => {
    if (isRunning || !canSubmit) {
      return;
    }

    const didSubmit = onSubmit?.({ content: toAgentContent(draft, attachments) });

    if (didSubmit === false) {
      return;
    }

    setDraft("");
    setAttachments([]);
    setAttachmentError(null);

    if (fileInputRef.current !== null) {
      fileInputRef.current.value = "";
    }
  };

  const handlePrimaryAction = (): void => {
    if (isRunning) {
      onCancel?.();
      return;
    }

    handleSubmit();
  };

  return (
    <div
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
                setAttachments((current) =>
                  current.filter((candidate) => candidate.id !== attachment.id),
                );
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
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSubmit();
          }
        }}
      />

      <div className="prompt-actions">
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

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            handlePrimaryAction();
          }}
          disabled={!isRunning && !canSubmit}
          className={isRunning ? "prompt-send-button active running" : canSubmit ? "prompt-send-button active" : "prompt-send-button"}
          aria-label={isRunning ? "Stop response" : "Send prompt"}
          title={isRunning ? "Stop response" : "Send prompt"}
        >
          <HugeiconsIcon
            icon={isRunning ? StopIcon : ArrowUp02Icon}
            size={isRunning ? 13 : 16}
            color="currentColor"
            strokeWidth={1.9}
          />
        </button>
      </div>

      {isDragActive ? <div className="prompt-drop-overlay">Drop images or PDFs to attach</div> : null}
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
