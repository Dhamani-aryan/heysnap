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
export type AgentTranscriptMessage = UserMessage | AssistantMessage;
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
  readonly isStreaming?: boolean;
}

export interface AgentThreadGroup {
  readonly path: string;
  readonly threads: AgentThreadSummary[];
}

export interface AgentThread extends AgentThreadSummary {
  readonly messages: AgentMessage[];
  readonly activities: AgentThreadActivity[];
  readonly proposedPlans?: AgentProposedPlan[];
}

export interface AgentThreadActivity {
  readonly id: string;
  readonly runId?: string;
  readonly turnId?: string;
  readonly itemId?: string;
  readonly requestId?: string;
  readonly kind:
    | "thinking"
    | "tool.started"
    | "tool.updated"
    | "tool.completed"
    | "request.opened"
    | "request.resolved"
    | "runtime.warning"
    | "runtime.error"
    | "info";
  readonly tone: "thinking" | "tool" | "info" | "error" | "request";
  readonly status: "pending" | "running" | "completed" | "failed" | "resolved";
  readonly title: string;
  readonly summary?: string;
  readonly detail?: string;
  readonly createdAt: number;
  readonly updatedAt?: number;
  readonly sequence?: number;
  readonly payload?: unknown;
}

export interface AgentProposedPlan {
  readonly id: string;
  readonly turnId?: string;
  readonly title?: string;
  readonly content: string;
  readonly status: "streaming" | "completed";
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sequence?: number;
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

export type AgentRuntimeStreamKind =
  | "assistant_text"
  | "reasoning_text"
  | "tool_output"
  | "plan_text"
  | "unknown";

export interface AgentProviderRefs {
  readonly providerThreadId?: string;
  readonly providerTurnId?: string;
  readonly providerItemId?: string;
  readonly providerRequestId?: string;
}

export interface AgentRuntimeEventBase {
  readonly version: 2;
  readonly type: AgentRuntimeEventType;
  readonly runId: string;
  readonly threadId: string;
  readonly turnId?: string;
  readonly sequence: number;
  readonly createdAt: number;
  readonly provider: string;
  readonly providerRefs?: AgentProviderRefs;
}

export type AgentRuntimeEventType =
  | "thread.created"
  | "thread.updated"
  | "turn.started"
  | "turn.completed"
  | "message.started"
  | "message.completed"
  | "content.delta"
  | "item.started"
  | "item.updated"
  | "item.completed"
  | "request.opened"
  | "request.resolved"
  | "runtime.warning"
  | "runtime.error";

export interface AgentRuntimeItem {
  readonly id: string;
  readonly itemType:
    | "reasoning"
    | "plan"
    | "command_execution"
    | "file_change"
    | "mcp_tool_call"
    | "dynamic_tool_call"
    | "web_search"
    | "image_view"
    | "custom"
    | "unknown";
  readonly status: "running" | "completed" | "failed";
  readonly title: string;
  readonly summary?: string;
  readonly detail?: string;
  readonly args?: unknown;
  readonly result?: unknown;
  readonly isError?: boolean;
  readonly raw?: unknown;
}

export interface AgentRuntimeRequest {
  readonly id: string;
  readonly requestType:
    | "command_execution_approval"
    | "file_change_approval"
    | "tool_user_input"
    | "unknown";
  readonly title: string;
  readonly summary?: string;
  readonly payload?: unknown;
  readonly decision?: "accept" | "deny" | "cancel";
}

export type AgentRunEvent =
  | (AgentRuntimeEventBase & {
      readonly type: "thread.created";
      readonly thread: AgentThreadSummary;
    })
  | (AgentRuntimeEventBase & {
      readonly type: "thread.updated";
      readonly thread: AgentThreadSummary;
    })
  | (AgentRuntimeEventBase & {
      readonly type: "turn.started";
      readonly input?: AgentContent;
      readonly path?: string;
    })
  | (AgentRuntimeEventBase & {
      readonly type: "turn.completed";
      readonly status: "completed" | "failed" | "interrupted" | "cancelled";
      readonly error?: AgentErrorPayload;
    })
  | (AgentRuntimeEventBase & {
      readonly type: "message.started";
      readonly messageType: AgentMessageType;
      readonly messageId: string;
      readonly message: AgentMessage;
    })
  | (AgentRuntimeEventBase & {
      readonly type: "message.completed";
      readonly messageType: AgentMessageType;
      readonly messageId: string;
      readonly message: AgentMessage;
    })
  | (AgentRuntimeEventBase & {
      readonly type: "content.delta";
      readonly messageId: string;
      readonly contentIndex: number;
      readonly streamKind: AgentRuntimeStreamKind;
      readonly delta: string;
    })
  | (AgentRuntimeEventBase & {
      readonly type: "item.started" | "item.updated" | "item.completed";
      readonly item: AgentRuntimeItem;
    })
  | (AgentRuntimeEventBase & {
      readonly type: "request.opened" | "request.resolved";
      readonly request: AgentRuntimeRequest;
    })
  | (AgentRuntimeEventBase & {
      readonly type: "runtime.warning";
      readonly warning: AgentErrorPayload;
    })
  | (AgentRuntimeEventBase & {
      readonly type: "runtime.error";
      readonly error: AgentErrorPayload;
    });

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
  | { readonly type: "cancelRun"; readonly requestId: string; readonly threadId: string; readonly runId: string };

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
  | { readonly type: "error"; readonly requestId?: string; readonly code: string; readonly message: string };
