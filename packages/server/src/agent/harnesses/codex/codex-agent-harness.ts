import { createReadStream } from "node:fs";

import type {
  AgentContent,
  AgentMessage,
  AgentRunEvent,
  AgentThread,
  AgentThreadGroup,
  AgentThreadSummary,
  AssistantMessage,
  AssistantStreamEvent,
  CancelRunInput,
  CustomMessage,
  GetThreadInput,
  IAgentHarness,
  RetrieveThreadsInput,
  RetrieveThreadsResult,
  SendMessageInput,
  ToolResultMessage,
} from "../../types.js";
import { resolveClientPath } from "../../../filesystem/paths.js";
import {
  CodexStdioAppServerClient,
  type CodexAppServerClient,
  type CodexAppServerNotification,
} from "./app-server-client.js";
import {
  countUserMessages,
  mapCodexThreadToAgentThread,
  mapCodexThreadItemToAgentMessages,
  toThreadSummary,
  type CodexThread,
  type CodexThreadItem,
  type CodexThreadListResponse,
  type CodexThreadReadResponse,
  type CodexTurn,
  type CodexUserInput,
} from "./thread-mapper.js";

const HISTORY_SOURCE_KINDS = ["appServer", "vscode"];
const SERVICE_NAME = "ank1015_app";

export interface CodexAgentHarnessOptions {
  readonly filesystemRoot: string;
  readonly codexBin?: string;
  readonly client?: CodexAppServerClient;
}

export class CodexAgentHarness implements IAgentHarness {
  private readonly filesystemRoot: string;
  private readonly client: CodexAppServerClient;
  private readonly liveThreadMessages = new Map<string, AgentMessage[]>();

  constructor(options: CodexAgentHarnessOptions) {
    this.filesystemRoot = options.filesystemRoot;
    this.client = options.client ?? new CodexStdioAppServerClient({ codexBin: options.codexBin });
  }

  async setup(_input: unknown): Promise<void> {}

  async retrieveThreads(input: RetrieveThreadsInput = {}): Promise<RetrieveThreadsResult> {
    const response = await this.client.request<CodexThreadListResponse>("thread/list", {
      limit: input.limit,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: HISTORY_SOURCE_KINDS,
    });
    const ownThreads = await Promise.all(
      response.data.map(async (thread) => ({
        thread,
        isOwnThread: await this.isOwnCodexThread(thread),
      })),
    );
    const entries = ownThreads
      .filter((entry) => entry.isOwnThread)
      .map((entry) => ({
        thread: entry.thread,
        summary: toThreadSummary(entry.thread, this.filesystemRoot),
      }))
      .filter((entry) => isThreadInRoot(entry.summary, input.rootPath))
      .sort((left, right) => right.summary.updatedAt - left.summary.updatedAt)
      .slice(0, input.limit);
    const summaries = await Promise.all(
      entries.map(async ({ thread, summary }) => ({
        ...summary,
        messageCount: await this.countUserMessages(thread),
      })),
    );

    return { groups: groupThreads(summaries) };
  }

  async getThread(input: GetThreadInput): Promise<AgentThread> {
    const response = await this.client.request<CodexThreadReadResponse>("thread/read", {
      threadId: input.threadId,
      includeTurns: true,
    });

    const thread = mapCodexThreadToAgentThread(response.thread, this.filesystemRoot);
    const messages = mergeAgentMessages(thread.messages, this.liveThreadMessages.get(input.threadId) ?? []);

    return {
      ...thread,
      messages,
      messageCount: messages.filter((message) => message.role === "user").length,
    };
  }

  async *sendMessage(_input: SendMessageInput): AsyncIterable<AgentRunEvent> {
    const isNewThread = _input.threadId === undefined;
    const thread = isNewThread ? await this.startThread(_input.path) : await this.resumeThread(_input.threadId);
    const threadId = thread.id;
    const path = isNewThread ? _input.path : toThreadSummary(thread, this.filesystemRoot).lastPath;
    const queue = new AsyncQueue<CodexAppServerNotification>();
    const pendingNotifications: CodexAppServerNotification[] = [];
    let turnId: string | undefined;
    const unsubscribe = this.client.subscribe((notification) => {
      if (!notificationBelongsToThread(notification, threadId)) {
        return;
      }

      if (turnId === undefined) {
        pendingNotifications.push(notification);
        return;
      }

      if (notificationBelongsToTurn(notification, turnId)) {
        queue.push(notification);
      }
    });

    try {
      const turnResponse = await this.client.request<CodexTurnStartResponse>("turn/start", {
        threadId,
        input: agentContentToCodexInput(_input.content),
      });
      turnId = turnResponse.turn.id;
      const scope = { runId: turnId, threadId };
      const mapper = new CodexLiveTurnMapper({
        scope,
        thread,
        turn: turnResponse.turn,
        path,
        filesystemRoot: this.filesystemRoot,
        readUpdatedThread: () => this.client.request<CodexThreadReadResponse>("thread/read", {
          threadId,
          includeTurns: true,
        }),
      });

      for (const notification of pendingNotifications) {
        if (notificationBelongsToTurn(notification, turnId)) {
          queue.push(notification);
        }
      }

      yield { ...scope, type: "agent_start" };

      if (isNewThread) {
        yield {
          ...scope,
          type: "thread_created",
          thread: toThreadSummary(thread, this.filesystemRoot, 1),
        };
      }

      yield { ...scope, type: "turn_start" };

      for (;;) {
        const notification = await queue.shift();

        if (notification === undefined) {
          break;
        }

        const result = await mapper.handle(notification);

        for (const event of result.events) {
          yield event;
        }

        const agentEnd = result.events.find(isAgentEndEvent);

        if (agentEnd !== undefined) {
          this.rememberLiveThreadMessages(threadId, agentEnd.agentMessages);
        }

        if (result.done) {
          break;
        }
      }
    } finally {
      unsubscribe();
      queue.close();
    }
  }

  async cancelRun(input: CancelRunInput): Promise<void> {
    await this.client.request("turn/interrupt", {
      threadId: input.threadId,
      turnId: input.runId,
    });
  }

  private async countUserMessages(thread: CodexThread): Promise<number> {
    if ((thread.turns ?? []).some((turn) => (turn.items ?? []).length > 0)) {
      return countUserMessages(thread);
    }

    const response = await this.client.request<CodexThreadReadResponse>("thread/read", {
      threadId: thread.id,
      includeTurns: true,
    });
    return countUserMessages(response.thread);
  }

  private async isOwnCodexThread(thread: CodexThread): Promise<boolean> {
    const originator = await readThreadOriginator(thread.path);

    if (originator !== undefined) {
      return originator === SERVICE_NAME;
    }

    return thread.source === "appServer";
  }

  private rememberLiveThreadMessages(threadId: string, messages: readonly AgentMessage[]): void {
    const merged = mergeAgentMessages(this.liveThreadMessages.get(threadId) ?? [], messages);

    if (merged.length > 0) {
      this.liveThreadMessages.set(threadId, merged);
    }
  }

  private async startThread(path: string): Promise<CodexThread> {
    const cwd = resolveClientPath(this.filesystemRoot, path);
    const response = await this.client.request<CodexThreadStartResponse>("thread/start", {
      cwd,
      serviceName: SERVICE_NAME,
    });
    return response.thread;
  }

  private async resumeThread(threadId: string): Promise<CodexThread> {
    const response = await this.client.request<CodexThreadStartResponse>("thread/resume", {
      threadId,
    });
    return response.thread;
  }
}

interface CodexThreadStartResponse {
  readonly thread: CodexThread;
}

interface CodexTurnStartResponse {
  readonly turn: CodexTurn;
}

interface CodexLiveTurnMapperOptions {
  readonly scope: {
    readonly runId: string;
    readonly threadId: string;
  };
  readonly thread: CodexThread;
  readonly turn: CodexTurn;
  readonly path: string;
  readonly filesystemRoot: string;
  readonly readUpdatedThread: () => Promise<CodexThreadReadResponse>;
}

interface CodexLiveTurnMapperResult {
  readonly events: AgentRunEvent[];
  readonly done: boolean;
}

class CodexLiveTurnMapper {
  private readonly scope: CodexLiveTurnMapperOptions["scope"];
  private readonly thread: CodexThread;
  private readonly turn: CodexTurn;
  private readonly path: string;
  private readonly filesystemRoot: string;
  private readonly readUpdatedThread: () => Promise<CodexThreadReadResponse>;
  private readonly messages: AgentMessage[] = [];
  private readonly assistantMessages = new Map<string, AssistantMessage>();
  private readonly toolArgs = new Map<string, unknown>();
  private readonly toolNames = new Map<string, string>();
  private readonly startedItemIds = new Set<string>();

  constructor(options: CodexLiveTurnMapperOptions) {
    this.scope = options.scope;
    this.thread = options.thread;
    this.turn = options.turn;
    this.path = options.path;
    this.filesystemRoot = options.filesystemRoot;
    this.readUpdatedThread = options.readUpdatedThread;
  }

  async handle(notification: CodexAppServerNotification): Promise<CodexLiveTurnMapperResult> {
    switch (notification.method) {
      case "item/started":
        return { events: this.handleItemStarted(notification.params), done: false };
      case "item/agentMessage/delta":
        return { events: this.handleAgentMessageDelta(notification.params), done: false };
      case "item/commandExecution/outputDelta":
      case "item/fileChange/outputDelta":
      case "item/fileChange/patchUpdated":
      case "item/mcpToolCall/progress":
        return { events: this.handleToolUpdate(notification.params), done: false };
      case "item/completed":
        return { events: this.handleItemCompleted(notification.params), done: false };
      case "turn/completed":
        return this.handleTurnCompleted(notification.params);
      case "error":
        return {
          events: [this.toAgentErrorEvent(notification.params)],
          done: true,
        };
      default:
        return { events: [], done: false };
    }
  }

  private handleItemStarted(params: unknown): AgentRunEvent[] {
    const item = notificationItem(params);

    if (item === undefined) {
      return [];
    }

    this.startedItemIds.add(item.id);

    if (item.type === "userMessage") {
      const messages = mapCodexThreadItemToAgentMessages(item, this.turn, this.thread, this.path, false);
      this.messages.push(...messages);
      return messages.flatMap((message) => this.messageStartEndEvents(message));
    }

    if (item.type === "agentMessage") {
      const message = this.createAssistantMessage(item.id, typeof item.text === "string" ? item.text : "", item.phase);
      this.assistantMessages.set(item.id, message);
      this.messages.push(message);
      return [
        {
          ...this.scope,
          type: "message_start",
          messageType: "assistant",
          messageId: message.id,
          message,
        },
      ];
    }

    if (isToolLikeItem(item)) {
      const toolName = toolNameForItem(item);
      const args = toolArgsForItem(item);
      this.toolArgs.set(item.id, args);
      this.toolNames.set(item.id, toolName);
      return [
        {
          ...this.scope,
          type: "tool_execution_start",
          toolCallId: item.id,
          toolName,
          args,
        },
      ];
    }

    return [];
  }

  private handleAgentMessageDelta(params: unknown): AgentRunEvent[] {
    const payload = asRecord(params);
    const itemId = stringField(payload, "itemId");
    const delta = stringField(payload, "delta");

    if (itemId === undefined || delta === undefined) {
      return [];
    }

    const current = this.assistantMessages.get(itemId) ?? this.createAssistantMessage(itemId, "", undefined);
    const updated = this.appendAssistantText(current, delta);
    this.assistantMessages.set(itemId, updated);
    this.replaceMessage(updated);

    const streamEvent: AssistantStreamEvent = {
      type: "text_delta",
      contentIndex: 0,
      delta,
      message: updated,
    };

    return [
      {
        ...this.scope,
        type: "message_update",
        messageType: "assistant",
        messageId: itemId,
        message: streamEvent,
      },
    ];
  }

  private handleToolUpdate(params: unknown): AgentRunEvent[] {
    const payload = asRecord(params);
    const itemId = stringField(payload, "itemId");

    if (itemId === undefined) {
      return [];
    }

    return [
      {
        ...this.scope,
        type: "tool_execution_update",
        toolCallId: itemId,
        toolName: this.toolNames.get(itemId) ?? "codex",
        args: this.toolArgs.get(itemId),
        partialResult: payload,
      },
    ];
  }

  private handleItemCompleted(params: unknown): AgentRunEvent[] {
    const item = notificationItem(params);

    if (item === undefined) {
      return [];
    }

    if (item.type === "userMessage" && this.startedItemIds.has(item.id)) {
      return [];
    }

    if (item.type === "agentMessage") {
      const hadStart = this.assistantMessages.has(item.id);
      const messages = mapCodexThreadItemToAgentMessages(item, this.turn, this.thread, this.path, false);
      const message = messages.find((candidate): candidate is AssistantMessage => candidate.role === "assistant");

      if (message === undefined) {
        return [];
      }

      this.assistantMessages.set(item.id, message);
      this.replaceMessage(message);
      const events: AgentRunEvent[] = [];

      if (!hadStart) {
        events.push({
          ...this.scope,
          type: "message_start",
          messageType: "assistant",
          messageId: message.id,
          message,
        });
      }

      events.push(
        {
          ...this.scope,
          type: "message_end",
          messageType: "assistant",
          messageId: message.id,
          message,
        },
      );
      return events;
    }

    const messages = mapCodexThreadItemToAgentMessages(item, this.turn, this.thread, this.path, false);
    this.messages.push(...messages);
    const events: AgentRunEvent[] = [];

    if (isToolLikeItem(item)) {
      const toolMessage = messages.find((message): message is ToolResultMessage => message.role === "toolResult");
      events.push({
        ...this.scope,
        type: "tool_execution_end",
        toolCallId: item.id,
        toolName: toolNameForItem(item),
        result: item,
        isError: toolMessage?.isError ?? false,
      });
    }

    for (const message of messages) {
      events.push(...this.messageStartEndEvents(message));
    }

    return events;
  }

  private async handleTurnCompleted(params: unknown): Promise<CodexLiveTurnMapperResult> {
    const payload = asRecord(params);
    const turn = asRecord(payload?.["turn"]);
    const status = stringField(turn, "status");
    const events: AgentRunEvent[] = [];
    let messagesForOverlay = this.messages;

    if (status === "failed") {
      events.push(this.toAgentErrorEvent({ error: turn?.["error"] }));
    }

    events.push({ ...this.scope, type: "turn_end" });

    try {
      const response = await this.readUpdatedThread();
      const updatedThread = mapCodexThreadToAgentThread(response.thread, this.filesystemRoot);
      messagesForOverlay = missingAgentMessages(updatedThread.messages, this.messages);
      events.push({
        ...this.scope,
        type: "thread_updated",
        thread: toThreadSummary(response.thread, this.filesystemRoot, countUserMessages(response.thread)),
      });
    } catch {
      events.push({
        ...this.scope,
        type: "thread_updated",
        thread: toThreadSummary(this.thread, this.filesystemRoot),
      });
    }

    events.push({
      ...this.scope,
      type: "agent_end",
      agentMessages: messagesForOverlay,
    });

    return { events, done: true };
  }

  private messageStartEndEvents(message: AgentMessage): AgentRunEvent[] {
    return [
      {
        ...this.scope,
        type: "message_start",
        messageType: message.role,
        messageId: message.id,
        message,
      },
      {
        ...this.scope,
        type: "message_end",
        messageType: message.role,
        messageId: message.id,
        message,
      },
    ];
  }

  private createAssistantMessage(itemId: string, text: string, phase: unknown): AssistantMessage {
    return {
      role: "assistant",
      id: itemId,
      timestamp: Date.now(),
      duration: 0,
      provider: this.thread.modelProvider,
      stopReason: "stop",
      content: [
        {
          type: "response",
          response: [
            {
              type: "text",
              content: text,
              metadata: phase === undefined || phase === null
                ? { codexType: "agentMessage" }
                : { codexType: "agentMessage", phase },
            },
          ],
        },
      ],
    };
  }

  private appendAssistantText(message: AssistantMessage, delta: string): AssistantMessage {
    const firstBlock = message.content[0];

    if (firstBlock?.type !== "response") {
      return message;
    }

    const firstText = firstBlock.response[0];

    if (firstText?.type !== "text") {
      return message;
    }

    return {
      ...message,
      content: [
        {
          type: "response",
          response: [
            {
              ...firstText,
              content: `${firstText.content}${delta}`,
            },
            ...firstBlock.response.slice(1),
          ],
        },
        ...message.content.slice(1),
      ],
    };
  }

  private replaceMessage(message: AgentMessage): void {
    const index = this.messages.findIndex((candidate) => candidate.id === message.id);

    if (index === -1) {
      this.messages.push(message);
      return;
    }

    this.messages[index] = message;
  }

  private toAgentErrorEvent(params: unknown): AgentRunEvent {
    const payload = asRecord(params);
    const error = asRecord(payload?.["error"]);
    const message = stringField(error, "message") ?? "Codex turn failed";

    return {
      ...this.scope,
      type: "agent_error",
      error: {
        phase: "server",
        message,
        canRetry: true,
      },
    };
  }
}

const groupThreads = (threads: readonly AgentThreadSummary[]): AgentThreadGroup[] => {
  const groups = new Map<string, AgentThreadSummary[]>();

  for (const thread of threads) {
    const group = groups.get(thread.startPath) ?? [];
    group.push(thread);
    groups.set(thread.startPath, group);
  }

  return Array.from(groups.entries())
    .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
    .map(([path, groupThreadsForPath]) => ({
      path,
      threads: groupThreadsForPath.sort((left, right) => right.updatedAt - left.updatedAt),
    }));
};

const isAgentEndEvent = (
  event: AgentRunEvent,
): event is Extract<AgentRunEvent, { readonly type: "agent_end" }> =>
  event.type === "agent_end";

const mergeAgentMessages = (
  persistedMessages: readonly AgentMessage[],
  liveMessages: readonly AgentMessage[],
): AgentMessage[] => {
  const seenMessageIds = new Set<string>();
  const seenMessageKeys = new Set<string>();
  const entries: Array<{ readonly message: AgentMessage; readonly index: number }> = [];

  for (const message of persistedMessages) {
    seenMessageIds.add(message.id);
    const key = agentMessageSemanticKey(message);

    if (key !== undefined) {
      seenMessageKeys.add(key);
    }

    entries.push({ message, index: entries.length });
  }

  for (const message of liveMessages) {
    const key = agentMessageSemanticKey(message);

    if (seenMessageIds.has(message.id) || (key !== undefined && seenMessageKeys.has(key))) {
      continue;
    }

    seenMessageIds.add(message.id);
    if (key !== undefined) {
      seenMessageKeys.add(key);
    }

    entries.push({ message, index: entries.length });
  }

  return entries
    .sort((left, right) => {
      const timestampDifference = left.message.timestamp - right.message.timestamp;
      return timestampDifference === 0 ? left.index - right.index : timestampDifference;
    })
    .map((entry) => entry.message);
};

const missingAgentMessages = (
  persistedMessages: readonly AgentMessage[],
  liveMessages: readonly AgentMessage[],
): AgentMessage[] => {
  const persistedIds = new Set(persistedMessages.map((message) => message.id));
  const persistedKeys = new Set(
    persistedMessages
      .map(agentMessageSemanticKey)
      .filter((key): key is string => key !== undefined),
  );

  return liveMessages.filter((message) => {
    const key = agentMessageSemanticKey(message);
    return !persistedIds.has(message.id) && (key === undefined || !persistedKeys.has(key));
  });
};

const agentMessageSemanticKey = (message: AgentMessage): string | undefined => {
  switch (message.role) {
    case "user":
      return `user:${message.path}:${agentContentSignature(message.content)}`;
    case "assistant":
      return `assistant:${assistantContentSignature(message.content)}`;
    case "toolResult":
      return `toolResult:${message.toolName}:${message.toolCallId}:${agentContentSignature(message.content)}`;
    case "custom":
      return undefined;
  }
};

const assistantContentSignature = (content: AssistantMessage["content"]): string => {
  return content
    .map((part) => {
      switch (part.type) {
        case "response":
          return `response:${agentContentSignature(part.response)}`;
        case "thinking":
          return `thinking:${part.thinkingText}`;
        case "toolCall":
          return `toolCall:${part.name}:${part.toolCallId}:${stableStringify(part.arguments)}`;
      }
    })
    .join("\n---\n");
};

const agentContentSignature = (content: AgentContent): string => {
  return content
    .map((part) => {
      switch (part.type) {
        case "text":
          return `text:${part.content}`;
        case "image":
          return `image:${part.mimeType}:${stableStringify(part.metadata)}`;
        case "file":
          return `file:${part.filename}:${part.mimeType}:${stableStringify(part.metadata)}`;
      }
    })
    .join("\n---\n");
};

const stableStringify = (value: unknown): string => {
  if (value === undefined) {
    return "";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`)
    .join(",")}}`;
};

const isThreadInRoot = (thread: AgentThreadSummary, rootPath: string | undefined): boolean => {
  if (rootPath === undefined || rootPath === "") {
    return true;
  }

  return thread.startPath === rootPath || thread.startPath.startsWith(`${rootPath}/`);
};

class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: T | undefined) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();

    if (waiter !== undefined) {
      waiter(value);
      return;
    }

    this.values.push(value);
  }

  shift(): Promise<T | undefined> {
    const value = this.values.shift();

    if (value !== undefined) {
      return Promise.resolve(value);
    }

    if (this.closed) {
      return Promise.resolve(undefined);
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close(): void {
    this.closed = true;

    for (const waiter of this.waiters.splice(0)) {
      waiter(undefined);
    }
  }
}

const agentContentToCodexInput = (content: AgentContent): CodexUserInput[] => {
  const inputs = content.map((block): CodexUserInput => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.content };
      case "image":
        return { type: "text", text: `[Image attachment: ${block.mimeType}]` };
      case "file":
        return { type: "text", text: `[File attachment: ${block.filename} (${block.mimeType})]` };
    }
  });

  return inputs.length > 0 ? inputs : [{ type: "text", text: "" }];
};

const notificationBelongsToThread = (notification: CodexAppServerNotification, threadId: string): boolean => {
  if (notification.method === "error") {
    return true;
  }

  return stringField(asRecord(notification.params), "threadId") === threadId;
};

const notificationBelongsToTurn = (notification: CodexAppServerNotification, turnId: string): boolean => {
  if (notification.method === "error") {
    return true;
  }

  const params = asRecord(notification.params);
  const directTurnId = stringField(params, "turnId");

  if (directTurnId !== undefined) {
    return directTurnId === turnId;
  }

  return stringField(asRecord(params?.["turn"]), "id") === turnId;
};

const notificationItem = (params: unknown): CodexThreadItem | undefined => {
  const item = asRecord(asRecord(params)?.["item"]);
  return item !== undefined && typeof item["id"] === "string" && typeof item["type"] === "string"
    ? item as unknown as CodexThreadItem
    : undefined;
};

const isToolLikeItem = (item: CodexThreadItem): boolean =>
  item.type === "commandExecution" ||
  item.type === "fileChange" ||
  item.type === "mcpToolCall" ||
  item.type === "dynamicToolCall";

const toolNameForItem = (item: CodexThreadItem): string => {
  switch (item.type) {
    case "commandExecution":
      return "commandExecution";
    case "fileChange":
      return "fileChange";
    case "mcpToolCall":
      return `mcp:${item.server}/${item.tool}`;
    case "dynamicToolCall":
      return item.namespace ? `dynamic:${item.namespace}/${item.tool}` : `dynamic:${item.tool}`;
    default:
      return item.type;
  }
};

const toolArgsForItem = (item: CodexThreadItem): unknown => {
  switch (item.type) {
    case "commandExecution":
      return { command: item.command, cwd: item.cwd };
    case "fileChange":
      return { changes: item.changes };
    case "mcpToolCall":
      return item.arguments;
    case "dynamicToolCall":
      return item.arguments;
    default:
      return item;
  }
};

const readThreadOriginator = async (path: string | null | undefined): Promise<string | undefined> => {
  if (path === undefined || path === null || path === "") {
    return undefined;
  }

  const firstLine = await readFirstLine(path);
  const record = parseJsonRecord(firstLine);
  const payload = asRecord(record?.["payload"]);

  return record?.["type"] === "session_meta" ? stringField(payload, "originator") : undefined;
};

const readFirstLine = (path: string): Promise<string | undefined> =>
  new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    const settle = (value: string | undefined): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    };
    const stream = createReadStream(path, { encoding: "utf8" });

    stream.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");

      if (newlineIndex !== -1) {
        settle(buffer.slice(0, newlineIndex));
        stream.destroy();
      }
    });
    stream.on("end", () => settle(buffer === "" ? undefined : buffer));
    stream.on("error", () => settle(undefined));
  });

const parseJsonRecord = (value: string | undefined): Record<string, unknown> | undefined => {
  if (value === undefined) {
    return undefined;
  }

  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const stringField = (record: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
};
