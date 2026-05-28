import { describe, expect, it } from "vitest";

import { AgentError } from "../src/agent/errors.js";
import { HeysnapAgentHarness } from "../src/agent/harnesses/heysnap/heysnap-agent-harness.js";
import type {
  AgentContent,
  AgentHarnessName,
  AgentRunEvent,
  AgentThread,
  AgentThreadSummary,
  CancelRunInput,
  EditThreadUserMessageInput,
  IAgentHarness,
  RetrieveThreadsInput,
  RetrieveThreadsResult,
  SendMessageInput,
  SetupInput,
  SteerRunInput,
  SteerRunResult,
} from "../src/agent/types.js";

describe("HeysnapAgentHarness", () => {
  it("combines Codex and Pi thread lists with routed ids and a global limit", async () => {
    const codex = new RecordingHarness("codex", [
      threadSummary({ id: "codex-old", updatedAt: 10 }),
      threadSummary({ id: "codex-new", updatedAt: 30 }),
    ]);
    const pi = new RecordingHarness("pi", [
      threadSummary({ id: "pi-thread", updatedAt: 20 }),
    ]);
    const harness = new HeysnapAgentHarness({ codex, pi });

    const result = await harness.retrieveThreads({ rootPath: "Projects", limit: 2 });

    expect(codex.retrieveInputs[0]).toEqual({ rootPath: "Projects", limit: 4 });
    expect(pi.retrieveInputs[0]).toEqual({ rootPath: "Projects", limit: 4 });
    expect(result.groups).toEqual([{
      path: "Projects/app",
      threads: [
        expect.objectContaining({ id: "codex-new" }),
        expect.objectContaining({ id: "pi:pi-thread" }),
      ],
    }]);
  });

  it("orders combined groups by the newest thread in each group", async () => {
    const codex = new RecordingHarness("codex", [
      threadSummary({ id: "alpha-old", startPath: "Projects/alpha", updatedAt: 10 }),
      threadSummary({ id: "alpha-new", startPath: "Projects/alpha", updatedAt: 30 }),
    ]);
    const pi = new RecordingHarness("pi", [
      threadSummary({ id: "zed-newest", startPath: "Projects/zed", updatedAt: 40 }),
      threadSummary({ id: "middle", startPath: "Projects/middle", updatedAt: 20 }),
    ]);
    const harness = new HeysnapAgentHarness({ codex, pi });

    const result = await harness.retrieveThreads({ rootPath: "Projects", limit: 10 });

    expect(result.groups.map((group) => group.path)).toEqual([
      "Projects/zed",
      "Projects/alpha",
      "Projects/middle",
    ]);
    expect(result.groups[1]?.threads.map((thread) => thread.id)).toEqual([
      "alpha-new",
      "alpha-old",
    ]);
  });

  it("routes getThread by prefix and treats unprefixed ids as Codex", async () => {
    const codex = new RecordingHarness("codex", [threadSummary({ id: "codex-thread" })]);
    const pi = new RecordingHarness("pi", [threadSummary({ id: "pi/thread" })]);
    const harness = new HeysnapAgentHarness({ codex, pi });

    const piThread = await harness.getThread({ threadId: "pi:pi%2Fthread" });
    const codexThread = await harness.getThread({ threadId: "codex-thread" });

    expect(pi.getInputs).toEqual([{ threadId: "pi/thread" }]);
    expect(codex.getInputs).toEqual([{ threadId: "codex-thread" }]);
    expect(piThread.id).toBe("pi:pi%2Fthread");
    expect(codexThread.id).toBe("codex-thread");
  });

  it("defaults new sends to Codex and ignores provider/model for Codex", async () => {
    const codex = new RecordingHarness("codex", []);
    const pi = new RecordingHarness("pi", []);
    const harness = new HeysnapAgentHarness({ codex, pi });

    const events = await collectEvents(harness.sendMessage({
      path: "Projects/app",
      content: textContent("hello"),
      provider: "anthropic",
      model: "claude-opus-4-7",
    }));

    expect(pi.sendInputs).toHaveLength(0);
    expect(codex.sendInputs).toMatchObject([{
      threadId: undefined,
      path: "Projects/app",
      provider: undefined,
      model: undefined,
    }]);
    expect(events.map((event) => event.threadId)).toEqual(["codex-new", "codex-new"]);
    expect(events[0]).toMatchObject({
      type: "thread.created",
      thread: { id: "codex-new" },
      provider: "codex",
      providerRefs: { providerThreadId: "codex-new" },
    });
  });

  it("routes new Pi sends and forwards provider/model selections", async () => {
    const codex = new RecordingHarness("codex", []);
    const pi = new RecordingHarness("pi", []);
    const harness = new HeysnapAgentHarness({ codex, pi });

    const events = await collectEvents(harness.sendMessage({
      harness: "pi",
      path: "Projects/app",
      content: textContent("hello"),
      provider: "anthropic",
      model: "claude-opus-4-7",
    }));

    expect(codex.sendInputs).toHaveLength(0);
    expect(pi.sendInputs).toMatchObject([{
      threadId: undefined,
      path: "Projects/app",
      provider: "anthropic",
      model: "claude-opus-4-7",
    }]);
    expect(events[0]).toMatchObject({
      threadId: "pi:pi-new",
      thread: { id: "pi:pi-new" },
      provider: "pi",
      providerRefs: { providerThreadId: "pi-new" },
    });
  });

  it("routes existing-thread sends by thread id and rejects mismatched harness selectors", async () => {
    const codex = new RecordingHarness("codex", []);
    const pi = new RecordingHarness("pi", []);
    const harness = new HeysnapAgentHarness({ codex, pi });

    await collectEvents(harness.sendMessage({
      threadId: "pi:pi-thread",
      path: "Projects/app",
      content: textContent("continue"),
    }));

    await expect(collectEvents(harness.sendMessage({
      threadId: "pi:pi-thread",
      harness: "codex",
      path: "Projects/app",
      content: textContent("wrong"),
    }))).rejects.toMatchObject({
      code: "AGENT_HARNESS_THREAD_MISMATCH",
    });

    expect(pi.sendInputs[0]).toMatchObject({ threadId: "pi-thread" });
    expect(codex.sendInputs).toHaveLength(0);
  });

  it("normalizes URL-encoded routed Pi thread ids before calling Pi", async () => {
    const codex = new RecordingHarness("codex", []);
    const pi = new RecordingHarness("pi", [threadSummary({ id: "019e6595-7d0e-7324-8b4d-2eb74fe8c03b" })]);
    const harness = new HeysnapAgentHarness({ codex, pi });

    const thread = await harness.getThread({ threadId: "pi%3A019e6595-7d0e-7324-8b4d-2eb74fe8c03b" });
    await collectEvents(harness.sendMessage({
      threadId: "pi%3A019e6595-7d0e-7324-8b4d-2eb74fe8c03b",
      path: "Projects/app",
      content: textContent("continue"),
    }));

    expect(thread.id).toBe("pi:019e6595-7d0e-7324-8b4d-2eb74fe8c03b");
    expect(pi.getInputs).toEqual([{ threadId: "019e6595-7d0e-7324-8b4d-2eb74fe8c03b" }]);
    expect(pi.sendInputs[0]).toMatchObject({ threadId: "019e6595-7d0e-7324-8b4d-2eb74fe8c03b" });
  });

  it("routes edit, cancel, and steer operations by prefixed thread id", async () => {
    const codex = new RecordingHarness("codex", []);
    const pi = new RecordingHarness("pi", []);
    const harness = new HeysnapAgentHarness({ codex, pi });

    const editEvents = await collectEvents(harness.editThreadUserMessage?.({
      threadId: "pi:pi-thread",
      path: "Projects/app",
      content: textContent("edited"),
      numTurns: 1,
    }) ?? emptyEvents());
    await harness.cancelRun({ threadId: "pi:pi-thread", runId: "run-1" });
    const steerResult = await harness.steerRun?.({
      threadId: "pi:pi-thread",
      runId: "run-1",
      path: "Projects/app",
      content: textContent("steer"),
    });

    expect(pi.editInputs).toMatchObject([{ threadId: "pi-thread", numTurns: 1 }]);
    expect(pi.cancelInputs).toEqual([{ threadId: "pi-thread", runId: "run-1" }]);
    expect(pi.steerInputs).toMatchObject([{ threadId: "pi-thread", runId: "run-1" }]);
    expect(editEvents[0]?.threadId).toBe("pi:pi-thread");
    expect(steerResult).toEqual({ turnId: "run-1:steered" });
  });
});

class RecordingHarness implements IAgentHarness {
  readonly retrieveInputs: RetrieveThreadsInput[] = [];
  readonly getInputs: Array<{ readonly threadId: string }> = [];
  readonly sendInputs: SendMessageInput[] = [];
  readonly editInputs: EditThreadUserMessageInput[] = [];
  readonly cancelInputs: CancelRunInput[] = [];
  readonly steerInputs: SteerRunInput[] = [];
  private readonly threads = new Map<string, AgentThread>();

  constructor(
    private readonly name: AgentHarnessName,
    summaries: readonly AgentThreadSummary[],
  ) {
    for (const summary of summaries) {
      this.threads.set(summary.id, { ...summary, messages: [], activities: [], proposedPlans: [] });
    }
  }

  setup(_input: SetupInput): Promise<void> {
    return Promise.resolve();
  }

  retrieveThreads(input: RetrieveThreadsInput): Promise<RetrieveThreadsResult> {
    this.retrieveInputs.push(input);
    const summaries = Array.from(this.threads.values())
      .filter((thread) => input.rootPath === undefined || thread.startPath.startsWith(input.rootPath))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, input.limit)
      .map(toThreadSummary);

    return Promise.resolve({ groups: [{ path: "Projects/app", threads: summaries }] });
  }

  getThread(input: { readonly threadId: string }): Promise<AgentThread> {
    this.getInputs.push(input);
    const thread = this.threads.get(input.threadId);

    if (thread === undefined) {
      throw new AgentError("THREAD_NOT_FOUND", "Thread not found");
    }

    return Promise.resolve({ ...thread, messages: [], activities: [], proposedPlans: [] });
  }

  async *sendMessage(input: SendMessageInput): AsyncIterable<AgentRunEvent> {
    this.sendInputs.push(input);
    const threadId = input.threadId ?? `${this.name}-new`;
    yield* createEvents(this.name, threadId, input.content, input.path);
  }

  async *editThreadUserMessage(input: EditThreadUserMessageInput): AsyncIterable<AgentRunEvent> {
    this.editInputs.push(input);
    yield* createEvents(this.name, input.threadId, input.content, input.path);
  }

  cancelRun(input: CancelRunInput): Promise<void> {
    this.cancelInputs.push(input);
    return Promise.resolve();
  }

  steerRun(input: SteerRunInput): Promise<SteerRunResult> {
    this.steerInputs.push(input);
    return Promise.resolve({ turnId: `${input.runId}:steered` });
  }
}

async function* createEvents(
  provider: AgentHarnessName,
  threadId: string,
  content: AgentContent,
  path: string,
): AsyncIterable<AgentRunEvent> {
  const now = Date.now();
  const summary = threadSummary({ id: threadId, updatedAt: now });
  const base = {
    version: 2 as const,
    runId: `${provider}-run`,
    threadId,
    turnId: `${provider}-turn`,
    createdAt: now,
    provider,
    providerRefs: {
      providerThreadId: threadId,
      providerTurnId: `${provider}-turn`,
    },
  };

  yield {
    ...base,
    type: "thread.created",
    sequence: 1,
    thread: summary,
  };
  yield {
    ...base,
    type: "turn.started",
    sequence: 2,
    input: content,
    path,
  };
}

const threadSummary = (input: {
  readonly id: string;
  readonly startPath?: string;
  readonly updatedAt?: number;
}): AgentThreadSummary => ({
  id: input.id,
  title: input.id,
  startPath: input.startPath ?? "Projects/app",
  lastPath: input.startPath ?? "Projects/app",
  createdAt: input.updatedAt ?? 1,
  updatedAt: input.updatedAt ?? 1,
  messageCount: 1,
});

const toThreadSummary = (thread: AgentThread): AgentThreadSummary => ({
  id: thread.id,
  title: thread.title,
  startPath: thread.startPath,
  lastPath: thread.lastPath,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
  messageCount: thread.messageCount,
  isStreaming: thread.isStreaming,
});

const textContent = (content: string): AgentContent => [{ type: "text", content }];

const collectEvents = async (events: AsyncIterable<AgentRunEvent>): Promise<AgentRunEvent[]> => {
  const collected: AgentRunEvent[] = [];

  for await (const event of events) {
    collected.push(event);
  }

  return collected;
};

async function* emptyEvents(): AsyncIterable<AgentRunEvent> {}
