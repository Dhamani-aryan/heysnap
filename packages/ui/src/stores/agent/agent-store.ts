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
} from "../../agent/types";

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
  readonly status: "running" | "reconnecting" | "completed" | "failed" | "interrupted" | "cancelled";
}

export type AgentTimelineRow =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly messageId: string;
      readonly role: "user" | "assistant";
      readonly createdAt: number;
    }
  | {
      readonly kind: "status";
      readonly id: string;
      readonly messageId: string;
      readonly createdAt: number;
    };

export interface AgentChatState {
  readonly selectedThreadId: string | null;
  readonly loadStatus: "idle" | "loading" | "success" | "error";
  readonly loadError: string | null;
  readonly runError: string | null;
  readonly thread: AgentThread | null;
  readonly threadSummary: AgentThreadSummary | null;
  readonly messagesById: Record<string, AgentMessage>;
  readonly messageOrder: string[];
  readonly messageIdAliases: Readonly<Record<string, string>>;
  readonly replayedAssistantTextBySourceId: Readonly<Record<string, string>>;
  readonly timelineRows: readonly AgentTimelineRow[];
  readonly activitiesById: Record<string, AgentThreadActivity>;
  readonly activityOrder: string[];
  readonly proposedPlansById: Record<string, AgentProposedPlan>;
  readonly proposedPlanOrder: string[];
  readonly activeRun: ActiveRunState | null;
  readonly activeTurn: ActiveTurnState | null;
  readonly activeCompactionItemIds: readonly string[];
  readonly streamingMessageIds: readonly string[];
  readonly pendingDeltaBuffer: readonly AgentRunEvent[];
  readonly error: string | null;
  readonly setSelectedThreadId: (threadId: string | null) => void;
  readonly setThreadLoading: (threadId: string) => void;
  readonly setLoadError: (message: string) => void;
  readonly setRunError: (message: string | null) => void;
  readonly loadThread: (thread: AgentThread | null) => void;
  readonly reset: () => void;
  readonly addOptimisticUserMessage: (message: UserMessage, activeRun: ActiveRunState) => void;
  readonly startEditedUserMessageRun: (input: {
    readonly messageId: string;
    readonly content: AgentContent;
    readonly activeRun: ActiveRunState;
  }) => void;
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
  messageIdAliases: {} as Record<string, string>,
  replayedAssistantTextBySourceId: {} as Record<string, string>,
  timelineRows: [] as AgentTimelineRow[],
  activitiesById: {} as Record<string, AgentThreadActivity>,
  activityOrder: [] as string[],
  proposedPlansById: {} as Record<string, AgentProposedPlan>,
  proposedPlanOrder: [] as string[],
});

export const createAgentChatStore = (): AgentChatStore =>
  createStore<AgentChatState>((set, get) => ({
    selectedThreadId: null,
    loadStatus: "idle",
    loadError: null,
    runError: null,
    thread: null,
    threadSummary: null,
    ...emptyCollections(),
    activeRun: null,
    activeTurn: null,
    activeCompactionItemIds: [],
    streamingMessageIds: [],
    pendingDeltaBuffer: [],
    error: null,
    setSelectedThreadId: (threadId) => {
      set({ selectedThreadId: threadId });
    },
    setThreadLoading: (threadId) => {
      set({
        selectedThreadId: threadId,
        loadStatus: "loading",
        loadError: null,
      });
    },
    setLoadError: (message) => {
      set({
        loadStatus: "error",
        loadError: message,
      });
    },
    setRunError: (message) => {
      set({
        runError: message,
        error: message,
      });
    },
    loadThread: (thread) => {
      if (thread === null) {
        set({
          selectedThreadId: null,
          loadStatus: "idle",
          loadError: null,
          runError: null,
          thread: null,
          threadSummary: null,
          ...emptyCollections(),
          activeRun: null,
          activeTurn: null,
          activeCompactionItemIds: [],
          streamingMessageIds: [],
          pendingDeltaBuffer: [],
          error: null,
        });
        return;
      }

      const messagesById = Object.fromEntries(thread.messages.map((message) => [message.id, message]));
      const messageOrder = thread.messages.map((message) => message.id);

      set({
        selectedThreadId: thread.id,
        loadStatus: "success",
        loadError: null,
        runError: null,
        thread,
        threadSummary: agentThreadToSummary(thread),
          messagesById,
          messageOrder,
          messageIdAliases: {},
          replayedAssistantTextBySourceId: {},
          timelineRows: deriveAgentTimelineRows(messageOrder, messagesById),
        activitiesById: Object.fromEntries(thread.activities.map((activity) => [activity.id, activity])),
        activityOrder: thread.activities.map((activity) => activity.id),
        proposedPlansById: Object.fromEntries((thread.proposedPlans ?? []).map((plan) => [plan.id, plan])),
        proposedPlanOrder: (thread.proposedPlans ?? []).map((plan) => plan.id),
        activeRun: null,
        activeTurn: null,
        activeCompactionItemIds: [],
        streamingMessageIds: [],
        pendingDeltaBuffer: [],
        error: null,
      });
    },
    reset: () => {
      get().loadThread(null);
    },
    addOptimisticUserMessage: (message, activeRun) => {
      set((state) => {
        const messagesById = { ...state.messagesById, [message.id]: message };
        const messageOrder = appendUnique(state.messageOrder, message.id);

        return {
          ...state,
          messagesById,
          messageOrder,
          timelineRows: updateTimelineRows(state.timelineRows, messageOrder, messagesById),
          activeRun,
          activeCompactionItemIds: [],
          runError: null,
          error: null,
        };
      });
    },
    startEditedUserMessageRun: ({ messageId, content, activeRun }) => {
      set((state) => {
        const message = state.messagesById[messageId];

        if (message?.role !== "user") {
          return state;
        }

        const messageIndex = state.messageOrder.indexOf(messageId);

        if (messageIndex < 0) {
          return state;
        }

        const messageOrder = state.messageOrder.slice(0, messageIndex + 1);
        const editedMessage: UserMessage = { ...message, content };
        const messagesById = Object.fromEntries(
          messageOrder.flatMap((id) => {
            const nextMessage = id === messageId ? editedMessage : state.messagesById[id];
            return nextMessage === undefined ? [] : [[id, nextMessage] as const];
          }),
        ) as Record<string, AgentMessage>;
        const threadMessages = messageOrder
          .map((id) => messagesById[id])
          .filter((candidate): candidate is AgentMessage => candidate !== undefined);
        const thread = state.thread === null
          ? null
          : {
              ...state.thread,
              messages: threadMessages,
              activities: [],
              proposedPlans: [],
              messageCount: threadMessages.filter((candidate) => candidate.role === "user").length,
              updatedAt: Date.now(),
            };

        return {
          ...state,
          thread,
          threadSummary: thread === null ? state.threadSummary : agentThreadToSummary(thread),
          messagesById,
          messageOrder,
          messageIdAliases: {},
          replayedAssistantTextBySourceId: {},
          timelineRows: deriveAgentTimelineRows(messageOrder, messagesById),
          activitiesById: {},
          activityOrder: [],
          proposedPlansById: {},
          proposedPlanOrder: [],
          activeRun,
          activeTurn: null,
          activeCompactionItemIds: [],
          streamingMessageIds: [],
          pendingDeltaBuffer: [],
          runError: null,
          error: null,
        };
      });
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
        activeCompactionItemIds: [],
        streamingMessageIds: [],
        pendingDeltaBuffer: [],
        runError: null,
        error: null,
        activeTurn: state.activeTurn === null || state.activeTurn.completedAt !== null
          ? state.activeTurn
          : { ...state.activeTurn, status: "completed", completedAt: Date.now() },
      }));
    },
    failRun: (message) => {
      set({
        activeRun: null,
        activeCompactionItemIds: [],
        streamingMessageIds: [],
        pendingDeltaBuffer: [],
        runError: message,
        error: message,
      });
    },
  }));

export const applyAgentRuntimeEvent = (state: AgentChatState, event: AgentRunEvent): AgentChatState => {
  const baseState = resumeActiveTurnAfterReconnect(state, event);

  switch (event.type) {
    case "thread.created":
    case "thread.updated":
      return {
        ...baseState,
        threadSummary: event.thread,
      };

    case "turn.started":
      return {
        ...baseState,
        activeTurn: {
          turnId: event.turnId ?? event.runId,
          startedAt: event.createdAt,
          completedAt: null,
          status: "running",
        },
      };

    case "turn.completed":
      return {
        ...baseState,
        activeTurn: {
          turnId: event.turnId ?? event.runId,
          startedAt: baseState.activeTurn?.startedAt ?? event.createdAt,
          completedAt: event.createdAt,
          status: event.status,
        },
        streamingMessageIds: [],
        ...(event.error !== undefined ? { error: event.error.message } : {}),
      };

    case "message.started":
    case "message.completed":
      return upsertMessageEvent(baseState, event);

    case "content.delta":
      return appendContentDelta(baseState, event);

    case "item.started":
    case "item.updated":
    case "item.completed":
      return upsertActivity(updateCompactionState(baseState, event), activityFromItemEvent(event));

    case "request.opened":
    case "request.resolved":
      return upsertActivity(baseState, activityFromRequestEvent(event));

    case "runtime.warning": {
      const warningState = event.warning.canRetry && baseState.activeTurn !== null
        ? {
            ...baseState,
            activeTurn: {
              ...baseState.activeTurn,
              status: "reconnecting" as const,
            },
          }
        : baseState;

      return upsertActivity(warningState, {
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
    }

    case "runtime.error":
      return upsertActivity({
        ...baseState,
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

const resumeActiveTurnAfterReconnect = (
  state: AgentChatState,
  event: AgentRunEvent,
): AgentChatState => {
  if (
    state.activeTurn === null ||
    state.activeTurn.status !== "reconnecting" ||
    event.type === "runtime.warning" ||
    event.type === "thread.created" ||
    event.type === "thread.updated"
  ) {
    return state;
  }

  return {
    ...state,
    activeTurn: {
      ...state.activeTurn,
      status: "running",
    },
  };
};

const updateCompactionState = (
  state: AgentChatState,
  event: Extract<AgentRunEvent, { readonly type: "item.started" | "item.updated" | "item.completed" }>,
): AgentChatState => {
  if (event.item.itemType !== "context_compaction") {
    return state;
  }

  if (event.type === "item.started") {
    return {
      ...state,
      activeCompactionItemIds: appendUnique(state.activeCompactionItemIds, event.item.id),
    };
  }

  if (event.type === "item.completed") {
    return {
      ...state,
      activeCompactionItemIds: state.activeCompactionItemIds.filter((itemId) => itemId !== event.item.id),
    };
  }

  return state;
};

const upsertMessageEvent = (
  state: AgentChatState,
  event: Extract<AgentRunEvent, { readonly type: "message.started" | "message.completed" }>,
): AgentChatState => {
  const activeRun = state.activeRun;
  const optimisticId = activeRun?.optimisticUserMessageId;
  const incomingMessageId = event.message.id;
  const existingAliasKey = state.messageIdAliases[incomingMessageId];
  const optimisticReplacementKey =
    event.message.role === "user" &&
    optimisticId !== null &&
    optimisticId !== undefined &&
    state.messagesById[optimisticId] !== undefined
      ? optimisticId
      : null;
  const equivalentMessageKey = existingAliasKey ?? optimisticReplacementKey ?? findEquivalentMessageKey(state, event.message);
  const messageKey = equivalentMessageKey ?? incomingMessageId;
  const shouldReplaceOptimistic = optimisticReplacementKey !== null;
  const shouldAliasIncomingMessage = messageKey !== incomingMessageId;
  const messagesById = { ...state.messagesById };
  const messageIdAliases = shouldAliasIncomingMessage
    ? { ...state.messageIdAliases, [incomingMessageId]: messageKey }
    : state.messageIdAliases;
  let messageOrder = state.messageOrder;

  messageOrder = appendUnique(messageOrder, messageKey);

  const previousMessage = messagesById[messageKey];
  const nextMessage = mergeMessage(previousMessage, event.message);
  const streamingMessageIds = event.message.role === "assistant"
    ? appendUnique(state.streamingMessageIds, messageKey)
    : state.streamingMessageIds;
  const nextActiveRun = shouldReplaceOptimistic && activeRun !== null
    ? { ...activeRun, optimisticUserMessageId: null }
    : activeRun;

  if (
    !shouldReplaceOptimistic &&
    nextMessage === previousMessage &&
    messageOrder === state.messageOrder &&
    messageIdAliases === state.messageIdAliases &&
    streamingMessageIds === state.streamingMessageIds &&
    nextActiveRun === state.activeRun
  ) {
    return state;
  }

  if (nextMessage !== previousMessage || shouldReplaceOptimistic) {
    messagesById[messageKey] = nextMessage;
  }

  return {
    ...state,
    messagesById: nextMessage === previousMessage && !shouldReplaceOptimistic ? state.messagesById : messagesById,
    messageOrder,
    messageIdAliases,
    timelineRows: updateTimelineRows(state.timelineRows, messageOrder, messagesById),
    activeRun: nextActiveRun,
    streamingMessageIds,
  };
};

const findEquivalentMessageKey = (
  state: AgentChatState,
  message: AgentMessage,
): string | null => {
  if (message.role !== "user" && message.role !== "assistant") {
    return null;
  }

  if (state.messagesById[message.id] !== undefined) {
    return null;
  }

  if (message.role === "assistant") {
    return findEquivalentAssistantMessageKey(state, message);
  }

  for (const messageId of state.messageOrder) {
    const candidate = state.messagesById[messageId];
    if (
      candidate?.role === "user" &&
      candidate.path === message.path &&
      getTextContent(candidate.content) === getTextContent(message.content) &&
      userContentsCanReconcile(candidate.content, message.content)
    ) {
      return messageId;
    }
  }

  return null;
};

const findEquivalentAssistantMessageKey = (
  state: AgentChatState,
  message: Extract<AgentMessage, { readonly role: "assistant" }>,
): string | null => {
  const incomingText = getAssistantMarkdown(message);

  if (incomingText.length === 0) {
    return null;
  }

  for (let index = state.messageOrder.length - 1; index >= 0; index -= 1) {
    const messageId = state.messageOrder[index];
    const candidate = messageId === undefined ? undefined : state.messagesById[messageId];
    if (candidate?.role !== "assistant") {
      continue;
    }

    const candidateText = getAssistantMarkdown(candidate);
    if (
      candidateText === incomingText ||
      candidateText.startsWith(incomingText) ||
      incomingText.startsWith(candidateText)
    ) {
      return messageId;
    }
  }

  return null;
};

const appendContentDelta = (
  state: AgentChatState,
  event: Extract<AgentRunEvent, { readonly type: "content.delta" }>,
): AgentChatState => {
  if (event.streamKind === "assistant_text") {
    const messageId = state.messageIdAliases[event.messageId] ?? event.messageId;
    const messageIdAliases = messageId !== event.messageId
      ? { ...state.messageIdAliases, [event.messageId]: messageId }
      : state.messageIdAliases;
    const existing = state.messagesById[messageId];
    const assistant = existing?.role === "assistant"
      ? existing
      : createStreamingAssistantMessage(messageId, event.createdAt);
    const existingText = existing?.role === "assistant" ? getAssistantMarkdown(existing) : "";
    const replayedText = state.replayedAssistantTextBySourceId[event.messageId] ?? "";
    const nextReplayedText = `${replayedText}${event.delta}`;
    const isReplayedDeltaAlreadyVisible = messageId !== event.messageId && existingText.startsWith(nextReplayedText);
    const nextMessage = isReplayedDeltaAlreadyVisible ? assistant : appendAssistantText(assistant, event.delta);
    const messagesById = { ...state.messagesById, [messageId]: nextMessage };
    const messageOrder = appendUnique(state.messageOrder, messageId);
    return {
      ...state,
      messagesById,
      messageOrder,
      messageIdAliases,
      replayedAssistantTextBySourceId: messageId !== event.messageId
        ? { ...state.replayedAssistantTextBySourceId, [event.messageId]: nextReplayedText }
        : state.replayedAssistantTextBySourceId,
      timelineRows: updateTimelineRows(
        state.timelineRows,
        messageOrder,
        messagesById,
      ),
      streamingMessageIds: appendUnique(state.streamingMessageIds, messageId),
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
  if (event.item.itemType === "context_compaction") {
    return {
      id: `activity:${event.item.id}`,
      runId: event.runId,
      turnId: event.turnId,
      itemId: event.item.id,
      kind: "info",
      tone: "info",
      status: event.item.status === "completed" ? "completed" : "running",
      title: event.item.title,
      summary: event.item.summary,
      detail: event.item.detail,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      sequence: event.sequence,
      payload: event.item.raw ?? event.item.result ?? event.item.args,
    };
  }

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
  if (previous?.role === "user" && next.role === "user") {
    const previousAttachments = previous.content.filter((block) => block.type === "image" || block.type === "file");
    const nextHasAttachments = next.content.some((block) => block.type === "image" || block.type === "file");

    if (
      previousAttachments.length > 0 &&
      !nextHasAttachments &&
      getTextContent(previous.content) === getTextContent(next.content)
    ) {
      return {
        ...next,
        path: previous.path,
        content: [...next.content, ...previousAttachments],
      };
    }
  }

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

export const deriveAgentTimelineRows = (
  messageOrder: readonly string[],
  messagesById: Readonly<Record<string, AgentMessage>>,
): AgentTimelineRow[] => {
  const rows: AgentTimelineRow[] = [];
  let pendingAssistantMessageId: string | null = null;

  const pushMessageRow = (messageId: string): void => {
    const message = messagesById[messageId];

    if (message?.role !== "user" && message?.role !== "assistant") {
      return;
    }

    rows.push({
      kind: "message",
      id: `message:${messageId}`,
      messageId,
      role: message.role,
      createdAt: message.timestamp,
    });
  };

  for (const messageId of messageOrder) {
    const message = messagesById[messageId];

    if (message?.role !== "user" && message?.role !== "assistant") {
      continue;
    }

    if (message.role === "assistant") {
      pendingAssistantMessageId = messageId;
      continue;
    }

    if (pendingAssistantMessageId !== null) {
      pushMessageRow(pendingAssistantMessageId);
      pendingAssistantMessageId = null;
    }

    pushMessageRow(messageId);
    rows.push({
      kind: "status",
      id: `status:${messageId}`,
      messageId,
      createdAt: message.timestamp,
    });
  }

  if (pendingAssistantMessageId !== null) {
    pushMessageRow(pendingAssistantMessageId);
  }

  return rows;
};

const updateTimelineRows = (
  currentRows: readonly AgentTimelineRow[],
  messageOrder: readonly string[],
  messagesById: Readonly<Record<string, AgentMessage>>,
): readonly AgentTimelineRow[] => {
  const nextRows = deriveAgentTimelineRows(messageOrder, messagesById);

  if (
    nextRows.length === currentRows.length &&
    nextRows.every((row, index) => timelineRowsEqual(row, currentRows[index]))
  ) {
    return currentRows;
  }

  return nextRows;
};

const timelineRowsEqual = (
  left: AgentTimelineRow,
  right: AgentTimelineRow | undefined,
): boolean => {
  if (right === undefined || left.kind !== right.kind || left.id !== right.id) {
    return false;
  }

  if (left.kind === "message" && right.kind === "message") {
    return left.messageId === right.messageId && left.role === right.role && left.createdAt === right.createdAt;
  }

  return left.messageId === right.messageId && left.createdAt === right.createdAt;
};

export const agentThreadToSummary = (thread: AgentThread): AgentThreadSummary => ({
  id: thread.id,
  title: thread.title,
  startPath: thread.startPath,
  lastPath: thread.lastPath,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
  messageCount: thread.messageCount,
});

const contentAttachmentSignature = (content: AgentContent): string =>
  content
    .filter((block) => block.type === "image" || block.type === "file")
    .map((block) => block.type === "file"
      ? `file:${block.filename}:${block.mimeType}:${block.data?.length ?? 0}`
      : `image:${block.mimeType}:${block.data.length}`)
    .join("|");

const userContentsCanReconcile = (left: AgentContent, right: AgentContent): boolean => {
  const leftSignature = contentAttachmentSignature(left);
  const rightSignature = contentAttachmentSignature(right);

  return leftSignature.length === 0 || rightSignature.length === 0 || leftSignature === rightSignature;
};
