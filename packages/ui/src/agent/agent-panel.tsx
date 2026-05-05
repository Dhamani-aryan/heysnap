"use client";

import { Streamdown } from "streamdown";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { getAgentThread, startAgentRun, type AgentRunHandle } from "./agent-client";
import { AgentEmptyThread } from "./empty-thread";
import { RightPromptComposer } from "./prompt-composer";
import type {
  AgentContent,
  AgentMessage,
  AgentRunEvent,
  AgentThread,
  AgentThreadSummary,
  AssistantMessage,
  AssistantStreamEvent,
  FileContent,
  ImageContent,
  TextContent,
  UserMessage,
} from "./types";

export interface AgentPanelProps {
  readonly websocketUrl: string;
  readonly selectedThreadId: string | null;
  readonly currentPath: string;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
}

type ActiveRunState = {
  readonly runId: string | null;
  readonly threadId: string | null;
  readonly startedAt: number;
  readonly streamingAssistantMessageIds: readonly string[];
};

type DisplayItem =
  | { readonly type: "user"; readonly message: UserMessage }
  | {
      readonly type: "assistant";
      readonly message: AssistantMessage;
      readonly markdown: string;
      readonly statusLabel: string | null;
      readonly isStreaming: boolean;
    }
  | { readonly type: "assistantStatus"; readonly id: string; readonly statusLabel: string };

export const AgentPanel = ({
  websocketUrl,
  selectedThreadId,
  currentPath,
  onSelectThread,
}: AgentPanelProps): React.ReactElement => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeRunHandleRef = useRef<AgentRunHandle | null>(null);
  const [thread, setThread] = useState<AgentThread | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRunning = activeRun !== null;

  const handleCancel = useCallback((): void => {
    activeRunHandleRef.current?.cancel();
  }, []);

  const handleSubmit = useCallback(
    ({ content }: { readonly content: AgentContent }): boolean => {
      if (activeRunHandleRef.current !== null) {
        return false;
      }

      const startedAt = Date.now();
      const optimisticUserMessage = createOptimisticUserMessage(content, currentPath, startedAt);
      let latestThreadSummary: AgentThreadSummary | null = null;
      let runAssistantMessageIds: string[] = [];
      let streamingAssistantMessageIds: string[] = [];
      let hasReconciledUserMessage = false;

      const setStreamingAssistantMessageIds = (nextIds: string[]): void => {
        streamingAssistantMessageIds = nextIds;
        setActiveRun((current) =>
          current === null ? current : { ...current, streamingAssistantMessageIds },
        );
      };

      const startAssistantMessage = (messageId: string): void => {
        if (!runAssistantMessageIds.includes(messageId)) {
          runAssistantMessageIds = [...runAssistantMessageIds, messageId];
        }

        if (!streamingAssistantMessageIds.includes(messageId)) {
          setStreamingAssistantMessageIds([...streamingAssistantMessageIds, messageId]);
        }
      };

      const endAssistantMessage = (messageId: string): void => {
        if (streamingAssistantMessageIds.includes(messageId)) {
          setStreamingAssistantMessageIds(streamingAssistantMessageIds.filter((id) => id !== messageId));
        }
      };

      setRunError(null);
      setError(null);
      setIsLoading(false);
      setMessages((current) => [...current, optimisticUserMessage]);
      setActiveRun({
        runId: null,
        threadId: selectedThreadId,
        startedAt,
        streamingAssistantMessageIds: [],
      });

      activeRunHandleRef.current = startAgentRun(websocketUrl, {
        threadId: selectedThreadId ?? undefined,
        path: currentPath,
        content,
      }, {
        onRunStart: ({ runId, threadId }) => {
          setActiveRun((current) =>
            current === null ? current : { ...current, runId, threadId },
          );
        },
        onEvent: (event) => {
          if (event.type === "thread_created" || event.type === "thread_updated") {
            latestThreadSummary = event.thread;
          }

          if (event.type === "agent_error") {
            setRunError(event.error.message);
            return;
          }

          applyRunEvent(event, {
            onAssistantMessageEnd: endAssistantMessage,
            onAssistantMessageStart: startAssistantMessage,
            reconcileUserMessage: (message) => {
              if (hasReconciledUserMessage) {
                return false;
              }

              hasReconciledUserMessage = true;
              setMessages((current) => replaceMessageById(current, optimisticUserMessage.id, message));
              return true;
            },
            setMessages,
          });
        },
        onRunEnd: () => {
          const elapsed = Date.now() - startedAt;

          setMessages((current) =>
            current.map((message) =>
              message.role === "assistant" && runAssistantMessageIds.includes(message.id)
                ? { ...message, duration: elapsed }
                : message,
            ),
          );
          setActiveRun(null);
          activeRunHandleRef.current = null;

          if (latestThreadSummary !== null) {
            onSelectThread?.(latestThreadSummary);
          }
        },
        onError: (nextError) => {
          setRunError(nextError.message);
          setActiveRun(null);
          activeRunHandleRef.current = null;
        },
      });

      return true;
    },
    [currentPath, onSelectThread, selectedThreadId, websocketUrl],
  );

  useEffect(() => {
    if (selectedThreadId === null) {
      if (activeRunHandleRef.current === null) {
        setThread(null);
        setMessages([]);
        setError(null);
        setIsLoading(false);
      }
      return;
    }

    let isCurrent = true;
    activeRunHandleRef.current?.close();
    activeRunHandleRef.current = null;
    setActiveRun(null);
    setThread(null);
    setMessages([]);
    setError(null);
    setRunError(null);
    setIsLoading(true);

    void getAgentThread(websocketUrl, selectedThreadId)
      .then((nextThread) => {
        if (isCurrent) {
          setThread(nextThread);
          setMessages([...nextThread.messages]);
        }
      })
      .catch((reason) => {
        if (isCurrent) {
          setError(reason instanceof Error ? reason.message : "Failed to load thread.");
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedThreadId, websocketUrl]);

  useEffect(() => {
    return () => {
      activeRunHandleRef.current?.close();
      activeRunHandleRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;

    if (scrollElement === null || isLoading || error !== null) {
      return;
    }

    const scrollToBottom = (): void => {
      scrollElement.scrollTop = scrollElement.scrollHeight;
    };

    const animationFrame = window.requestAnimationFrame(() => {
      scrollToBottom();
      window.requestAnimationFrame(scrollToBottom);
    });
    const timeout = window.setTimeout(scrollToBottom, 150);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
    };
  }, [activeRun, error, isLoading, messages, runError, thread]);

  const composerProps = {
    isRunning,
    onCancel: handleCancel,
    onSubmit: handleSubmit,
  };

  if (selectedThreadId === null && messages.length === 0 && activeRun === null && runError === null) {
    return <AgentEmptyThread {...composerProps} />;
  }

  return (
    <div className="right-prompt-surface">
      <div ref={scrollRef} className="agent-thread-scroll">
        {isLoading ? <AgentPanelState label="Loading thread..." /> : null}
        {error !== null ? <AgentPanelState label={error} variant="error" /> : null}
        {!isLoading && error === null ? (
          messages.length > 0 || activeRun !== null ? (
            <ThreadTranscript messages={messages} activeRun={activeRun} />
          ) : (
            <AgentPanelState label="No displayable messages in this thread." />
          )
        ) : null}
      </div>
      <div className="right-prompt-composer-wrap">
        {runError === null ? null : <div className="agent-run-error">{runError}</div>}
        <RightPromptComposer {...composerProps} />
      </div>
    </div>
  );
};

const ThreadTranscript = ({
  messages,
  activeRun,
}: {
  readonly messages: readonly AgentMessage[];
  readonly activeRun: ActiveRunState | null;
}): React.ReactElement => {
  const items = useMemo(() => buildDisplayItems(messages, activeRun), [activeRun, messages]);

  if (items.length === 0) {
    return <AgentPanelState label="No displayable messages in this thread." />;
  }

  return (
    <div className="agent-thread-content">
      {items.map((item) => {
        if (item.type === "user") {
          return <UserMessageBubble key={item.message.id} message={item.message} />;
        }

        if (item.type === "assistantStatus") {
          return <AssistantStatusBlock key={item.id} label={item.statusLabel} />;
        }

        return (
          <AssistantMessageBlock
            key={item.message.id}
            message={item.message}
            markdown={item.markdown}
            statusLabel={item.statusLabel}
            isStreaming={item.isStreaming}
          />
        );
      })}
    </div>
  );
};

const UserMessageBubble = ({ message }: { readonly message: UserMessage }): React.ReactElement => {
  const text = getTextContent(message.content);
  const attachments = getAttachmentContent(message.content);

  return (
    <div className="agent-message-row user">
      <div className="agent-user-bubble">
        {text.length > 0 ? <div className="agent-user-text">{text}</div> : null}
        {attachments.length > 0 ? (
          <div className="agent-user-attachments">
            {attachments.map((attachment, index) => (
              <UserAttachment key={`${message.id}-${String(index)}`} attachment={attachment} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const UserAttachment = ({
  attachment,
}: {
  readonly attachment: ImageContent | FileContent;
}): React.ReactElement => {
  if (attachment.type === "image") {
    return (
      <div className="agent-user-image-attachment">
        <img src={`data:${attachment.mimeType};base64,${attachment.data}`} alt="Attached image" />
      </div>
    );
  }

  return (
    <div className="agent-user-file-attachment">
      <span>{attachment.filename}</span>
      <small>{attachment.mimeType}</small>
    </div>
  );
};

const AssistantStatusBlock = ({ label }: { readonly label: string }): React.ReactElement => (
  <div className="agent-message-row assistant">
    <div className="agent-worked-label live">{label}</div>
  </div>
);

const AssistantMessageBlock = ({
  message,
  markdown,
  statusLabel,
  isStreaming,
}: {
  readonly message: AssistantMessage;
  readonly markdown: string;
  readonly statusLabel: string | null;
  readonly isStreaming: boolean;
}): React.ReactElement => (
  <div className="agent-message-row assistant">
    {statusLabel === null ? null : (
      <div className={isStreaming ? "agent-worked-label live" : "agent-worked-label"}>{statusLabel}</div>
    )}
    {markdown.length > 0 ? (
      <div className="agent-assistant-markdown">
        <Streamdown mode={isStreaming ? "streaming" : "static"} controls={false} lineNumbers={false}>
          {markdown}
        </Streamdown>
      </div>
    ) : null}
  </div>
);

const AgentPanelState = ({
  label,
  variant = "muted",
}: {
  readonly label: string;
  readonly variant?: "muted" | "error";
}): React.ReactElement => (
  <div className={variant === "error" ? "agent-panel-state error" : "agent-panel-state"}>{label}</div>
);

const buildDisplayItems = (
  messages: readonly AgentMessage[],
  activeRun: ActiveRunState | null,
): DisplayItem[] => {
  const items: DisplayItem[] = [];
  const streamingAssistantMessageIds = activeRun?.streamingAssistantMessageIds ?? [];
  let hasLiveAssistantItem = false;

  for (const message of messages) {
    if (message.role === "user") {
      items.push({ type: "user", message });
      continue;
    }

    if (message.role !== "assistant" || message.content.some((block) => block.type === "toolCall")) {
      continue;
    }

    const isStreaming = streamingAssistantMessageIds.includes(message.id);
    const markdown = getAssistantMarkdown(message);

    if (markdown.length > 0 || isStreaming) {
      hasLiveAssistantItem = hasLiveAssistantItem || isStreaming;
      items.push({
        type: "assistant",
        message,
        markdown,
        statusLabel: isStreaming ? "Working" : formatWorkedDuration(message.duration),
        isStreaming,
      });
    }
  }

  if (activeRun !== null && !hasLiveAssistantItem) {
    items.push({
      type: "assistantStatus",
      id: activeRun.runId ?? "pending-agent-run",
      statusLabel: "Working",
    });
  }

  return items;
};

const applyRunEvent = (
  event: AgentRunEvent,
  options: {
    readonly onAssistantMessageEnd: (messageId: string) => void;
    readonly onAssistantMessageStart: (messageId: string) => void;
    readonly reconcileUserMessage?: (message: UserMessage) => boolean;
    readonly setMessages: React.Dispatch<React.SetStateAction<AgentMessage[]>>;
  },
): void => {
  switch (event.type) {
    case "message_start":
    case "message_end":
      if (event.message.role === "assistant" && event.type === "message_start") {
        options.onAssistantMessageStart(event.message.id);
      }

      if (event.message.role === "user") {
        if (options.reconcileUserMessage?.(event.message) === true) {
          return;
        }

        options.setMessages((current) => upsertMessage(current, event.message));
        return;
      }

      if (event.message.role === "assistant") {
        options.setMessages((current) => upsertMessage(current, event.message));
        if (event.type === "message_end") {
          options.onAssistantMessageEnd(event.message.id);
        }
      }
      return;
    case "message_update":
      if (event.messageType !== "assistant") {
        return;
      }

      const updateMessage = event.message;

      if (isAssistantStreamEvent(updateMessage)) {
        if (isAssistantTextStreamEvent(updateMessage)) {
          options.onAssistantMessageStart(event.messageId);
          options.setMessages((current) => upsertMessage(current, updateMessage.message));
        }
        return;
      }

      if (updateMessage.role === "assistant") {
        options.onAssistantMessageStart(updateMessage.id);
        options.setMessages((current) => upsertMessage(current, updateMessage));
      }
      return;
    default:
      return;
  }
};

const upsertMessage = (messages: readonly AgentMessage[], nextMessage: AgentMessage): AgentMessage[] => {
  const index = messages.findIndex((message) => message.id === nextMessage.id);

  if (index === -1) {
    return [...messages, nextMessage];
  }

  return messages.map((message, messageIndex) => (messageIndex === index ? nextMessage : message));
};

const replaceMessageById = (
  messages: readonly AgentMessage[],
  messageId: string,
  nextMessage: AgentMessage,
): AgentMessage[] => {
  const index = messages.findIndex((message) => message.id === messageId);

  if (index === -1) {
    return upsertMessage(messages, nextMessage);
  }

  return messages.map((message, messageIndex) => (messageIndex === index ? nextMessage : message));
};

const createOptimisticUserMessage = (
  content: AgentContent,
  path: string,
  timestamp: number,
): UserMessage => ({
  role: "user",
  id: `optimistic-user-${String(timestamp)}`,
  timestamp,
  content,
  path,
});

const isAssistantStreamEvent = (value: AgentMessage | AssistantStreamEvent): value is AssistantStreamEvent => {
  return value !== null && typeof value === "object" && "type" in value && value.type !== undefined && !("role" in value);
};

const isAssistantTextStreamEvent = (
  event: AssistantStreamEvent,
): event is Extract<AssistantStreamEvent, { readonly type: "start" | "text_start" | "text_delta" | "text_end" | "done" | "error" }> => {
  return (
    event.type === "start" ||
    event.type === "text_start" ||
    event.type === "text_delta" ||
    event.type === "text_end" ||
    event.type === "done" ||
    event.type === "error"
  );
};

const getAssistantMarkdown = (message: AssistantMessage): string => {
  const textBlocks: string[] = [];

  for (const block of message.content) {
    if (block.type !== "response") {
      continue;
    }

    const text = getTextContent(block.response);

    if (text.length > 0) {
      textBlocks.push(text);
    }
  }

  return textBlocks.join("\n\n").trim();
};

const getTextContent = (content: AgentContent): string =>
  content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.content)
    .join("\n\n")
    .trim();

const getAttachmentContent = (content: AgentContent): readonly (ImageContent | FileContent)[] =>
  content.filter((block): block is ImageContent | FileContent => block.type === "image" || block.type === "file");

const formatWorkedDuration = (durationMs: number): string | null => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `Worked for ${String(seconds)}s`;
  }

  if (seconds <= 0) {
    return `Worked for ${String(minutes)}m`;
  }

  return `Worked for ${String(minutes)}m ${String(seconds)}s`;
};
