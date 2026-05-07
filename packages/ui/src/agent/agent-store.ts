import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  AgentContent,
  AgentMessage,
  AgentProposedPlan,
  AgentRunEvent,
  AgentThread,
  AgentThreadActivity,
  AgentThreadSummary,
  AssistantMessage,
  TextContent,
  UserMessage,
} from "./types";

export interface ActiveRunState {
  readonly runId: string | null;
  readonly threadId: string | null;
  readonly startedAt: number;
  readonly optimisticUserMessageId: string | null;
}

export interface ActiveTurnState {
  readonly turnId: string;
  readonly startedAt: number;
  readonly completedAt: number | null;
  readonly status: "running" | "completed" | "failed" | "interrupted" | "cancelled";
}

export interface AgentChatState {
  readonly thread: AgentThread | null;
  readonly threadSummary: AgentThreadSummary | null;
  readonly messagesById: Record<string, AgentMessage>;
  readonly messageOrder: string[];
  readonly activitiesById: Record<string, AgentThreadActivity>;
  readonly activityOrder: string[];
  readonly proposedPlansById: Record<string, AgentProposedPlan>;
  readonly proposedPlanOrder: string[];
  readonly activeRun: ActiveRunState | null;
  readonly activeTurn: ActiveTurnState | null;
  readonly streamingMessageIds: readonly string[];
  readonly pendingDeltaBuffer: readonly AgentRunEvent[];
  readonly error: string | null;
  readonly loadThread: (thread: AgentThread | null) => void;
  readonly reset: () => void;
  readonly addOptimisticUserMessage: (message: UserMessage, activeRun: ActiveRunState) => void;
  readonly markRunStarted: (input: { readonly runId: string; readonly threadId: string }) => void;
  readonly bufferRuntimeEvent: (event: AgentRunEvent) => void;
  readonly flushBufferedRuntimeEvents: () => void;
  readonly applyRuntimeEvent: (event: AgentRunEvent) => void;
  readonly finishRun: () => void;
  readonly failRun: (message: string) => void;
}

export type AgentChatStore = StoreApi<AgentChatState>;

const emptyCollections = () => ({
  messagesById: {} as Record<string, AgentMessage>,
  messageOrder: [] as string[],
  activitiesById: {} as Record<string, AgentThreadActivity>,
  activityOrder: [] as string[],
  proposedPlansById: {} as Record<string, AgentProposedPlan>,
  proposedPlanOrder: [] as string[],
});

export const createAgentChatStore = (): AgentChatStore =>
  createStore<AgentChatState>((set, get) => ({
    thread: null,
    threadSummary: null,
    ...emptyCollections(),
    activeRun: null,
    activeTurn: null,
    streamingMessageIds: [],
    pendingDeltaBuffer: [],
    error: null,
    loadThread: (thread) => {
      if (thread === null) {
        set({
          thread: null,
          threadSummary: null,
          ...emptyCollections(),
          activeRun: null,
          activeTurn: null,
          streamingMessageIds: [],
          pendingDeltaBuffer: [],
          error: null,
        });
        return;
      }

      set({
        thread,
        threadSummary: toThreadSummary(thread),
        messagesById: Object.fromEntries(thread.messages.map((message) => [message.id, message])),
        messageOrder: thread.messages.map((message) => message.id),
        activitiesById: Object.fromEntries(thread.activities.map((activity) => [activity.id, activity])),
        activityOrder: thread.activities.map((activity) => activity.id),
        proposedPlansById: Object.fromEntries((thread.proposedPlans ?? []).map((plan) => [plan.id, plan])),
        proposedPlanOrder: (thread.proposedPlans ?? []).map((plan) => plan.id),
        activeRun: null,
        activeTurn: null,
        streamingMessageIds: [],
        pendingDeltaBuffer: [],
        error: null,
      });
    },
    reset: () => {
      get().loadThread(null);
    },
    addOptimisticUserMessage: (message, activeRun) => {
      set((state) => ({
        ...state,
        messagesById: { ...state.messagesById, [message.id]: message },
        messageOrder: appendUnique(state.messageOrder, message.id),
        activeRun,
        error: null,
      }));
    },
    markRunStarted: ({ runId, threadId }) => {
      set((state) => ({
        activeRun: state.activeRun === null
          ? { runId, threadId, startedAt: Date.now(), optimisticUserMessageId: null }
          : { ...state.activeRun, runId, threadId },
      }));
    },
    bufferRuntimeEvent: (event) => {
      set((state) => ({
        pendingDeltaBuffer: [...state.pendingDeltaBuffer, event],
      }));
    },
    flushBufferedRuntimeEvents: () => {
      const events = get().pendingDeltaBuffer;
      if (events.length === 0) {
        return;
      }

      set((state) => {
        let next: AgentChatState = { ...state, pendingDeltaBuffer: [] };
        for (const event of coalesceDeltaEvents(events)) {
          next = applyAgentRuntimeEvent(next, event);
        }
        return next;
      });
    },
    applyRuntimeEvent: (event) => {
      set((state) => applyAgentRuntimeEvent(state, event));
    },
    finishRun: () => {
      set((state) => ({
        activeRun: null,
        streamingMessageIds: [],
        pendingDeltaBuffer: [],
        activeTurn: state.activeTurn === null || state.activeTurn.completedAt !== null
          ? state.activeTurn
          : { ...state.activeTurn, status: "completed", completedAt: Date.now() },
      }));
    },
    failRun: (message) => {
      set({
        activeRun: null,
        streamingMessageIds: [],
        pendingDeltaBuffer: [],
        error: message,
      });
    },
  }));

export const applyAgentRuntimeEvent = (state: AgentChatState, event: AgentRunEvent): AgentChatState => {
  switch (event.type) {
    case "thread.created":
    case "thread.updated":
      return {
        ...state,
        threadSummary: event.thread,
      };

    case "turn.started":
      return {
        ...state,
        activeTurn: {
          turnId: event.turnId ?? event.runId,
          startedAt: event.createdAt,
          completedAt: null,
          status: "running",
        },
      };

    case "turn.completed":
      return {
        ...state,
        activeTurn: {
          turnId: event.turnId ?? event.runId,
          startedAt: state.activeTurn?.startedAt ?? event.createdAt,
          completedAt: event.createdAt,
          status: event.status,
        },
        streamingMessageIds: [],
        ...(event.error !== undefined ? { error: event.error.message } : {}),
      };

    case "message.started":
    case "message.completed":
      return upsertMessageEvent(state, event);

    case "content.delta":
      return appendContentDelta(state, event);

    case "item.started":
    case "item.updated":
    case "item.completed":
      return upsertActivity(state, activityFromItemEvent(event));

    case "request.opened":
    case "request.resolved":
      return upsertActivity(state, activityFromRequestEvent(event));

    case "runtime.warning":
      return upsertActivity(state, {
        id: `runtime-warning:${event.sequence}`,
        runId: event.runId,
        turnId: event.turnId,
        kind: "runtime.warning",
        tone: "info",
        status: "completed",
        title: "Warning",
        summary: event.warning.message,
        createdAt: event.createdAt,
        sequence: event.sequence,
        payload: event.warning,
      });

    case "runtime.error":
      return upsertActivity({
        ...state,
        error: event.error.message,
      }, {
        id: `runtime-error:${event.sequence}`,
        runId: event.runId,
        turnId: event.turnId,
        kind: "runtime.error",
        tone: "error",
        status: "failed",
        title: "Error",
        summary: event.error.message,
        createdAt: event.createdAt,
        sequence: event.sequence,
        payload: event.error,
      });
  }
};

const upsertMessageEvent = (
  state: AgentChatState,
  event: Extract<AgentRunEvent, { readonly type: "message.started" | "message.completed" }>,
): AgentChatState => {
  const activeRun = state.activeRun;
  const optimisticId = activeRun?.optimisticUserMessageId;
  const shouldReplaceOptimistic =
    event.message.role === "user" &&
    optimisticId !== null &&
    optimisticId !== undefined &&
    state.messagesById[optimisticId] !== undefined;
  const messagesById = { ...state.messagesById };
  let messageOrder = state.messageOrder;

  if (shouldReplaceOptimistic) {
    delete messagesById[optimisticId];
    messageOrder = messageOrder.map((id) => (id === optimisticId ? event.message.id : id));
  } else {
    messageOrder = appendUnique(messageOrder, event.message.id);
  }

  const previousMessage = messagesById[event.message.id];
  const nextMessage = mergeMessage(previousMessage, event.message);
  const streamingMessageIds = event.message.role === "assistant"
    ? appendUnique(state.streamingMessageIds, event.message.id)
    : state.streamingMessageIds;
  const nextActiveRun = shouldReplaceOptimistic && activeRun !== null
    ? { ...activeRun, optimisticUserMessageId: null }
    : activeRun;

  if (
    !shouldReplaceOptimistic &&
    nextMessage === previousMessage &&
    messageOrder === state.messageOrder &&
    streamingMessageIds === state.streamingMessageIds &&
    nextActiveRun === state.activeRun
  ) {
    return state;
  }

  if (nextMessage !== previousMessage || shouldReplaceOptimistic) {
    messagesById[event.message.id] = nextMessage;
  }

  return {
    ...state,
    messagesById: nextMessage === previousMessage && !shouldReplaceOptimistic ? state.messagesById : messagesById,
    messageOrder,
    activeRun: nextActiveRun,
    streamingMessageIds,
  };
};

const appendContentDelta = (
  state: AgentChatState,
  event: Extract<AgentRunEvent, { readonly type: "content.delta" }>,
): AgentChatState => {
  if (event.streamKind === "assistant_text") {
    const existing = state.messagesById[event.messageId];
    const assistant = existing?.role === "assistant"
      ? existing
      : createStreamingAssistantMessage(event.messageId, event.createdAt);
    const nextMessage = appendAssistantText(assistant, event.delta);
    return {
      ...state,
      messagesById: { ...state.messagesById, [event.messageId]: nextMessage },
      messageOrder: appendUnique(state.messageOrder, event.messageId),
      streamingMessageIds: appendUnique(state.streamingMessageIds, event.messageId),
    };
  }

  if (event.streamKind === "plan_text") {
    const planId = `plan:${event.messageId}`;
    const current = state.proposedPlansById[planId];
    const nextPlan: AgentProposedPlan = {
      id: planId,
      turnId: event.turnId,
      content: `${current?.content ?? ""}${event.delta}`,
      status: "streaming",
      createdAt: current?.createdAt ?? event.createdAt,
      updatedAt: event.createdAt,
      sequence: event.sequence,
    };
    return {
      ...state,
      proposedPlansById: { ...state.proposedPlansById, [planId]: nextPlan },
      proposedPlanOrder: appendUnique(state.proposedPlanOrder, planId),
    };
  }

  return upsertActivity(state, {
    id: `activity:${event.messageId}`,
    runId: event.runId,
    turnId: event.turnId,
    itemId: event.messageId,
    kind: "tool.updated",
    tone: "tool",
    status: "running",
    title: "Tool output",
    summary: event.delta,
    detail: `${state.activitiesById[`activity:${event.messageId}`]?.detail ?? ""}${event.delta}`,
    createdAt: state.activitiesById[`activity:${event.messageId}`]?.createdAt ?? event.createdAt,
    updatedAt: event.createdAt,
    sequence: event.sequence,
    payload: event,
  });
};

const upsertActivity = (state: AgentChatState, activity: AgentThreadActivity): AgentChatState => ({
  ...state,
  activitiesById: {
    ...state.activitiesById,
    [activity.id]: mergeActivity(state.activitiesById[activity.id], activity),
  },
  activityOrder: appendUnique(state.activityOrder, activity.id),
});

const activityFromItemEvent = (
  event: Extract<AgentRunEvent, { readonly type: "item.started" | "item.updated" | "item.completed" }>,
): AgentThreadActivity => {
  const isError = event.item.status === "failed" || event.item.isError === true;
  return {
    id: `activity:${event.item.id}`,
    runId: event.runId,
    turnId: event.turnId,
    itemId: event.item.id,
    kind: event.item.itemType === "reasoning"
      ? "thinking"
      : event.type === "item.started"
        ? "tool.started"
        : event.type === "item.completed"
          ? "tool.completed"
          : "tool.updated",
    tone: event.item.itemType === "reasoning" ? "thinking" : isError ? "error" : "tool",
    status: isError ? "failed" : event.item.status === "completed" ? "completed" : "running",
    title: event.item.title,
    summary: event.item.summary,
    detail: event.item.detail,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    sequence: event.sequence,
    payload: event.item.raw ?? event.item.result ?? event.item.args,
  };
};

const activityFromRequestEvent = (
  event: Extract<AgentRunEvent, { readonly type: "request.opened" | "request.resolved" }>,
): AgentThreadActivity => ({
  id: `request:${event.request.id}`,
  runId: event.runId,
  turnId: event.turnId,
  requestId: event.request.id,
  kind: event.type,
  tone: "request",
  status: event.type === "request.resolved" ? "resolved" : "pending",
  title: event.request.title,
  summary: event.request.summary,
  createdAt: event.createdAt,
  updatedAt: event.createdAt,
  sequence: event.sequence,
  payload: event.request.payload,
});

const coalesceDeltaEvents = (events: readonly AgentRunEvent[]): AgentRunEvent[] => {
  const result: AgentRunEvent[] = [];
  const byKey = new Map<string, Extract<AgentRunEvent, { readonly type: "content.delta" }>>();

  for (const event of events) {
    if (event.type !== "content.delta") {
      result.push(event);
      continue;
    }

    const key = `${event.messageId}:${event.contentIndex}:${event.streamKind}`;
    const current = byKey.get(key);
    if (current === undefined) {
      byKey.set(key, event);
      result.push(event);
      continue;
    }

    const merged = {
      ...current,
      delta: `${current.delta}${event.delta}`,
      createdAt: event.createdAt,
      sequence: event.sequence,
    };
    byKey.set(key, merged);
    const index = result.indexOf(current);
    if (index >= 0) {
      result[index] = merged;
    }
  }

  return result;
};

const mergeMessage = (previous: AgentMessage | undefined, next: AgentMessage): AgentMessage => {
  if (previous?.role === "assistant" && next.role === "assistant") {
    const previousText = getAssistantMarkdown(previous);
    const nextText = getAssistantMarkdown(next);
    if (nextText === previousText || (nextText.length === 0 && previousText.length > 0)) {
      return previous;
    }
  }

  return next;
};

const mergeActivity = (
  previous: AgentThreadActivity | undefined,
  next: AgentThreadActivity,
): AgentThreadActivity => ({
  ...previous,
  ...next,
  createdAt: previous?.createdAt ?? next.createdAt,
  detail: next.detail ?? previous?.detail,
  payload: next.payload ?? previous?.payload,
});

const createStreamingAssistantMessage = (messageId: string, timestamp: number): AssistantMessage => ({
  role: "assistant",
  id: messageId,
  timestamp,
  duration: 0,
  stopReason: "stop",
  content: [
    {
      type: "response",
      response: [{ type: "text", content: "" }],
    },
  ],
});

const appendAssistantText = (message: AssistantMessage, delta: string): AssistantMessage => {
  const firstBlock = message.content.find((block) => block.type === "response");
  if (firstBlock === undefined) {
    return {
      ...message,
      content: [
        ...message.content,
        {
          type: "response",
          response: [{ type: "text", content: delta }],
        },
      ],
    };
  }

  const content = message.content.map((block) => {
    if (block !== firstBlock) {
      return block;
    }

    const firstText = block.response.find((part) => part.type === "text");
    if (firstText === undefined) {
      return {
        ...block,
        response: [{ type: "text" as const, content: delta }, ...block.response],
      };
    }

    return {
      ...block,
      response: block.response.map((part) =>
        part === firstText ? { ...part, content: `${part.content}${delta}` } : part
      ),
    };
  });

  return { ...message, content };
};

export const getAssistantMarkdown = (message: AssistantMessage): string =>
  message.content
    .filter((block) => block.type === "response")
    .flatMap((block) => block.response)
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.content)
    .filter((text) => text.length > 0)
    .join("\n\n")
    .trim();

export const getTextContent = (content: AgentContent): string =>
  content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.content)
    .join("\n\n")
    .trim();

const appendUnique = <T>(values: readonly T[], value: T): T[] =>
  values.includes(value) ? values as T[] : [...values, value];

const toThreadSummary = (thread: AgentThread): AgentThreadSummary => ({
  id: thread.id,
  title: thread.title,
  startPath: thread.startPath,
  lastPath: thread.lastPath,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
  messageCount: thread.messageCount,
});
