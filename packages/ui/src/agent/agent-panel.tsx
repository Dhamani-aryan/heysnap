"use client";

import { Streamdown } from "streamdown";
import { useEffect, useMemo, useState } from "react";

import { getAgentThread } from "./agent-client";
import { AgentEmptyThread } from "./empty-thread";
import { RightPromptComposer } from "./prompt-composer";
import type {
  AgentContent,
  AgentMessage,
  AgentThread,
  AssistantMessage,
  FileContent,
  ImageContent,
  TextContent,
  UserMessage,
} from "./types";

export interface AgentPanelProps {
  readonly websocketUrl: string;
  readonly selectedThreadId: string | null;
}

type DisplayItem =
  | { readonly type: "user"; readonly message: UserMessage }
  | { readonly type: "assistant"; readonly message: AssistantMessage; readonly markdown: string };

export const AgentPanel = ({ websocketUrl, selectedThreadId }: AgentPanelProps): React.ReactElement => {
  const [thread, setThread] = useState<AgentThread | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedThreadId === null) {
      setThread(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let isCurrent = true;
    setThread(null);
    setError(null);
    setIsLoading(true);

    void getAgentThread(websocketUrl, selectedThreadId)
      .then((nextThread) => {
        if (isCurrent) {
          setThread(nextThread);
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

  if (selectedThreadId === null) {
    return <AgentEmptyThread />;
  }

  return (
    <div className="right-prompt-surface">
      <div className="agent-thread-scroll">
        {isLoading ? <AgentPanelState label="Loading thread..." /> : null}
        {error !== null ? <AgentPanelState label={error} variant="error" /> : null}
        {!isLoading && error === null && thread !== null ? <StaticThread thread={thread} /> : null}
      </div>
      <div className="right-prompt-composer-wrap">
        <RightPromptComposer />
      </div>
    </div>
  );
};

const StaticThread = ({ thread }: { readonly thread: AgentThread }): React.ReactElement => {
  const items = useMemo(() => buildDisplayItems(thread.messages), [thread.messages]);

  if (items.length === 0) {
    return <AgentPanelState label="No displayable messages in this thread." />;
  }

  return (
    <div className="agent-thread-content">
      {items.map((item) =>
        item.type === "user" ? (
          <UserMessageBubble key={item.message.id} message={item.message} />
        ) : (
          <AssistantMessageBlock key={item.message.id} message={item.message} markdown={item.markdown} />
        ),
      )}
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

const AssistantMessageBlock = ({
  message,
  markdown,
}: {
  readonly message: AssistantMessage;
  readonly markdown: string;
}): React.ReactElement => (
  <div className="agent-message-row assistant">
    <div className="agent-worked-label">{formatWorkedDuration(message.duration)}</div>
    <div className="agent-assistant-markdown">
      <Streamdown>{markdown}</Streamdown>
    </div>
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

const buildDisplayItems = (messages: readonly AgentMessage[]): DisplayItem[] => {
  const items: DisplayItem[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      items.push({ type: "user", message });
      continue;
    }

    if (message.role !== "assistant" || message.content.some((block) => block.type === "toolCall")) {
      continue;
    }

    const markdown = getAssistantMarkdown(message);

    if (markdown.length > 0) {
      items.push({ type: "assistant", message, markdown });
    }
  }

  return items;
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

const formatWorkedDuration = (durationMs: number): string => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "Worked for less than a second";
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
