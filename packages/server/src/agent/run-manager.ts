import { randomUUID } from "node:crypto";

import { AgentError, toAgentError } from "./errors.js";
import type {
  AgentContent,
  EditThreadUserMessageInput,
  AgentHarnessName,
  AgentMessage,
  AgentRunEvent,
  AgentThread,
  AgentUiContext,
  IAgentHarness,
  SteerRunResult,
} from "./types.js";

const RECENT_RUN_TTL_MS = 10 * 60 * 1000;

export interface AgentRunManagerOptions {
  readonly harness: IAgentHarness;
  readonly onActivity?: () => void;
}

export interface StartAgentRunInput {
  readonly threadId?: string;
  readonly path: string;
  readonly content: AgentContent;
  readonly uiContext?: AgentUiContext;
  readonly harness?: AgentHarnessName;
  readonly provider?: string;
  readonly model?: string;
  readonly clientRunId?: string;
  readonly edit?: {
    readonly numTurns: number;
  };
}

export interface AgentActiveRun {
  readonly runId: string;
  readonly threadId: string;
  readonly status: "running";
  readonly eventsUrl: string;
  readonly replayAfterEventId: number;
}

export type AgentSseEnvelope =
  | {
      readonly id: number;
      readonly type: "run_start";
      readonly data: { readonly runId: string; readonly threadId: string };
    }
  | {
      readonly id: number;
      readonly type: "event";
      readonly data: { readonly runId: string; readonly threadId: string; readonly event: AgentRunEvent };
    }
  | {
      readonly id: number;
      readonly type: "run_end";
      readonly data: { readonly runId: string; readonly threadId: string };
    }
  | {
      readonly id: number;
      readonly type: "error";
      readonly data: { readonly code: string; readonly message: string };
    };

export interface AgentRunSubscription {
  readonly unsubscribe: () => void;
}

export type AgentRunStatus = "starting" | "running" | "completed" | "failed";

type AgentRunSubscriber = (envelope: AgentSseEnvelope) => void;

export interface AgentRunRecord {
  readonly internalId: string;
  readonly input: StartAgentRunInput;
  runId: string | null;
  threadId: string | null;
  status: AgentRunStatus;
  completedAt: number | null;
  nextEnvelopeId: number;
  readonly envelopes: AgentSseEnvelope[];
  readonly subscribers: Set<AgentRunSubscriber>;
}

export class AgentRunManager {
  private readonly runsByInternalId = new Map<string, AgentRunRecord>();
  private readonly runsByRunId = new Map<string, AgentRunRecord>();
  private readonly runsByClientRunId = new Map<string, AgentRunRecord>();

  constructor(private readonly options: AgentRunManagerOptions) {}

  startRun(input: StartAgentRunInput): AgentRunRecord {
    this.options.onActivity?.();
    this.pruneCompletedRuns();

    if (input.edit !== undefined) {
      if (input.threadId === undefined) {
        throw new Error("Edit run requires a thread id");
      }

      if (this.isThreadRunning(input.threadId)) {
        throw new Error("Cannot edit a thread while it is running");
      }
    }

    if (input.clientRunId !== undefined) {
      const existing = this.runsByClientRunId.get(input.clientRunId);
      if (existing !== undefined) {
        return existing;
      }
    }

    const record: AgentRunRecord = {
      internalId: randomUUID(),
      input,
      runId: null,
      threadId: input.threadId ?? null,
      status: "starting",
      completedAt: null,
      nextEnvelopeId: 1,
      envelopes: [],
      subscribers: new Set(),
    };

    this.runsByInternalId.set(record.internalId, record);

    if (input.clientRunId !== undefined) {
      this.runsByClientRunId.set(input.clientRunId, record);
    }

    void this.consumeRun(record);
    return record;
  }

  getRun(runId: string): AgentRunRecord | undefined {
    this.pruneCompletedRuns();
    return this.runsByRunId.get(runId);
  }

  getActiveRunForThread(thread: AgentThread): AgentActiveRun | undefined {
    this.pruneCompletedRuns();

    for (const record of this.runsByInternalId.values()) {
      if (
        record.status !== "completed" &&
        record.status !== "failed" &&
        record.runId !== null &&
        record.threadId === thread.id
      ) {
        return {
          runId: record.runId,
          threadId: thread.id,
          status: "running",
          eventsUrl: `/agent/runs/${encodeURIComponent(record.runId)}/events`,
          replayAfterEventId: getReplayAfterEventId(record, thread),
        };
      }
    }

    return undefined;
  }

  isThreadRunning(threadId: string): boolean {
    this.pruneCompletedRuns();

    for (const record of this.runsByInternalId.values()) {
      if (
        record.status !== "completed" &&
        record.status !== "failed" &&
        record.threadId === threadId
      ) {
        return true;
      }
    }

    return false;
  }

  getActiveRunCount(): number {
    this.pruneCompletedRuns();
    let count = 0;

    for (const record of this.runsByInternalId.values()) {
      if (record.status !== "completed" && record.status !== "failed") {
        count += 1;
      }
    }

    return count;
  }

  subscribe(
    record: AgentRunRecord,
    afterEnvelopeId: number,
    subscriber: AgentRunSubscriber,
  ): AgentRunSubscription {
    for (const envelope of record.envelopes) {
      if (envelope.id > afterEnvelopeId) {
        subscriber(envelope);
      }
    }

    if (record.status !== "completed" && record.status !== "failed") {
      record.subscribers.add(subscriber);
    }

    return {
      unsubscribe: () => {
        record.subscribers.delete(subscriber);
      },
    };
  }

  async cancelRun(threadId: string, runId: string): Promise<void> {
    await this.options.harness.cancelRun?.({ threadId, runId });
  }

  async steerRun(input: {
    readonly threadId: string;
    readonly runId: string;
    readonly path: string;
    readonly content: AgentContent;
    readonly uiContext?: AgentUiContext;
  }): Promise<SteerRunResult> {
    const { threadId, runId } = input;
    const record = this.getRun(runId);

    if (record === undefined) {
      throw new AgentError("RUN_NOT_FOUND", "Run not found");
    }

    if (record.threadId !== threadId) {
      throw new AgentError("RUN_THREAD_MISMATCH", "Run does not belong to the requested thread");
    }

    if (record.status !== "running") {
      throw new AgentError("RUN_NOT_ACTIVE", "Cannot steer a run that is not active");
    }

    if (this.options.harness.steerRun === undefined) {
      throw new AgentError("STEER_NOT_SUPPORTED", "Steering active turns is not supported by this agent harness");
    }

    return this.options.harness.steerRun(input);
  }

  private async consumeRun(record: AgentRunRecord): Promise<void> {
    try {
      const iterable = record.input.edit === undefined
        ? this.options.harness.sendMessage({
          threadId: record.input.threadId,
          path: record.input.path,
          content: record.input.content,
          uiContext: record.input.uiContext,
          harness: record.input.harness,
          provider: record.input.provider,
          model: record.input.model,
        })
        : this.editThreadUserMessage({
          threadId: requireThreadId(record.input.threadId),
          path: record.input.path,
          content: record.input.content,
          numTurns: record.input.edit.numTurns,
          uiContext: record.input.uiContext,
        });
      const iterator = iterable[Symbol.asyncIterator]();

      const firstResult = await iterator.next();

      if (firstResult.done === true) {
        throw new Error("Agent run produced no events");
      }

      const firstEvent = firstResult.value;
      this.markRunStarted(record, firstEvent);
      this.appendEnvelope(record, {
        type: "run_start",
        data: { runId: firstEvent.runId, threadId: firstEvent.threadId },
      });
      this.appendRunEvent(record, firstEvent);

      for (;;) {
        const result = await iterator.next();

        if (result.done === true) {
          break;
        }

        this.appendRunEvent(record, result.value);
      }

      if (record.runId !== null && record.threadId !== null) {
        this.appendEnvelope(record, {
          type: "run_end",
          data: { runId: record.runId, threadId: record.threadId },
        });
      }

      record.status = "completed";
      record.completedAt = Date.now();
      this.options.onActivity?.();
      record.subscribers.clear();
    } catch (error) {
      const agentError = toAgentError(error);
      record.status = "failed";
      record.completedAt = Date.now();
      this.options.onActivity?.();
      this.appendEnvelope(record, {
        type: "error",
        data: { code: agentError.code, message: agentError.message },
      });
      record.subscribers.clear();
    }
  }

  private editThreadUserMessage(input: EditThreadUserMessageInput): AsyncIterable<AgentRunEvent> {
    if (this.options.harness.editThreadUserMessage === undefined) {
      throw new Error("Editing thread messages is not supported by this agent harness");
    }

    return this.options.harness.editThreadUserMessage(input);
  }

  private markRunStarted(record: AgentRunRecord, firstEvent: AgentRunEvent): void {
    record.runId = firstEvent.runId;
    record.threadId = firstEvent.threadId;
    record.status = "running";
    this.runsByRunId.set(firstEvent.runId, record);
  }

  private appendRunEvent(record: AgentRunRecord, event: AgentRunEvent): void {
    record.runId = event.runId;
    record.threadId = event.threadId;
    this.runsByRunId.set(event.runId, record);
    this.appendEnvelope(record, {
      type: "event",
      data: { runId: event.runId, threadId: event.threadId, event },
    });
  }

  private appendEnvelope(
    record: AgentRunRecord,
    envelope: Omit<AgentSseEnvelope, "id">,
  ): void {
    const nextEnvelope = { ...envelope, id: record.nextEnvelopeId++ } as AgentSseEnvelope;
    record.envelopes.push(nextEnvelope);

    for (const subscriber of record.subscribers) {
      subscriber(nextEnvelope);
    }
  }

  private pruneCompletedRuns(): void {
    const cutoff = Date.now() - RECENT_RUN_TTL_MS;

    for (const record of this.runsByInternalId.values()) {
      if (record.completedAt === null || record.completedAt >= cutoff) {
        continue;
      }

      this.runsByInternalId.delete(record.internalId);

      if (record.runId !== null) {
        this.runsByRunId.delete(record.runId);
      }

      if (record.input.clientRunId !== undefined) {
        this.runsByClientRunId.delete(record.input.clientRunId);
      }
    }
  }
}

const requireThreadId = (threadId: string | undefined): string => {
  if (threadId === undefined) {
    throw new Error("Edit run requires a thread id");
  }

  return threadId;
};

interface ThreadSnapshotIndex {
  readonly threadId: string;
  readonly messagesById: ReadonlyMap<string, AgentMessage>;
  readonly messageTextById: ReadonlyMap<string, string>;
  readonly activityIds: ReadonlySet<string>;
  readonly activityTextById: ReadonlyMap<string, string>;
  readonly planTextById: ReadonlyMap<string, string>;
}

const getReplayAfterEventId = (record: AgentRunRecord, thread: AgentThread): number => {
  const snapshot = indexThreadSnapshot(thread);
  const accumulatedDeltas = new Map<string, string>();
  let replayAfterEventId = 0;

  for (const envelope of record.envelopes) {
    if (isEnvelopeRepresentedBySnapshot(envelope, snapshot, accumulatedDeltas)) {
      replayAfterEventId = envelope.id;
      continue;
    }

    break;
  }

  return replayAfterEventId;
};

const indexThreadSnapshot = (thread: AgentThread): ThreadSnapshotIndex => {
  const messagesById = new Map<string, AgentMessage>();
  const messageTextById = new Map<string, string>();
  const activityTextById = new Map<string, string>();
  const planTextById = new Map<string, string>();

  for (const message of thread.messages) {
    messagesById.set(message.id, message);
    messageTextById.set(message.id, getMessageText(message));
  }

  for (const activity of thread.activities) {
    activityTextById.set(activity.id, `${activity.summary ?? ""}\n${activity.detail ?? ""}`);
  }

  for (const plan of thread.proposedPlans ?? []) {
    planTextById.set(plan.id, plan.content);
  }

  return {
    threadId: thread.id,
    messagesById,
    messageTextById,
    activityIds: new Set(thread.activities.map((activity) => activity.id)),
    activityTextById,
    planTextById,
  };
};

const isEnvelopeRepresentedBySnapshot = (
  envelope: AgentSseEnvelope,
  snapshot: ThreadSnapshotIndex,
  accumulatedDeltas: Map<string, string>,
): boolean => {
  if (envelope.type === "run_start") {
    return envelope.data.threadId === snapshot.threadId;
  }

  if (envelope.type !== "event") {
    return false;
  }

  return isEventRepresentedBySnapshot(envelope.data.event, snapshot, accumulatedDeltas);
};

const isEventRepresentedBySnapshot = (
  event: AgentRunEvent,
  snapshot: ThreadSnapshotIndex,
  accumulatedDeltas: Map<string, string>,
): boolean => {
  switch (event.type) {
    case "thread.created":
    case "thread.updated":
      return event.thread.id === snapshot.threadId;

    case "turn.started":
      return true;

    case "message.started":
      return snapshot.messagesById.has(event.messageId);

    case "message.completed":
      return isMessageSnapshotAtLeast(snapshot, event.message);

    case "content.delta":
      return isContentDeltaRepresented(event, snapshot, accumulatedDeltas);

    case "item.started":
    case "item.updated":
    case "item.completed":
      return snapshot.activityIds.has(`activity:${event.item.id}`);

    case "request.opened":
    case "request.resolved":
      return snapshot.activityIds.has(`request:${event.request.id}`);

    case "runtime.warning":
      return snapshot.activityIds.has(`runtime-warning:${event.sequence}`);

    case "runtime.error":
      return snapshot.activityIds.has(`runtime-error:${event.sequence}`);

    case "turn.completed":
      return false;
  }
};

const isMessageSnapshotAtLeast = (snapshot: ThreadSnapshotIndex, message: AgentMessage): boolean => {
  if (!snapshot.messagesById.has(message.id)) {
    return false;
  }

  const eventText = getMessageText(message);

  if (eventText.length === 0) {
    return true;
  }

  return (snapshot.messageTextById.get(message.id) ?? "").startsWith(eventText);
};

const isContentDeltaRepresented = (
  event: Extract<AgentRunEvent, { readonly type: "content.delta" }>,
  snapshot: ThreadSnapshotIndex,
  accumulatedDeltas: Map<string, string>,
): boolean => {
  const key = `${event.messageId}:${event.contentIndex}:${event.streamKind}`;
  const nextText = `${accumulatedDeltas.get(key) ?? ""}${event.delta}`;
  const represented = getStreamSnapshotText(event, snapshot).startsWith(nextText);

  if (represented) {
    accumulatedDeltas.set(key, nextText);
  }

  return represented;
};

const getStreamSnapshotText = (
  event: Extract<AgentRunEvent, { readonly type: "content.delta" }>,
  snapshot: ThreadSnapshotIndex,
): string => {
  if (event.streamKind === "assistant_text") {
    return snapshot.messageTextById.get(event.messageId) ?? "";
  }

  if (event.streamKind === "plan_text") {
    return snapshot.planTextById.get(`plan:${event.messageId}`) ?? "";
  }

  return snapshot.activityTextById.get(`activity:${event.messageId}`) ?? "";
};

const getMessageText = (message: AgentMessage): string => {
  if (message.role === "assistant") {
    return message.content
      .flatMap((block) => {
        if (block.type === "response") {
          return block.response;
        }

        if (block.type === "thinking") {
          return [{ type: "text" as const, content: block.thinkingText }];
        }

        return [];
      })
      .filter((content) => content.type === "text")
      .map((content) => content.content)
      .join("");
  }

  if (message.role === "custom") {
    return "";
  }

  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.content)
    .join("");
};
