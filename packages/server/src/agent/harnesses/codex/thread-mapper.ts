import { toClientPath } from "../../../filesystem/paths.js";
import type {
  AgentContent,
  AgentMessage,
  AgentProposedPlan,
  AgentThread,
  AgentThreadActivity,
  AgentThreadSummary,
  AssistantMessage,
  StopReason,
  TextContent,
  ToolResultMessage,
} from "../../types.js";

export interface CodexThreadReadResponse {
  readonly thread: CodexThread;
}

export interface CodexThreadListResponse {
  readonly data: CodexThread[];
  readonly nextCursor?: string | null;
  readonly backwardsCursor?: string | null;
}

export interface CodexThread {
  readonly id: string;
  readonly preview?: string;
  readonly name?: string | null;
  readonly cwd: string;
  readonly path?: string | null;
  readonly source?: CodexSessionSource;
  readonly modelProvider?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly turns?: readonly CodexTurn[];
}

type CodexSessionSource = string | { readonly [key: string]: unknown };
const NAVIGATED_DIRECTORY_PATTERN = /\s*<navigated_directory>[\s\S]*?<\/navigated_directory>\s*/gu;

export interface CodexTurn {
  readonly id: string;
  readonly items?: readonly CodexThreadItem[];
  readonly status?: string;
  readonly error?: CodexTurnError | null;
  readonly startedAt?: number | null;
  readonly completedAt?: number | null;
  readonly durationMs?: number | null;
}

interface CodexTurnError {
  readonly message?: string;
  readonly [key: string]: unknown;
}

export type CodexThreadItem =
  | CodexUserMessageItem
  | CodexAgentMessageItem
  | CodexReasoningItem
  | CodexCommandExecutionItem
  | CodexFileChangeItem
  | CodexMcpToolCallItem
  | CodexDynamicToolCallItem
  | CodexKnownCustomItem;

interface CodexBaseItem {
  readonly id: string;
  readonly type: string;
  readonly [key: string]: unknown;
}

interface CodexUserMessageItem extends CodexBaseItem {
  readonly type: "userMessage";
  readonly content: readonly CodexUserInput[];
}

interface CodexAgentMessageItem extends CodexBaseItem {
  readonly type: "agentMessage";
  readonly text: string;
  readonly phase?: string | null;
  readonly memoryCitation?: unknown;
}

interface CodexReasoningItem extends CodexBaseItem {
  readonly type: "reasoning";
  readonly summary?: readonly string[];
  readonly content?: readonly string[];
}

interface CodexCommandExecutionItem extends CodexBaseItem {
  readonly type: "commandExecution";
  readonly command: string;
  readonly cwd: string;
  readonly status: string;
  readonly aggregatedOutput?: string | null;
  readonly exitCode?: number | null;
}

interface CodexFileChangeItem extends CodexBaseItem {
  readonly type: "fileChange";
  readonly changes?: readonly CodexFileUpdateChange[];
  readonly status: string;
}

interface CodexFileUpdateChange {
  readonly path?: string;
  readonly kind?: string;
  readonly diff?: string;
  readonly [key: string]: unknown;
}

interface CodexMcpToolCallItem extends CodexBaseItem {
  readonly type: "mcpToolCall";
  readonly server: string;
  readonly tool: string;
  readonly status: string;
  readonly arguments?: unknown;
  readonly result?: unknown;
  readonly error?: CodexToolError | null;
}

interface CodexDynamicToolCallItem extends CodexBaseItem {
  readonly type: "dynamicToolCall";
  readonly namespace?: string | null;
  readonly tool: string;
  readonly arguments?: unknown;
  readonly status: string;
  readonly contentItems?: readonly unknown[] | null;
  readonly success?: boolean | null;
}

interface CodexToolError {
  readonly message?: string;
  readonly name?: string;
  readonly stack?: string;
  readonly [key: string]: unknown;
}

interface CodexKnownCustomItem extends CodexBaseItem {
  readonly type:
    | "plan"
    | "webSearch"
    | "imageView"
    | "imageGeneration"
    | "hookPrompt"
    | "collabAgentToolCall"
    | "enteredReviewMode"
    | "exitedReviewMode"
    | "contextCompaction";
}

export type CodexUserInput =
  | { readonly type: "text"; readonly text: string; readonly textElements?: readonly unknown[] }
  | { readonly type: "image"; readonly url: string }
  | { readonly type: "localImage"; readonly path: string }
  | { readonly type: "skill"; readonly name: string; readonly path: string }
  | { readonly type: "mention"; readonly name: string; readonly path: string };

export const mapCodexThreadToAgentThread = (
  thread: CodexThread,
  filesystemRoot: string,
): AgentThread => {
  const path = toHarnessPath(thread.cwd, filesystemRoot);
  const allMessages = toAgentMessages(thread, path);
  const messages = allMessages.filter(isTranscriptMessage);
  const activities = toAgentActivities(allMessages);
  const proposedPlans = toAgentProposedPlans(allMessages);
  return {
    ...toThreadSummary(thread, filesystemRoot, countUserMessages(thread)),
    messages,
    activities,
    proposedPlans,
  };
};

export const toThreadSummary = (
  thread: CodexThread,
  filesystemRoot: string,
  messageCount = estimateMessageCount(thread),
): AgentThreadSummary => {
  const path = toHarnessPath(thread.cwd, filesystemRoot);
  const title = thread.name?.trim() || thread.preview?.trim() || "Untitled thread";

  return {
    id: thread.id,
    title,
    startPath: path,
    lastPath: path,
    createdAt: secondsToMilliseconds(thread.createdAt),
    updatedAt: secondsToMilliseconds(thread.updatedAt),
    messageCount,
  };
};

export const countUserMessages = (thread: CodexThread): number => {
  if (!Array.isArray(thread.turns)) {
    return 0;
  }

  let count = 0;

  for (const turn of thread.turns) {
    for (const item of turn.items ?? []) {
      if (item.type === "userMessage") {
        count += 1;
      }
    }
  }

  return count;
};

export const toHarnessPath = (cwd: string, filesystemRoot: string): string => {
  try {
    return toClientPath(filesystemRoot, cwd);
  } catch {
    return cwd;
  }
};

const toAgentMessages = (thread: CodexThread, path: string): AgentMessage[] => {
  const messages: AgentMessage[] = [];

  for (const turn of thread.turns ?? []) {
    const timestamp = turnTimestamp(turn, thread);
    const durationItemId = durationCarrierItemId(turn.items ?? []);

    for (const item of turn.items ?? []) {
      messages.push(...mapCodexThreadItemToAgentMessages(item, turn, thread, path, item.id === durationItemId));
    }

    if (turn.error !== undefined && turn.error !== null) {
      messages.push({
        role: "custom",
        id: `${turn.id}:error`,
        timestamp,
        tag: "codex:turnError",
        content: {
          turnId: turn.id,
          error: turn.error,
        },
      });
    }
  }

  return messages;
};

const isTranscriptMessage = (message: AgentMessage): boolean => {
  if (message.role === "user") {
    return true;
  }

  if (message.role !== "assistant") {
    return false;
  }

  return message.content.some((block) => block.type === "response");
};

const toAgentActivities = (messages: readonly AgentMessage[]): AgentThreadActivity[] =>
  messages.flatMap((message, index): AgentThreadActivity[] => {
    if (message.role === "assistant" && message.content.some((block) => block.type === "thinking")) {
      return [
        {
          id: `activity:${message.id}`,
          itemId: message.id,
          kind: "thinking",
          tone: "thinking",
          status: "completed",
          title: "Thinking",
          summary: getThinkingText(message),
          createdAt: message.timestamp,
          sequence: index,
          payload: message,
        },
      ];
    }

    if (message.role === "toolResult") {
      return [
        {
          id: `activity:${message.id}`,
          itemId: message.toolCallId,
          kind: "tool.completed",
          tone: message.isError ? "error" : "tool",
          status: message.isError ? "failed" : "completed",
          title: toolActivityTitle(message.toolName),
          summary: getTextContent(message.content),
          createdAt: message.timestamp,
          sequence: index,
          payload: message.details ?? message,
        },
      ];
    }

    if (message.role === "custom") {
      return [
        {
          id: `activity:${message.id}`,
          itemId: message.id,
          kind: message.tag === "codex:turnError" ? "runtime.error" : "info",
          tone: message.tag === "codex:turnError" ? "error" : "info",
          status: message.tag === "codex:turnError" ? "failed" : "completed",
          title: customActivityTitle(message),
          createdAt: message.timestamp,
          sequence: index,
          payload: message.content,
        },
      ];
    }

    return [];
  });

const toAgentProposedPlans = (messages: readonly AgentMessage[]): AgentProposedPlan[] =>
  messages.flatMap((message, index): AgentProposedPlan[] => {
    if (message.role !== "custom" || message.tag !== "codex:plan") {
      return [];
    }

    const item = message.content["item"];
    const content = typeof item === "object" && item !== null && "text" in item && typeof item.text === "string"
      ? item.text
      : JSON.stringify(message.content, null, 2);

    return [
      {
        id: `plan:${message.id}`,
        content,
        status: "completed",
        createdAt: message.timestamp,
        updatedAt: message.timestamp,
        sequence: index,
      },
    ];
  });

const getThinkingText = (message: AssistantMessage): string =>
  message.content
    .filter((block): block is Extract<AssistantMessage["content"][number], { readonly type: "thinking" }> =>
      block.type === "thinking"
    )
    .map((block) => block.thinkingText)
    .filter((text) => text.length > 0)
    .join("\n\n");

const getTextContent = (content: AgentContent): string =>
  content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.content)
    .filter((text) => text.length > 0)
    .join("\n\n");

const toolActivityTitle = (toolName: string): string => {
  if (toolName === "commandExecution") return "Command";
  if (toolName === "fileChange") return "File change";
  if (toolName.startsWith("mcp:")) return "MCP tool";
  if (toolName.startsWith("dynamic:")) return "Dynamic tool";
  return toolName;
};

const customActivityTitle = (message: Extract<AgentMessage, { readonly role: "custom" }>): string => {
  if (message.tag === "codex:webSearch") return "Web search";
  if (message.tag === "codex:imageView") return "Image view";
  if (message.tag === "codex:contextCompaction") return "Context compacted";
  if (message.tag === "codex:turnError") return "Runtime error";
  return message.tag?.replace(/^codex:/, "") || "Codex activity";
};

export const mapCodexThreadItemToAgentMessages = (
  item: CodexThreadItem,
  turn: CodexTurn,
  thread: CodexThread,
  path: string,
  includeTurnDuration: boolean,
): AgentMessage[] => {
  const timestamp = turnTimestamp(turn, thread);

  switch (item.type) {
    case "userMessage":
      return [
        {
          role: "user",
          id: item.id,
          timestamp,
          path,
          content: codexUserInputsToAgentContent(item.content),
        },
      ];
    case "agentMessage":
      return [
        {
          role: "assistant",
          id: item.id,
          timestamp,
          duration: includeTurnDuration ? (turn.durationMs ?? 0) : 0,
          provider: thread.modelProvider,
          stopReason: turnStatusToStopReason(turn.status),
          content: [
            {
              type: "response",
              response: [
                {
                  type: "text",
                  content: item.text,
                  metadata: compactRecord({
                    codexType: item.type,
                    phase: item.phase,
                    memoryCitation: item.memoryCitation,
                  }),
                },
              ],
            },
          ],
        },
      ];
    case "reasoning": {
      const thinkingText = [...(item.summary ?? []), ...(item.content ?? [])].join("\n\n");
      return [
        {
          role: "assistant",
          id: item.id,
          timestamp,
          duration: 0,
          provider: thread.modelProvider,
          stopReason: turnStatusToStopReason(turn.status),
          content: [
            {
              type: "thinking",
              thinkingText,
            },
          ],
        },
      ];
    }
    case "commandExecution":
      return [toToolResultMessage(item, timestamp, "commandExecution", commandExecutionContent(item))];
    case "fileChange":
      return [toToolResultMessage(item, timestamp, "fileChange", fileChangeContent(item))];
    case "mcpToolCall":
      return [
        toToolResultMessage(
          item,
          timestamp,
          `mcp:${item.server}/${item.tool}`,
          jsonTextContent(item.result ?? item.error ?? { status: item.status }),
          item.error,
        ),
      ];
    case "dynamicToolCall":
      return [
        toToolResultMessage(
          item,
          timestamp,
          item.namespace ? `dynamic:${item.namespace}/${item.tool}` : `dynamic:${item.tool}`,
          jsonTextContent(item.contentItems ?? { status: item.status, success: item.success }),
          item.success === false ? { message: "Dynamic tool call failed" } : undefined,
        ),
      ];
    default:
      return [
        {
          role: "custom",
          id: item.id,
          timestamp,
          tag: `codex:${item.type}`,
          content: { item },
        },
      ];
  }
};

const durationCarrierItemId = (items: readonly CodexThreadItem[]): string | undefined => {
  const finalAgentMessage = [...items]
    .reverse()
    .find((item): item is CodexAgentMessageItem => item.type === "agentMessage" && item.phase === "final_answer");

  if (finalAgentMessage !== undefined) {
    return finalAgentMessage.id;
  }

  return [...items].reverse().find((item) => item.type === "agentMessage")?.id;
};

const codexUserInputsToAgentContent = (inputs: readonly CodexUserInput[]): AgentContent => {
  const content = inputs.flatMap((input): TextContent[] => {
    switch (input.type) {
      case "text": {
        const text = input.text.replace(NAVIGATED_DIRECTORY_PATTERN, "").trim();
        return text.length === 0 ? [] : [{
          type: "text",
          content: text,
          metadata: compactRecord({
            textElements: input.textElements,
          }),
        }];
      }
      case "image":
        return [{
          type: "text",
          content: `[Image: ${input.url}]`,
          metadata: { codexInput: input },
        }];
      case "localImage":
        return [{
          type: "text",
          content: `[Local image: ${input.path}]`,
          metadata: { codexInput: input },
        }];
      case "skill":
        return [{
          type: "text",
          content: `[$${input.name}]`,
          metadata: { codexInput: input },
        }];
      case "mention":
        return [{
          type: "text",
          content: `[$${input.name}]`,
          metadata: { codexInput: input },
        }];
    }
  });

  return content.length > 0 ? content : [{ type: "text", content: "" }];
};

const toToolResultMessage = (
  item: CodexThreadItem,
  timestamp: number,
  toolName: string,
  content: AgentContent,
  itemError?: CodexToolError | { readonly message: string } | null,
): ToolResultMessage<CodexThreadItem> => {
  const status = typeof item.status === "string" ? item.status : undefined;
  const exitCode = item.type === "commandExecution" ? item.exitCode : undefined;
  const isError = Boolean(itemError) || status === "failed" || status === "declined" || (exitCode ?? 0) !== 0;

  return {
    role: "toolResult",
    id: item.id,
    timestamp,
    toolName,
    toolCallId: item.id,
    content,
    details: item,
    isError,
    error: isError
      ? {
          message: errorMessage(itemError, status, exitCode),
          name: itemError && "name" in itemError ? itemError.name : undefined,
          stack: itemError && "stack" in itemError ? itemError.stack : undefined,
        }
      : undefined,
  };
};

const commandExecutionContent = (item: CodexCommandExecutionItem): AgentContent => {
  const parts = [`$ ${item.command}`];

  if (item.aggregatedOutput !== undefined && item.aggregatedOutput !== null && item.aggregatedOutput !== "") {
    parts.push(item.aggregatedOutput);
  }

  return [{ type: "text", content: parts.join("\n") }];
};

const fileChangeContent = (item: CodexFileChangeItem): AgentContent => {
  const changes = item.changes ?? [];

  if (changes.length === 0) {
    return [{ type: "text", content: `File change ${item.status}` }];
  }

  return [
    {
      type: "text",
      content: changes
        .map((change) => {
          const header = `${change.kind ?? "change"} ${change.path ?? "(unknown path)"}`;
          return change.diff === undefined || change.diff === "" ? header : `${header}\n${change.diff}`;
        })
        .join("\n\n"),
    },
  ];
};

const jsonTextContent = (value: unknown): AgentContent => [
  {
    type: "text",
    content: typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2),
  },
];

const turnTimestamp = (turn: CodexTurn, thread: CodexThread): number => {
  const timestamp = turn.startedAt ?? turn.completedAt ?? thread.updatedAt ?? thread.createdAt;
  return secondsToMilliseconds(timestamp);
};

const turnStatusToStopReason = (status: string | undefined): StopReason => {
  switch (status) {
    case "failed":
      return "error";
    case "interrupted":
      return "aborted";
    default:
      return "stop";
  }
};

const secondsToMilliseconds = (timestamp: number): number => Math.round(timestamp * 1000);

const estimateMessageCount = (thread: CodexThread): number => {
  return countUserMessages(thread);
};

const compactRecord = (record: Record<string, unknown>): Record<string, unknown> | undefined => {
  const entries = Object.entries(record).filter(([, value]) => value !== undefined && value !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const errorMessage = (
  itemError: CodexToolError | { readonly message: string } | null | undefined,
  status: string | undefined,
  exitCode: number | null | undefined,
): string => {
  if (itemError?.message !== undefined && itemError.message !== "") {
    return itemError.message;
  }

  if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
    return `Command exited with code ${exitCode}`;
  }

  return status === undefined ? "Codex tool call failed" : `Codex tool call ${status}`;
};
