import { getAssistantMarkdown, getTextContent } from "./agent-store";
import type { AgentMessage, AgentTranscriptMessage } from "./types";

export type TimelineRow =
  | { readonly kind: "message"; readonly id: string; readonly createdAt: number; readonly message: AgentTranscriptMessage }
  | { readonly kind: "status"; readonly id: string; readonly createdAt: number; readonly state: "working" | "worked" };

export interface StableRowsState {
  readonly byId: Map<string, TimelineRow>;
  readonly result: TimelineRow[];
}

export const deriveTimelineRows = ({
  messages,
  isWorking,
}: {
  readonly messages: readonly AgentMessage[];
  readonly isWorking: boolean;
}): TimelineRow[] => {
  const transcriptMessages = messages.filter(isTranscriptMessage);
  const activeUserMessageId = isWorking ? findLastUserMessageId(transcriptMessages) : null;
  const rows: TimelineRow[] = [];

  for (const message of transcriptMessages) {
    rows.push({
      kind: "message",
      id: `message:${message.id}`,
      createdAt: message.timestamp,
      message,
    });

    if (message.role === "user") {
      rows.push({
        kind: "status",
        id: `status:${message.id}`,
        createdAt: message.timestamp,
        state: message.id === activeUserMessageId ? "working" : "worked",
      });
    }
  }

  return rows;
};

export const computeStableRows = (rows: TimelineRow[], previous: StableRowsState): StableRowsState => {
  const next = new Map<string, TimelineRow>();
  let changed = rows.length !== previous.result.length;
  const result = rows.map((row, index) => {
    const previousRow = previous.byId.get(row.id);
    const nextRow = previousRow && rowEqual(previousRow, row) ? previousRow : row;
    next.set(row.id, nextRow);
    if (!changed && previous.result[index] !== nextRow) {
      changed = true;
    }
    return nextRow;
  });
  return changed ? { byId: next, result } : previous;
};

const rowEqual = (left: TimelineRow, right: TimelineRow): boolean => {
  if (left.kind !== right.kind || left.id !== right.id) return false;
  if (left.kind === "status") return left.state === (right as typeof left).state;
  return messagesHaveSameVisibleContent(left.message, (right as typeof left).message);
};

const isTranscriptMessage = (message: AgentMessage): message is AgentTranscriptMessage =>
  message.role === "user" || message.role === "assistant";

const findLastUserMessageId = (messages: readonly AgentTranscriptMessage[]): string | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message.id;
  }
  return null;
};

const messagesHaveSameVisibleContent = (
  left: AgentTranscriptMessage,
  right: AgentTranscriptMessage,
): boolean => {
  if (left.role !== right.role) return false;
  if (left.role === "assistant" && right.role === "assistant") {
    return getAssistantMarkdown(left) === getAssistantMarkdown(right);
  }
  if (left.role === "user" && right.role === "user") {
    return getTextContent(left.content) === getTextContent(right.content) && attachmentSignature(left) === attachmentSignature(right);
  }
  return false;
};

const attachmentSignature = (message: Extract<AgentTranscriptMessage, { readonly role: "user" }>): string =>
  message.content
    .filter((block) => block.type === "image" || block.type === "file")
    .map((block) => block.type === "file"
      ? `file:${block.filename}:${block.mimeType}:${block.data.length}`
      : `image:${block.mimeType}:${block.data.length}`)
    .join("|");
