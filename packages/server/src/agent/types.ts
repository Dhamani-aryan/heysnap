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

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage | CustomMessage;
export type AgentMessageType = AgentMessage["role"];
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
  readonly error?: AssistantMessageError;
}

export interface AssistantMessageError {
  readonly message: string;
  readonly canRetry: boolean;
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

export interface RetrieveThreadsInput {
  readonly rootPath?: string;
  readonly limit?: number;
}

export interface RetrieveThreadsResult {
  readonly groups: AgentThreadGroup[];
}

export interface GetThreadInput {
  readonly threadId: string;
}

export interface SendMessageInput {
  readonly threadId?: string;
  readonly path: string;
  readonly content: AgentContent;
}

export interface CancelRunInput {
  readonly threadId: string;
  readonly runId: string;
}

export interface SetupInput {
  readonly install?: boolean;
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiVersion?: string;
}

export interface IAgentHarness {
  setup(input: SetupInput): Promise<void>;
  retrieveThreads(input: RetrieveThreadsInput): Promise<RetrieveThreadsResult>;
  getThread(input: GetThreadInput): Promise<AgentThread>;
  sendMessage(input: SendMessageInput): AsyncIterable<AgentRunEvent>;
  cancelRun?(input: CancelRunInput): Promise<void>;
}

export interface AgentErrorPayload {
  readonly phase: "model" | "tool" | "limit" | "hook" | "server";
  readonly message: string;
  readonly canRetry: boolean;
  readonly attempts?: number;
}

export type AssistantStreamEvent =
  | { readonly type: "start"; readonly message: AssistantMessage }
  | { readonly type: "text_start"; readonly contentIndex: number; readonly message: AssistantMessage }
  | {
      readonly type: "text_delta";
      readonly contentIndex: number;
      readonly delta: string;
      readonly message: AssistantMessage;
    }
  | {
      readonly type: "text_end";
      readonly contentIndex: number;
      readonly content: AgentContent;
      readonly message: AssistantMessage;
    }
  | { readonly type: "thinking_start"; readonly contentIndex: number; readonly message: AssistantMessage }
  | {
      readonly type: "thinking_delta";
      readonly contentIndex: number;
      readonly delta: string;
      readonly message: AssistantMessage;
    }
  | {
      readonly type: "thinking_end";
      readonly contentIndex: number;
      readonly content: string;
      readonly message: AssistantMessage;
    }
  | { readonly type: "toolcall_start"; readonly contentIndex: number; readonly message: AssistantMessage }
  | {
      readonly type: "toolcall_delta";
      readonly contentIndex: number;
      readonly delta: string;
      readonly message: AssistantMessage;
    }
  | {
      readonly type: "toolcall_end";
      readonly contentIndex: number;
      readonly toolCall: AssistantToolCall;
      readonly message: AssistantMessage;
    }
  | {
      readonly type: "done";
      readonly reason: Extract<StopReason, "stop" | "length" | "toolUse">;
      readonly message: AssistantMessage;
    }
  | {
      readonly type: "error";
      readonly reason: Extract<StopReason, "aborted" | "error">;
      readonly message: AssistantMessage;
    };

export type AgentRunEvent = RunScopedEvent<AgentEventPayload>;

export type RunScopedEvent<TEvent extends AgentEventPayload> = TEvent & {
  readonly runId: string;
  readonly threadId: string;
};

export type AgentEventPayload =
  | { readonly type: "agent_start" }
  | { readonly type: "turn_start" }
  | { readonly type: "thread_created"; readonly thread: AgentThreadSummary }
  | { readonly type: "thread_updated"; readonly thread: AgentThreadSummary }
  | {
      readonly type: "message_start";
      readonly messageType: AgentMessageType;
      readonly messageId: string;
      readonly message: AgentMessage;
    }
  | {
      readonly type: "message_update";
      readonly messageType: "assistant" | "custom";
      readonly messageId: string;
      readonly message: AgentMessage | AssistantStreamEvent;
    }
  | {
      readonly type: "message_end";
      readonly messageType: AgentMessageType;
      readonly messageId: string;
      readonly message: AgentMessage;
    }
  | {
      readonly type: "tool_execution_start";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly args: unknown;
    }
  | {
      readonly type: "tool_execution_update";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly args: unknown;
      readonly partialResult: unknown;
    }
  | {
      readonly type: "tool_execution_end";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly result: unknown;
      readonly isError: boolean;
    }
  | { readonly type: "turn_end" }
  | { readonly type: "agent_end"; readonly agentMessages: AgentMessage[] }
  | { readonly type: "agent_error"; readonly error: AgentErrorPayload };

export type AgentClientMessage =
  | { readonly type: "retrieveThreads"; readonly requestId: string; readonly rootPath?: string; readonly limit?: number }
  | { readonly type: "getThread"; readonly requestId: string; readonly threadId: string }
  | {
      readonly type: "sendMessage";
      readonly requestId: string;
      readonly threadId?: string;
      readonly path: string;
      readonly content: AgentContent;
    }
  | { readonly type: "cancelRun"; readonly requestId: string; readonly threadId: string; readonly runId: string }
  | { readonly type: "ping"; readonly requestId: string };

export type AgentServerMessage =
  | { readonly type: "hello"; readonly serverTime: string }
  | { readonly type: "threads"; readonly requestId: string; readonly groups: AgentThreadGroup[] }
  | { readonly type: "thread"; readonly requestId: string; readonly thread: AgentThread }
  | { readonly type: "run_start"; readonly requestId: string; readonly runId: string; readonly threadId: string }
  | {
      readonly type: "event";
      readonly requestId: string;
      readonly runId: string;
      readonly threadId: string;
      readonly event: AgentRunEvent;
    }
  | { readonly type: "run_end"; readonly requestId: string; readonly runId: string; readonly threadId: string }
  | { readonly type: "error"; readonly requestId?: string; readonly code: string; readonly message: string }
  | { readonly type: "pong"; readonly requestId: string; readonly serverTime: string };
