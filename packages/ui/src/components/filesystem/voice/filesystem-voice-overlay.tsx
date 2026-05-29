import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { useAgentChatStore } from "../../../agent/agent-runtime";
import { useAgentRunMutation } from "../../../query/agent/agent-queries";
import { getAssistantMarkdown } from "../../../stores/agent/agent-store";
import {
  RightPromptComposer,
  type PromptAttachment,
  type PromptModelChoice,
  type PromptVoiceState,
} from "../../../agent/prompt-composer";
import type { AgentThreadSummary, AgentUiContext } from "../../../agent/types";

const ChatMarkdown = lazy(() =>
  import("../../../agent/chat-markdown").then((module) => ({ default: module.ChatMarkdown })),
);

export const FilesystemVoiceOverlay = ({
  isVisible,
  promptDraft,
  promptAttachments,
  focusToken,
  voiceState,
  currentPath,
  selectedThreadId,
  uiContext,
  allowModelSelection = false,
  promptModelChoice = "gpt",
  onPromptDraftChange,
  onPromptAttachmentsChange,
  onPromptModelChoiceChange,
  onStartRecording,
  onStopRecording,
  onOpenFilePath,
  onSelectThread,
  onThreadResolved,
}: {
  readonly isVisible: boolean;
  readonly promptDraft: string;
  readonly promptAttachments: readonly PromptAttachment[];
  readonly focusToken: number;
  readonly voiceState: PromptVoiceState;
  readonly currentPath: string;
  readonly selectedThreadId: string | null;
  readonly uiContext: AgentUiContext;
  readonly allowModelSelection?: boolean;
  readonly promptModelChoice?: PromptModelChoice;
  readonly onPromptDraftChange: (draft: string) => void;
  readonly onPromptAttachmentsChange: (attachments: PromptAttachment[]) => void;
  readonly onPromptModelChoiceChange?: (choice: PromptModelChoice) => void;
  readonly onStartRecording: () => Promise<void>;
  readonly onStopRecording: () => void;
  readonly onOpenFilePath: (path: string) => void;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
  readonly onThreadResolved?: (threadId: string) => void;
}): ReactElement | null => {
  const activeRun = useAgentChatStore((state) => state.activeRun);
  const messageOrder = useAgentChatStore((state) => state.messageOrder);
  const messagesById = useAgentChatStore((state) => state.messagesById);
  const streamingMessageIds = useAgentChatStore((state) => state.streamingMessageIds);
  const latestAssistantResponse = useMemo<FilesystemAgentStatusResponse | null>(() => {
    if (activeRun === null) {
      return null;
    }

    const lastUserMessageIndex = findLastUserMessageIndex(messageOrder, messagesById);
    let latestResponse: FilesystemAgentStatusResponse | null = null;

    for (const messageId of messageOrder.slice(lastUserMessageIndex + 1)) {
      const message = messagesById[messageId];

      if (message?.role !== "assistant") {
        continue;
      }

      const markdown = getAssistantMarkdown(message);

      if (markdown.length === 0) {
        continue;
      }

      latestResponse = {
        id: messageId,
        markdown,
        isStreaming: streamingMessageIds.includes(messageId),
      };
    }

    return latestResponse;
  }, [activeRun, messageOrder, messagesById, streamingMessageIds]);
  const isAgentRunning = activeRun !== null;
  const canChangeModel =
    allowModelSelection &&
    selectedThreadId === null &&
    !isAgentRunning &&
    onPromptModelChoiceChange !== undefined;
  const [retainedAssistantResponse, setRetainedAssistantResponse] = useState<FilesystemAgentStatusResponse | null>(null);
  const latestAssistantResponseRef = useRef<FilesystemAgentStatusResponse | null>(null);
  const wasAgentRunningRef = useRef(isAgentRunning);
  const { cancel, steer, submit } = useAgentRunMutation({
    currentPath,
    uiContext,
    selectedThreadId,
    onSelectThread,
    onThreadResolved,
  });
  const isRecording = voiceState === "recording";
  const isLoading = voiceState === "starting" || voiceState === "transcribing";
  const isExpanded = voiceState !== "idle";
  const hasPromptContent = promptDraft.trim().length > 0 || promptAttachments.length > 0;
  const previousFocusTokenRef = useRef(focusToken);
  const shouldAutoFocus = previousFocusTokenRef.current !== focusToken;

  useEffect(() => {
    previousFocusTokenRef.current = focusToken;
  }, [focusToken]);

  useEffect(() => {
    if (!isAgentRunning || latestAssistantResponse === null) {
      return;
    }

    latestAssistantResponseRef.current = latestAssistantResponse;
    setRetainedAssistantResponse(null);
  }, [isAgentRunning, latestAssistantResponse]);

  useEffect(() => {
    if (isAgentRunning) {
      wasAgentRunningRef.current = true;
      return;
    }

    if (!wasAgentRunningRef.current) {
      return;
    }

    wasAgentRunningRef.current = false;
    const finalResponse = latestAssistantResponse ?? latestAssistantResponseRef.current;

    if (finalResponse === null) {
      return;
    }

    setRetainedAssistantResponse({ ...finalResponse, isStreaming: false });
    const timeoutId = window.setTimeout(() => {
      setRetainedAssistantResponse(null);
    }, 10_000);

    return () => window.clearTimeout(timeoutId);
  }, [isAgentRunning, latestAssistantResponse]);

  if (!isVisible) {
    return null;
  }

  const visibleAssistantResponse = isAgentRunning ? latestAssistantResponse : retainedAssistantResponse;
  const agentStatusDialog = isAgentRunning || retainedAssistantResponse !== null ? (
    <FilesystemAgentStatusDialog
      response={visibleAssistantResponse}
      currentPath={currentPath}
      onOpenFilePath={onOpenFilePath}
    />
  ) : null;

  return (
    <div className="filesystem-voice-stack" data-with-prompt={hasPromptContent ? "true" : "false"}>
      {agentStatusDialog}
      {hasPromptContent ? (
        <div className="filesystem-voice-prompt-shell">
          <RightPromptComposer
            draft={promptDraft}
            attachments={promptAttachments}
            voiceState={voiceState}
            autoFocus={shouldAutoFocus}
            isRunning={isAgentRunning}
            modelPicker={allowModelSelection ? {
              value: selectedThreadId === null ? promptModelChoice : getThreadModelChoice(selectedThreadId),
              disabled: !canChangeModel,
              onChange: onPromptModelChoiceChange ?? (() => {}),
            } : undefined}
            onDraftChange={onPromptDraftChange}
            onAttachmentsChange={onPromptAttachmentsChange}
            onCancel={cancel}
            onSubmit={async (input) => {
              const didSubmit = isAgentRunning
                ? await steer(input)
                : submit({
                  ...input,
                  ...getNewThreadModelSelection({
                    allowModelSelection,
                    selectedThreadId,
                    promptModelChoice,
                  }),
                });
              return didSubmit;
            }}
          />
        </div>
      ) : (
        <button
          className="filesystem-hover-grip"
          type="button"
          aria-label={isRecording ? "Stop recording" : "Start recording"}
          aria-pressed={isRecording}
          data-expanded={isExpanded ? "true" : "false"}
          data-recording={isRecording ? "true" : "false"}
          data-loading={isLoading ? "true" : "false"}
          onClick={() => {
            if (isLoading) {
              return;
            }

            if (voiceState === "idle") {
              void onStartRecording();
              return;
            }

            onStopRecording();
          }}
        >
          {isLoading ? (
            <span className="filesystem-hover-grip-loading" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          ) : (
            <span className="filesystem-hover-grip-dots" aria-hidden="true">
              {Array.from({ length: 8 }, (_, index) => (
                <span key={index} />
              ))}
            </span>
          )}
        </button>
      )}
    </div>
  );
};

const getNewThreadModelSelection = ({
  allowModelSelection,
  selectedThreadId,
  promptModelChoice,
}: {
  readonly allowModelSelection: boolean;
  readonly selectedThreadId: string | null;
  readonly promptModelChoice: PromptModelChoice;
}) => {
  if (!allowModelSelection || selectedThreadId !== null) {
    return {};
  }

  if (promptModelChoice === "claude") {
    return {
      harness: "pi" as const,
      provider: "anthropic",
      model: "claude-opus-4-8",
    };
  }

  return { harness: "codex" as const };
};

const getThreadModelChoice = (threadId: string): PromptModelChoice =>
  decodeThreadId(threadId).startsWith("pi:") ? "claude" : "gpt";

const decodeThreadId = (threadId: string): string => {
  try {
    return decodeURIComponent(threadId);
  } catch {
    return threadId;
  }
};

type FilesystemAgentStatusResponse = {
  readonly id: string;
  readonly markdown: string;
  readonly isStreaming: boolean;
};

const FilesystemAgentStatusDialog = ({
  response,
  currentPath,
  onOpenFilePath,
}: {
  readonly response: FilesystemAgentStatusResponse | null;
  readonly currentPath: string;
  readonly onOpenFilePath: (path: string) => void;
}): ReactElement => (
  <div
    className="filesystem-agent-status-dialog"
    data-state={response === null ? "working" : "response"}
    role="status"
    aria-live="polite"
  >
    {response === null ? (
      <div className="filesystem-agent-status-working">
        <span>Working</span>
      </div>
    ) : (
      <div className="filesystem-agent-status-scroll">
        <div
          key={response.id}
          className="filesystem-agent-status-message"
          data-streaming={response.isStreaming ? "true" : "false"}
        >
          <Suspense fallback={<div className="chat-markdown" />}>
            <ChatMarkdown
              text={response.markdown}
              cwd={currentPath}
              isStreaming={response.isStreaming}
              onOpenFilePath={onOpenFilePath}
            />
          </Suspense>
        </div>
      </div>
    )}
  </div>
);

const findLastUserMessageIndex = (
  messageOrder: readonly string[],
  messagesById: Readonly<Record<string, unknown>>,
): number => {
  for (let index = messageOrder.length - 1; index >= 0; index -= 1) {
    const messageId = messageOrder[index];
    const message = messageId === undefined ? undefined : messagesById[messageId];

    if (
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      message.role === "user"
    ) {
      return index;
    }
  }

  return -1;
};
