export type AgentContent = readonly (TextContent | ImageContent | FileContent)[];

export interface TextContent {
  readonly type: "text";
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ImageContent {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
  readonly metadata?: Record<string, unknown>;
}

export interface FileContent {
  readonly type: "file";
  readonly data: string;
  readonly mimeType: string;
  readonly filename: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AgentThreadSummary {
  readonly id: string;
  readonly title: string;
  readonly startPath: string;
  readonly lastPath: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messageCount: number;
}

export interface AgentThreadGroup {
  readonly path: string;
  readonly threads: AgentThreadSummary[];
}

export interface AgentThread extends AgentThreadSummary {
  readonly messages: AgentMessage[];
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage | CustomMessage;
export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface UserMessage {
  readonly role: "user";
  readonly id: string;
  readonly timestamp: number;
  readonly content: AgentContent;
  readonly path: string;
}

export interface AssistantMessage {
  readonly role: "assistant";
  readonly id: string;
  readonly timestamp: number;
  readonly duration: number;
  readonly model?: string;
  readonly provider?: string;
  readonly stopReason: StopReason;
  readonly content: AssistantContent;
  readonly usage?: Usage;
  readonly error?: {
    readonly message: string;
    readonly canRetry: boolean;
  };
}

export type AssistantContent = readonly (
  | AssistantResponseContent
  | AssistantThinkingContent
  | AssistantToolCall
)[];

export interface AssistantResponseContent {
  readonly type: "response";
  readonly response: AgentContent;
}

export interface AssistantThinkingContent {
  readonly type: "thinking";
  readonly thinkingText: string;
}

export interface AssistantToolCall {
  readonly type: "toolCall";
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly toolCallId: string;
}

export interface ToolResultMessage<TDetails = unknown> {
  readonly role: "toolResult";
  readonly id: string;
  readonly timestamp: number;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly content: AgentContent;
  readonly details?: TDetails;
  readonly isError: boolean;
  readonly error?: {
    readonly message: string;
    readonly name?: string;
    readonly stack?: string;
  };
}

export interface CustomMessage {
  readonly role: "custom";
  readonly id: string;
  readonly timestamp: number;
  readonly tag?: string;
  readonly content: Record<string, unknown>;
}

export interface Usage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens: number;
  readonly cost?: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
  };
}

export type AgentClientMessage =
  | { readonly type: "retrieveThreads"; readonly requestId: string; readonly rootPath?: string; readonly limit?: number }
  | { readonly type: "getThread"; readonly requestId: string; readonly threadId: string }
  | { readonly type: "ping"; readonly requestId: string };

export type AgentServerMessage =
  | { readonly type: "hello"; readonly serverTime: string }
  | { readonly type: "threads"; readonly requestId: string; readonly groups: AgentThreadGroup[] }
  | { readonly type: "thread"; readonly requestId: string; readonly thread: AgentThread }
  | { readonly type: "error"; readonly requestId?: string; readonly code: string; readonly message: string }
  | { readonly type: "pong"; readonly requestId: string; readonly serverTime: string };
