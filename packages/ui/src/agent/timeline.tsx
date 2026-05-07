"use client";

import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { memo, useEffect, useMemo, useRef } from "react";

import { ChatMarkdown } from "./chat-markdown";
import { getAssistantMarkdown, getTextContent } from "./agent-store";
import { computeStableRows, deriveTimelineRows, type StableRowsState, type TimelineRow } from "./timeline-model";
import type {
  AgentMessage,
  AssistantMessage,
  FileContent,
  ImageContent,
  UserMessage,
} from "./types";

export interface AgentTimelineProps {
  readonly messages: readonly AgentMessage[];
  readonly isWorking: boolean;
  readonly currentPath: string;
  readonly workspaceRoot?: string;
  readonly onOpenFilePath?: (path: string) => void;
}

export const AgentTimeline = memo(function AgentTimeline({
  messages,
  isWorking,
  currentPath,
  workspaceRoot,
  onOpenFilePath,
}: AgentTimelineProps): React.ReactElement {
  const listRef = useRef<LegendListRef | null>(null);
  const rows = useStableRows(useMemo(
    () =>
      deriveTimelineRows({
        messages,
        isWorking,
      }),
    [isWorking, messages],
  ));

  useEffect(() => {
    if (rows.length > 0) {
      return;
    }

    listRef.current?.scrollToEnd?.({ animated: false });
  }, [rows.length]);

  if (rows.length === 0) {
    return <AgentPanelState label="No displayable messages in this thread." />;
  }

  return (
    <LegendList<TimelineRow>
      ref={listRef}
      data={rows}
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
        />
      )}
    />
  );
});

const TimelineRowContent = memo(function TimelineRowContent({
  row,
  currentPath,
  workspaceRoot,
  onOpenFilePath,
}: {
  readonly row: TimelineRow;
  readonly currentPath: string;
  readonly workspaceRoot?: string;
  readonly onOpenFilePath?: (path: string) => void;
}): React.ReactElement {
  if (row.kind === "status") {
    return <TurnStatusRow state={row.state} />;
  }

  if (row.message.role === "user") {
    return <UserMessageBubble message={row.message} />;
  }

  return (
    <AssistantMessageBlock
      message={row.message}
      currentPath={currentPath}
      workspaceRoot={workspaceRoot}
      onOpenFilePath={onOpenFilePath}
    />
  );
});

const TurnStatusRow = memo(function TurnStatusRow({
  state,
}: {
  readonly state: Extract<TimelineRow, { readonly kind: "status" }>["state"];
}) {
  return (
    <div className="agent-message-row status">
      <div className={`agent-turn-status ${state}`}>{state === "working" ? "Working" : "Worked"}</div>
    </div>
  );
});

const UserMessageBubble = memo(function UserMessageBubble({ message }: { readonly message: UserMessage }) {
  const text = getTextContent(message.content);
  const attachments = message.content.filter(
    (block): block is ImageContent | FileContent => block.type === "image" || block.type === "file",
  );

  return (
    <div className="agent-message-row user">
      <div className="agent-user-bubble">
        {text.length > 0 ? <div className="agent-user-text">{text}</div> : null}
        {attachments.length > 0 ? (
          <div className="agent-user-attachments">
            {attachments.map((attachment, index) => (
              <UserAttachment key={`${message.id}:${String(index)}`} attachment={attachment} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
});

const UserAttachment = ({ attachment }: { readonly attachment: ImageContent | FileContent }) => {
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

const AssistantMessageBlock = memo(function AssistantMessageBlock({
  message,
  currentPath,
  workspaceRoot,
  onOpenFilePath,
}: {
  readonly message: AssistantMessage;
  readonly currentPath: string;
  readonly workspaceRoot?: string;
  readonly onOpenFilePath?: (path: string) => void;
}) {
  const markdown = getAssistantMarkdown(message);

  return (
    <div className="agent-message-row assistant group-assistant">
      {markdown.length > 0 ? (
        <div className="agent-assistant-markdown">
          <ChatMarkdown
            text={markdown}
            cwd={currentPath}
            workspaceRoot={workspaceRoot}
            onOpenFilePath={onOpenFilePath}
          />
        </div>
      ) : null}
    </div>
  );
});

const AgentPanelState = ({ label }: { readonly label: string }): React.ReactElement => (
  <div className="agent-panel-state">{label}</div>
);

const useStableRows = (rows: TimelineRow[]): TimelineRow[] => {
  const stateRef = useRef<StableRowsState>({ byId: new Map(), result: [] });
  stateRef.current = computeStableRows(rows, stateRef.current);
  return stateRef.current.result;
};
