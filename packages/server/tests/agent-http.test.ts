import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createAgentHttpService } from "../src/agent/http.js";
import { MockAgentHarness } from "../src/agent/mock-harness.js";
import type {
  AgentContent,
  AgentThread,
  AgentThreadSummary,
  AgentRunEvent,
  AssistantMessage,
  IAgentHarness,
  RetrieveThreadsInput,
  RetrieveThreadsResult,
  SendMessageInput,
  SetupInput,
  SteerRunInput,
  SteerRunResult,
  UserMessage,
} from "../src/agent/types.js";

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => closeServer(server)));
});

describe("agent HTTP API", () => {
  it("retrieves grouped thread history and full threads", async () => {
    const harness = new MockAgentHarness();
    await collectEvents(harness.sendMessage({ path: "Projects/app", content: textContent("Build the UI") }));
    const { url } = await startAgentHttpServer(harness);

    const threadsResponse = await fetch(`${url}/agent/threads?rootPath=Projects&limit=10`);

    expect(threadsResponse.status).toBe(200);
    const threadsBody = await threadsResponse.json() as RetrieveThreadsResult;
    const threadId = threadsBody.groups[0]?.threads[0]?.id ?? "";
    expect(threadsBody.groups[0]).toMatchObject({ path: "Projects/app" });

    const threadResponse = await fetch(`${url}/agent/threads/${encodeURIComponent(threadId)}`);

    expect(threadResponse.status).toBe(200);
    expect(await threadResponse.json()).toMatchObject({
      thread: {
        id: threadId,
        messageCount: 2,
      },
    });
  });

  it("streams runs as SSE", async () => {
    const { url } = await startAgentHttpServer(new MockAgentHarness());
    const response = await fetch(`${url}/agent/runs`, {
      method: "POST",
      body: JSON.stringify({
        path: "Projects/app",
        content: textContent("Build the UI"),
        uiContext: {
          openFiles: [
            { path: "Projects/app/src/App.tsx", isFocused: true },
          ],
        },
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    const messages = await readSseMessages(response);

    expect(messages.map((message) => message.event)).toEqual([
      "run_start",
      "event",
      "event",
      "event",
      "event",
      "event",
      "event",
      "event",
      "event",
      "event",
      "event",
      "event",
      "run_end",
    ]);
    expect(messages.some((message) =>
      message.event === "event" &&
      (message.data as { readonly event: AgentRunEvent }).event.type === "content.delta"
    )).toBe(true);
  });

  it("keeps a run alive after SSE disconnect and replays missed events", async () => {
    const { url } = await startAgentHttpServer(new SlowAgentHarness());
    const abortController = new AbortController();
    const response = await fetch(`${url}/agent/runs`, {
      method: "POST",
      body: JSON.stringify({
        path: "Projects/app",
        content: textContent("Build the UI"),
        clientRunId: "client-run-1",
      }),
      headers: { "content-type": "application/json" },
      signal: abortController.signal,
    });
    const firstMessages = await readSseMessages(response, 3);
    const runStart = firstMessages.find((message) => message.event === "run_start");
    const runId = (runStart?.data as { readonly runId?: string } | undefined)?.runId ?? "";
    const lastEventId = firstMessages[firstMessages.length - 1]?.id ?? 0;
    abortController.abort();
    await sleep(250);

    const resumed = await fetch(`${url}/agent/runs/${encodeURIComponent(runId)}/events`, {
      headers: { "last-event-id": String(lastEventId) },
    });
    const replayed = await readSseMessages(resumed);

    expect(replayed[0]?.id).toBeGreaterThan(lastEventId);
    expect(replayed.map((message) => message.event)).toContain("run_end");
  });

  it("marks streaming threads in grouped thread history", async () => {
    const { url } = await startAgentHttpServer(new SlowAgentHarness());
    const response = await fetch(`${url}/agent/runs`, {
      method: "POST",
      body: JSON.stringify({ path: "Projects/app", content: textContent("Build the UI") }),
      headers: { "content-type": "application/json" },
    });
    const firstMessages = await readSseMessages(response, 1);
    const threadId = readThreadId(firstMessages);

    const threadsResponse = await fetch(`${url}/agent/threads?rootPath=Projects&limit=10`);
    const threadsBody = await threadsResponse.json() as RetrieveThreadsResult;
    const thread = threadsBody.groups.flatMap((group) => group.threads).find((candidate) => candidate.id === threadId);

    expect(thread?.isStreaming).toBe(true);
  });

  it("preserves streaming state already reported by the harness", async () => {
    const { url } = await startAgentHttpServer(new StaticThreadsHarness([
      {
        id: "codex-active-thread",
        title: "Active Codex thread",
        startPath: "Projects/app",
        lastPath: "Projects/app",
        createdAt: 1,
        updatedAt: 2,
        messageCount: 0,
        isStreaming: true,
      },
    ]));

    const threadsResponse = await fetch(`${url}/agent/threads?rootPath=Projects&limit=10`);
    const threadsBody = await threadsResponse.json() as RetrieveThreadsResult;
    const thread = threadsBody.groups.flatMap((group) => group.threads).find((candidate) =>
      candidate.id === "codex-active-thread"
    );

    expect(thread?.isStreaming).toBe(true);
  });

  it("streams edited thread runs over SSE", async () => {
    const { url } = await startAgentHttpServer(new MockAgentHarness());
    const createResponse = await fetch(`${url}/agent/runs`, {
      method: "POST",
      body: JSON.stringify({ path: "Projects/app", content: textContent("Original prompt") }),
      headers: { "content-type": "application/json" },
    });
    const createMessages = await readSseMessages(createResponse);
    const threadId = readThreadId(createMessages);

    const editResponse = await fetch(`${url}/agent/threads/${encodeURIComponent(threadId)}/edit`, {
      method: "POST",
      body: JSON.stringify({
        path: "Projects/app",
        content: textContent("Edited prompt"),
        numTurns: 1,
      }),
      headers: { "content-type": "application/json" },
    });

    expect(editResponse.status).toBe(200);
    const editMessages = await readSseMessages(editResponse);
    const turnStarted = editMessages.find((message) =>
      message.event === "event" &&
      (message.data as { readonly event: AgentRunEvent }).event.type === "turn.started"
    );

    expect(editMessages.map((message) => message.event)).toContain("run_start");
    expect((turnStarted?.data as {
      readonly event?: Extract<AgentRunEvent, { readonly type: "turn.started" }>;
    } | undefined)?.event?.input).toEqual(textContent("Edited prompt"));
  });

  it("rejects edited thread runs while the thread is streaming", async () => {
    const { url } = await startAgentHttpServer(new SlowAgentHarness());
    const response = await fetch(`${url}/agent/runs`, {
      method: "POST",
      body: JSON.stringify({ path: "Projects/app", content: textContent("Build the UI") }),
      headers: { "content-type": "application/json" },
    });
    const firstMessages = await readSseMessages(response, 1);
    const threadId = readThreadId(firstMessages);

    const editResponse = await fetch(`${url}/agent/threads/${encodeURIComponent(threadId)}/edit`, {
      method: "POST",
      body: JSON.stringify({
        path: "Projects/app",
        content: textContent("Edited prompt"),
      }),
      headers: { "content-type": "application/json" },
    });

    expect(editResponse.status).toBe(409);
    expect(await editResponse.json()).toMatchObject({
      code: "THREAD_ACTIVE",
    });
  });

  it("steers active runs with full agent content", async () => {
    const harness = new PausedAfterDeltaHarness();
    const { url } = await startAgentHttpServer(harness);
    const response = await fetch(`${url}/agent/runs`, {
      method: "POST",
      body: JSON.stringify({ path: "Projects/app", content: textContent("Build the UI") }),
      headers: { "content-type": "application/json" },
    });
    const firstMessages = await readSseMessages(response, 1);
    const threadId = readThreadId(firstMessages);
    const runId = readRunId(firstMessages);
    const steerContent: AgentContent = [
      { type: "text", content: "Focus on tests first" },
      {
        type: "image",
        data: "aW1hZ2U=",
        mimeType: "image/png",
        metadata: { filename: "screenshot.png" },
      },
      {
        type: "file",
        data: "cGRm",
        mimeType: "application/pdf",
        filename: "notes.pdf",
      },
    ];

    const steerResponse = await fetch(
      `${url}/agent/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/steer`,
      {
        method: "POST",
        body: JSON.stringify({
          path: "Projects/app",
          content: steerContent,
          uiContext: {
            openFiles: [
              { path: "Projects/app/src/App.tsx", isFocused: false },
              { path: "Projects/app/src/Test.ts", isFocused: true },
            ],
          },
        }),
        headers: { "content-type": "application/json" },
      },
    );

    expect(steerResponse.status).toBe(200);
    expect(await steerResponse.json()).toEqual({ turnId: runId });
    expect(harness.steerInputs).toEqual([{
      threadId,
      runId,
      path: "Projects/app",
      content: steerContent,
      uiContext: {
        openFiles: [
          { path: "Projects/app/src/App.tsx", isFocused: false },
          { path: "Projects/app/src/Test.ts", isFocused: true },
        ],
      },
    }]);
    harness.resume();
  });

  it("rejects invalid UI context for steer requests", async () => {
    const harness = new PausedAfterDeltaHarness();
    const { url } = await startAgentHttpServer(harness);
    const response = await fetch(`${url}/agent/runs`, {
      method: "POST",
      body: JSON.stringify({ path: "Projects/app", content: textContent("Build the UI") }),
      headers: { "content-type": "application/json" },
    });
    const firstMessages = await readSseMessages(response, 1);
    const threadId = readThreadId(firstMessages);
    const runId = readRunId(firstMessages);

    const steerResponse = await fetch(
      `${url}/agent/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/steer`,
      {
        method: "POST",
        body: JSON.stringify({
          path: "Projects/app",
          content: textContent("Invalid"),
          uiContext: { openFiles: [{ path: "Projects/app/src/App.tsx" }] },
        }),
        headers: { "content-type": "application/json" },
      },
    );

    expect(steerResponse.status).toBe(400);
    harness.resume();
  });

  it("rejects steering unknown, inactive, and mismatched runs", async () => {
    const completedHarness = new MockAgentHarness();
    const { url: completedUrl } = await startAgentHttpServer(completedHarness);
    const completedResponse = await fetch(`${completedUrl}/agent/runs`, {
      method: "POST",
      body: JSON.stringify({ path: "Projects/app", content: textContent("Build the UI") }),
      headers: { "content-type": "application/json" },
    });
    const completedMessages = await readSseMessages(completedResponse);
    const completedThreadId = readThreadId(completedMessages);
    const completedRunId = readRunId(completedMessages);

    const missingResponse = await fetch(`${completedUrl}/agent/threads/thread-1/runs/missing-run/steer`, {
      method: "POST",
      body: JSON.stringify({ path: "Projects/app", content: textContent("Missing") }),
      headers: { "content-type": "application/json" },
    });
    const inactiveResponse = await fetch(
      `${completedUrl}/agent/threads/${encodeURIComponent(completedThreadId)}/runs/${encodeURIComponent(completedRunId)}/steer`,
      {
        method: "POST",
        body: JSON.stringify({ path: "Projects/app", content: textContent("Inactive") }),
        headers: { "content-type": "application/json" },
      },
    );

    const activeHarness = new PausedAfterDeltaHarness();
    const { url: activeUrl } = await startAgentHttpServer(activeHarness);
    const activeResponse = await fetch(`${activeUrl}/agent/runs`, {
      method: "POST",
      body: JSON.stringify({ path: "Projects/app", content: textContent("Build the UI") }),
      headers: { "content-type": "application/json" },
    });
    const activeMessages = await readSseMessages(activeResponse, 1);
    const activeRunId = readRunId(activeMessages);
    const mismatchResponse = await fetch(
      `${activeUrl}/agent/threads/other-thread/runs/${encodeURIComponent(activeRunId)}/steer`,
      {
        method: "POST",
        body: JSON.stringify({ path: "Projects/app", content: textContent("Mismatch") }),
        headers: { "content-type": "application/json" },
      },
    );

    expect(missingResponse.status).toBe(404);
    expect(inactiveResponse.status).toBe(409);
    expect(mismatchResponse.status).toBe(409);
    activeHarness.resume();
  });

  it("resumes active thread streams after the loaded thread snapshot", async () => {
    const harness = new PausedAfterDeltaHarness();
    const { url } = await startAgentHttpServer(harness);
    const response = await fetch(`${url}/agent/runs`, {
      method: "POST",
      body: JSON.stringify({
        path: "Projects/app",
        content: textContent("Build the UI"),
      }),
      headers: { "content-type": "application/json" },
    });
    const firstMessages = await readSseMessages(response, 7);
    const threadId = readThreadId(firstMessages);
    const firstDelta = firstMessages.find((message) =>
      message.event === "event" &&
      (message.data as { readonly event: AgentRunEvent }).event.type === "content.delta"
    );
    const firstDeltaEvent = (firstDelta?.data as {
      readonly event?: Extract<AgentRunEvent, { readonly type: "content.delta" }>;
    } | undefined)?.event;

    expect(firstDeltaEvent?.delta).toBe("Hello ");

    const threadResponse = await fetch(`${url}/agent/threads/${encodeURIComponent(threadId)}`);
    const threadBody = await threadResponse.json() as {
      readonly thread: AgentThread;
      readonly activeRun?: { readonly runId: string; readonly eventsUrl: string; readonly replayAfterEventId: number };
    };

    expect(threadBody.thread.messages).toHaveLength(2);
    expect(threadBody.activeRun?.replayAfterEventId).toBe(firstDelta?.id);

    const replayAfterEventId = threadBody.activeRun?.replayAfterEventId ?? 0;
    const resumed = fetch(`${url}${threadBody.activeRun?.eventsUrl ?? ""}?after=${String(replayAfterEventId)}`)
      .then((resumeResponse) => readSseMessages(resumeResponse));
    harness.resume();
    const replayed = await resumed;
    const replayedDeltas = replayed
      .filter((message) => message.event === "event")
      .map((message) => (message.data as { readonly event: AgentRunEvent }).event)
      .filter((event): event is Extract<AgentRunEvent, { readonly type: "content.delta" }> =>
        event.type === "content.delta"
      )
      .map((event) => event.delta);

    expect(replayedDeltas).toEqual(["world"]);
    expect(replayed.map((message) => message.event)).toContain("run_end");
  });

  it("reuses active runs for matching clientRunId", async () => {
    const { url } = await startAgentHttpServer(new SlowAgentHarness());
    const first = fetch(`${url}/agent/runs`, {
      method: "POST",
      body: JSON.stringify({
        path: "Projects/app",
        content: textContent("Build the UI"),
        clientRunId: "same-run",
      }),
      headers: { "content-type": "application/json" },
    });
    const second = await fetch(`${url}/agent/runs`, {
      method: "POST",
      body: JSON.stringify({
        path: "Projects/app",
        content: textContent("Build the UI"),
        clientRunId: "same-run",
      }),
      headers: { "content-type": "application/json" },
    });

    const [firstMessages, secondMessages] = await Promise.all([
      first.then((response) => readSseMessages(response)),
      readSseMessages(second),
    ]);

    const firstRunId = readRunId(firstMessages);
    const secondRunId = readRunId(secondMessages);

    expect(firstRunId).toBe(secondRunId);
  });
});

class SlowAgentHarness implements IAgentHarness {
  private readonly inner = new MockAgentHarness();

  setup(input: SetupInput): Promise<void> {
    return this.inner.setup(input);
  }

  retrieveThreads(input: RetrieveThreadsInput): Promise<RetrieveThreadsResult> {
    return this.inner.retrieveThreads(input);
  }

  getThread(input: { readonly threadId: string }) {
    return this.inner.getThread(input);
  }

  async *sendMessage(input: SendMessageInput): AsyncIterable<AgentRunEvent> {
    for await (const event of this.inner.sendMessage(input)) {
      await sleep(10);
      yield event;
    }
  }

  cancelRun(): Promise<void> {
    return Promise.resolve();
  }
}

class StaticThreadsHarness implements IAgentHarness {
  constructor(private readonly threads: readonly AgentThreadSummary[]) {}

  setup(_input: SetupInput): Promise<void> {
    return Promise.resolve();
  }

  retrieveThreads(_input: RetrieveThreadsInput): Promise<RetrieveThreadsResult> {
    return Promise.resolve({ groups: [{ path: "Projects/app", threads: [...this.threads] }] });
  }

  getThread(input: { readonly threadId: string }): Promise<AgentThread> {
    const thread = this.threads.find((candidate) => candidate.id === input.threadId);

    if (thread === undefined) {
      return Promise.reject(new Error("Thread not found"));
    }

    return Promise.resolve({
      ...thread,
      messages: [],
      activities: [],
    });
  }

  async *sendMessage(_input: SendMessageInput): AsyncIterable<AgentRunEvent> {}

  cancelRun(): Promise<void> {
    return Promise.resolve();
  }
}

class PausedAfterDeltaHarness implements IAgentHarness {
  private readonly gate = createGate();
  readonly steerInputs: SteerRunInput[] = [];
  private thread: AgentThread | null = null;

  setup(_input: SetupInput): Promise<void> {
    return Promise.resolve();
  }

  retrieveThreads(_input: RetrieveThreadsInput): Promise<RetrieveThreadsResult> {
    return Promise.resolve({ groups: [] });
  }

  async getThread(input: { readonly threadId: string }): Promise<AgentThread> {
    if (this.thread === null || this.thread.id !== input.threadId) {
      throw new Error("Thread not found");
    }

    return {
      ...this.thread,
      messages: this.thread.messages.map((message) => ({ ...message })),
      activities: this.thread.activities.map((activity) => ({ ...activity })),
      proposedPlans: this.thread.proposedPlans?.map((plan) => ({ ...plan })),
    };
  }

  async *sendMessage(input: SendMessageInput): AsyncIterable<AgentRunEvent> {
    const now = Date.now();
    const runId = "paused-run";
    const threadId = "paused-thread";
    const turnId = runId;
    let sequence = 0;
    const base = <TType extends AgentRunEvent["type"]>(type: TType, createdAt = Date.now()) => ({
      version: 2 as const,
      type,
      runId,
      threadId,
      turnId,
      sequence: ++sequence,
      createdAt,
      provider: "paused-test",
    });
    const thread: AgentThread = {
      id: threadId,
      title: "Build the UI",
      startPath: input.path,
      lastPath: input.path,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      messages: [],
      activities: [],
      proposedPlans: [],
    };
    this.thread = thread;

    yield { ...base("thread.created", now), thread: toThreadSummary(thread) };
    yield { ...base("turn.started", now), input: input.content, path: input.path };

    const userMessage: UserMessage = {
      role: "user",
      id: "paused-user",
      timestamp: now,
      content: input.content,
      path: input.path,
    };
    thread.messages.push(userMessage);
    thread.messageCount = thread.messages.length;
    yield {
      ...base("message.started", now),
      messageType: "user",
      messageId: userMessage.id,
      message: userMessage,
    };
    yield {
      ...base("message.completed", now),
      messageType: "user",
      messageId: userMessage.id,
      message: userMessage,
    };

    const assistantMessage = createPausedAssistantMessage(now + 1, "");
    thread.messages.push(assistantMessage);
    thread.messageCount = thread.messages.length;
    yield {
      ...base("message.started", now + 1),
      messageType: "assistant",
      messageId: assistantMessage.id,
      message: assistantMessage,
    };

    const partialAssistantMessage = createPausedAssistantMessage(now + 1, "Hello ");
    thread.messages[thread.messages.length - 1] = partialAssistantMessage;
    yield {
      ...base("content.delta", now + 1),
      messageId: partialAssistantMessage.id,
      contentIndex: 0,
      streamKind: "assistant_text",
      delta: "Hello ",
    };

    await this.gate.promise;

    const completedAssistantMessage = createPausedAssistantMessage(now + 1, "Hello world");
    thread.messages[thread.messages.length - 1] = completedAssistantMessage;
    yield {
      ...base("content.delta", now + 2),
      messageId: completedAssistantMessage.id,
      contentIndex: 0,
      streamKind: "assistant_text",
      delta: "world",
    };
    yield {
      ...base("message.completed", now + 2),
      messageType: "assistant",
      messageId: completedAssistantMessage.id,
      message: completedAssistantMessage,
    };
    yield { ...base("turn.completed", now + 2), status: "completed" };
    thread.updatedAt = now + 2;
    yield { ...base("thread.updated", now + 2), thread: toThreadSummary(thread) };
  }

  cancelRun(): Promise<void> {
    this.resume();
    return Promise.resolve();
  }

  steerRun(input: SteerRunInput): Promise<SteerRunResult> {
    this.steerInputs.push(input);
    return Promise.resolve({ turnId: input.runId });
  }

  resume(): void {
    this.gate.resolve();
  }
}

const startAgentHttpServer = async (harness: IAgentHarness): Promise<{ readonly server: Server; readonly url: string }> => {
  const agent = createAgentHttpService({ harness });
  const server = createServer((request, response) => {
    void agent.handleRequest(request, response);
  });
  openServers.push(server);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }

  return { server, url: `http://127.0.0.1:${String(address.port)}` };
};

const textContent = (content: string): AgentContent => [{ type: "text", content }];

const collectEvents = async (events: AsyncIterable<AgentRunEvent>): Promise<AgentRunEvent[]> => {
  const collected: AgentRunEvent[] = [];

  for await (const event of events) {
    collected.push(event);
  }

  return collected;
};

const readSseMessages = async (
  response: Response,
  limit = Number.POSITIVE_INFINITY,
): Promise<Array<{ readonly id: number; readonly event: string; readonly data: unknown }>> => {
  if (response.body === null) {
    throw new Error("Expected SSE body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const messages: Array<{ readonly id: number; readonly event: string; readonly data: unknown }> = [];
  let buffer = "";

  while (messages.length < limit) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let boundaryIndex = buffer.indexOf("\n\n");

    while (boundaryIndex >= 0) {
      const raw = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      const message = parseSseMessage(raw);

      if (message !== null) {
        messages.push(message);
      }

      if (messages.length >= limit) {
        await reader.cancel();
        return messages;
      }

      boundaryIndex = buffer.indexOf("\n\n");
    }
  }

  return messages;
};

const parseSseMessage = (raw: string): { readonly id: number; readonly event: string; readonly data: unknown } | null => {
  if (raw.startsWith(":")) {
    return null;
  }

  const lines = raw.split("\n");
  const id = Number.parseInt(lines.find((line) => line.startsWith("id: "))?.slice(4) ?? "", 10);
  const event = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "";
  const data = lines.find((line) => line.startsWith("data: "))?.slice(6);

  return data === undefined || !Number.isInteger(id) ? null : { id, event, data: JSON.parse(data) as unknown };
};

const readRunId = (messages: Array<{ readonly event: string; readonly data: unknown }>): string =>
  (messages.find((message) => message.event === "run_start")?.data as { readonly runId: string }).runId;

const readThreadId = (messages: Array<{ readonly event: string; readonly data: unknown }>): string =>
  (messages.find((message) => message.event === "run_start")?.data as { readonly threadId: string }).threadId;

const createPausedAssistantMessage = (timestamp: number, text: string): AssistantMessage => ({
  role: "assistant",
  id: "paused-assistant",
  timestamp,
  duration: 0,
  stopReason: "stop",
  content: [
    {
      type: "response",
      response: [{ type: "text", content: text }],
    },
  ],
});

const toThreadSummary = (thread: AgentThread): AgentThreadSummary => ({
  id: thread.id,
  title: thread.title,
  startPath: thread.startPath,
  lastPath: thread.lastPath,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
  messageCount: thread.messageCount,
});

const createGate = (): { readonly promise: Promise<void>; readonly resolve: () => void } => {
  let resolveGate: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });

  return { promise, resolve: resolveGate };
};

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error !== undefined) {
        rejectClose(error);
        return;
      }

      resolveClose();
    });
  });

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
