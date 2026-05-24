import { randomUUID } from "node:crypto";

import { AgentError } from "./errors.js";
import type {
  AgentContent,
  EditThreadUserMessageInput,
  AgentMessage,
  AgentRunEvent,
  AgentThread,
  AgentThreadGroup,
  AgentThreadSummary,
  AssistantMessage,
  IAgentHarness,
  RetrieveThreadsInput,
  RetrieveThreadsResult,
  SendMessageInput,
  SteerRunInput,
  SteerRunResult,
  UserMessage,
} from "./types.js";

export interface MockAgentHarnessOptions {
  readonly seedThreads?: boolean;
}

export class MockAgentHarness implements IAgentHarness {
  private readonly threads = new Map<string, MutableAgentThread>();

  constructor(options: MockAgentHarnessOptions = {}) {
    if (options.seedThreads === true) {
      for (const thread of createSeedThreads()) {
        this.threads.set(thread.id, thread);
      }
    }
  }

  async setup(_input: unknown): Promise<void> {}

  async retrieveThreads(input: RetrieveThreadsInput = {}): Promise<RetrieveThreadsResult> {
    const threads = Array.from(this.threads.values())
      .filter((thread) => isThreadInRoot(thread, input.rootPath))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, input.limit);

    const groups = new Map<string, AgentThreadSummary[]>();

    for (const thread of threads) {
      const group = groups.get(thread.startPath) ?? [];
      group.push(toThreadSummary(thread));
      groups.set(thread.startPath, group);
    }

    return {
      groups: Array.from(groups.entries())
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
        .map(([path, groupThreads]): AgentThreadGroup => ({
          path,
          threads: groupThreads.sort((left, right) => right.updatedAt - left.updatedAt),
        })),
    };
  }

  async getThread(input: { readonly threadId: string }): Promise<AgentThread> {
    const thread = this.threads.get(input.threadId);

    if (thread === undefined) {
      throw new AgentError("THREAD_NOT_FOUND", "Thread not found");
    }

    return cloneThread(thread);
  }

  async *sendMessage(input: SendMessageInput): AsyncIterable<AgentRunEvent> {
    const runId = randomUUID();
    const now = Date.now();
    const turnId = runId;
    let sequence = 0;
    const existingThread = input.threadId === undefined ? undefined : this.threads.get(input.threadId);

    if (input.threadId !== undefined && existingThread === undefined) {
      throw new AgentError("THREAD_NOT_FOUND", "Thread not found");
    }

    const thread = existingThread ?? createThread(input, now);
    const threadId = thread.id;
    const base = <TType extends AgentRunEvent["type"]>(type: TType, createdAt = Date.now()) => ({
      version: 2 as const,
      type,
      runId,
      threadId,
      turnId,
      sequence: ++sequence,
      createdAt,
      provider: "mock",
      providerRefs: {
        providerThreadId: threadId,
        providerTurnId: turnId,
      },
    });

    if (existingThread === undefined) {
      this.threads.set(thread.id, thread);
      yield {
        ...base("thread.created", now),
        thread: toThreadSummary(thread),
      };
    }

    yield { ...base("turn.started", now), input: cloneContent(input.content), path: input.path };

    const userMessage: UserMessage = {
      role: "user",
      id: randomUUID(),
      timestamp: now,
      content: cloneContent(input.content),
      path: input.path,
    };
    thread.messages.push(userMessage);
    updateThread(thread, input.path, now);

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

    const toolItemId = `${runId}:tool:scan`;
    const toolActivity = {
      id: `activity:${toolItemId}`,
      runId,
      turnId,
      itemId: toolItemId,
      kind: "tool.completed" as const,
      tone: "tool" as const,
      status: "completed" as const,
      title: "Command",
      summary: "$ ls",
      createdAt: now + 1,
      updatedAt: now + 1,
      sequence: sequence + 1,
      payload: { command: "ls" },
    };
    thread.activities.push(toolActivity);

    yield {
      ...base("item.started", now + 1),
      providerRefs: { providerThreadId: threadId, providerTurnId: turnId, providerItemId: toolItemId },
      item: {
        id: toolItemId,
        itemType: "command_execution",
        status: "running",
        title: "Command",
        summary: "$ ls",
        args: { command: "ls" },
      },
    };
    yield {
      ...base("item.completed", now + 1),
      providerRefs: { providerThreadId: threadId, providerTurnId: turnId, providerItemId: toolItemId },
      item: {
        id: toolItemId,
        itemType: "command_execution",
        status: "completed",
        title: "Command",
        summary: "$ ls",
        result: { exitCode: 0 },
        isError: false,
      },
    };

    const assistantMessage = {
      ...createAssistantMessage(now + 2),
      content: [
        {
          type: "response" as const,
          response: [{ type: "text" as const, content: "" }],
        },
      ],
    };
    const completedAssistantMessage = {
      ...createAssistantMessage(now + 2),
      id: assistantMessage.id,
    };
    thread.messages.push(assistantMessage);
    updateThread(thread, input.path, Date.now());

    yield {
      ...base("message.started", now + 2),
      messageType: "assistant",
      messageId: assistantMessage.id,
      message: assistantMessage,
    };
    yield {
      ...base("content.delta", now + 2),
      messageId: assistantMessage.id,
      contentIndex: 0,
      streamKind: "assistant_text",
      delta: "Mock response...",
    };
    thread.messages[thread.messages.length - 1] = completedAssistantMessage;
    yield {
      ...base("message.completed", now + 3),
      messageType: "assistant",
      messageId: completedAssistantMessage.id,
      message: completedAssistantMessage,
    };

    yield {
      ...base("turn.completed", now + 3),
      status: "completed",
    };
    yield { ...base("thread.updated", now + 3), thread: toThreadSummary(thread) };
  }

  async *editThreadUserMessage(input: EditThreadUserMessageInput): AsyncIterable<AgentRunEvent> {
    const thread = this.threads.get(input.threadId);

    if (thread === undefined) {
      throw new AgentError("THREAD_NOT_FOUND", "Thread not found");
    }

    rollbackThread(thread, input.numTurns);

    yield* this.sendMessage({
      threadId: input.threadId,
      path: input.path,
      content: input.content,
    });
  }

  async cancelRun(): Promise<void> {
    return Promise.resolve();
  }

  async steerRun(input: SteerRunInput): Promise<SteerRunResult> {
    return Promise.resolve({ turnId: input.runId });
  }
}

const createThread = (input: SendMessageInput, now: number): AgentThread => ({
  id: randomUUID(),
  title: createTitle(input.content),
  startPath: input.path,
  lastPath: input.path,
  createdAt: now,
  updatedAt: now,
  messageCount: 0,
  messages: [],
  activities: [],
  proposedPlans: [],
});

const rollbackThread = (thread: MutableAgentThread, numTurns: number): void => {
  let userMessagesSeen = 0;

  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];

    if (message?.role !== "user") {
      continue;
    }

    userMessagesSeen += 1;

    if (userMessagesSeen === numTurns) {
      thread.messages.splice(index);
      thread.activities.splice(0);
      thread.proposedPlans?.splice(0);
      thread.messageCount = thread.messages.filter((candidate) => candidate.role === "user").length;
      thread.updatedAt = Date.now();
      return;
    }
  }

  throw new AgentError("TURN_NOT_FOUND", "Could not find a user turn to edit");
};

const createSeedThreads = (): MutableAgentThread[] => {
  const now = Date.now();

  return [
    createSeedThread({
      id: "mock-thread-chat-plan",
      title: "Plan the chat surface",
      startPath: "",
      lastPath: "",
      createdAt: now - 1000 * 60 * 60 * 28,
      updatedAt: now - 1000 * 60 * 18,
      duration: 385_000,
      userText: "Plan the empty thread screen and prompt composer. It should feel quiet and match the Finder redesign.",
      assistantText: [
        "Yes - the empty thread screen should stay minimal and let the prompt composer carry the interaction.",
        "",
        "I would keep the first version to three visible pieces:",
        "",
        "- a centered **What would you like to do today?** headline",
        "- the existing attachment-capable prompt box",
        "- no extra panels, onboarding, or decorative copy",
        "",
        "That keeps the right side ready for the real agent transcript without making the first state feel like a landing page.",
        "",
        "## Layout notes",
        "",
        "The right panel should feel like a workspace, not a website. That means the transcript needs restrained spacing, compact typography, and enough white space to breathe without turning into a marketing page.",
        "",
        "The empty screen can stay vertically centered, but once a thread is selected the transcript should use the full scroll area. The prompt composer remains pinned at the bottom so the user always has a clear next action.",
        "",
        "## Message treatment",
        "",
        "User messages should be visually distinct but quiet:",
        "",
        "- right aligned",
        "- compact rounded bubble",
        "- no avatar",
        "- no timestamp in the first version",
        "- attachments as small chips or thumbnails",
        "",
        "Assistant messages should read more like a document than a chat bubble. A plain left-aligned markdown block is easier to scan for long coding-agent answers, especially when the answer contains lists, code, or file references.",
        "",
        "## Static rendering rule",
        "",
        "For already-loaded conversations, the renderer should intentionally ignore operational noise. The transcript should not show tool calls, tool results, or reasoning. It only needs to show the user prompt and the final assistant response that is meant for the user.",
        "",
        "That keeps old threads clean while still letting the harness store richer internal state.",
        "",
        "## Scrolling behavior to check",
        "",
        "This mock response is intentionally longer so the right pane can be tested for natural scrolling. The things to look for:",
        "",
        "1. The transcript should scroll independently from the file explorer.",
        "2. The prompt composer should stay visible at the bottom.",
        "3. The last paragraph should not hide behind the composer.",
        "4. Markdown spacing should remain compact in both light and dark themes.",
        "5. Inline code like `sendMessage` and `retrieveThreads` should not make the line height feel jumpy.",
        "",
        "## Later streaming pass",
        "",
        "When live runs are connected, the same surface can render streaming assistant text through Streamdown. The important detail is to keep the static transcript path and the streaming path visually identical, so switching from a live run to a stored thread does not feel like a different UI.",
        "",
        "A good next step after this mock test is wiring the composer to send an `AgentContent` user message and append streamed events into the same display model.",
      ].join("\n"),
    }),
    createSeedThread({
      id: "mock-thread-projects-ui",
      title: "Implement shared Finder UI",
      startPath: "Projects",
      lastPath: "Projects/ank1015-app",
      createdAt: now - 1000 * 60 * 60 * 52,
      updatedAt: now - 1000 * 60 * 47,
      duration: 91_000,
      userText: "Build the shared filesystem explorer and keep web and mobile aligned.",
      assistantText: [
        "Implemented as a shared React surface so both apps consume the same component.",
        "",
        "**Important bits:**",
        "",
        "1. The server keeps paths root-relative.",
        "2. The UI handles selection, context menus, rename, trash, and folder navigation.",
        "3. Client apps only pass their WebSocket URL overrides.",
        "",
        "The next useful pass is connecting selected files and folders to the agent context.",
      ].join("\n"),
    }),
    createSeedThread({
      id: "mock-thread-projects-agent",
      title: "Design agent harness API",
      startPath: "Projects",
      lastPath: "Projects/ank1015-app/packages/server",
      createdAt: now - 1000 * 60 * 60 * 76,
      updatedAt: now - 1000 * 60 * 74,
      duration: 38_000,
      userText: "Design the server-side agent REST/SSE contract.",
      assistantText: [
        "The clean shape is a small `/agent` REST API with SSE endpoints for streamed run events.",
        "",
        "For static history, the UI only needs:",
        "",
        "- `GET /agent/threads` for grouped summaries",
        "- `GET /agent/threads/:threadId` for the full conversation",
        "- `POST /agent/runs` for live runs",
        "",
        "The harness boundary stays provider-neutral, while the internal implementation can still preserve native model responses.",
      ].join("\n"),
    }),
    createSeedThread({
      id: "mock-thread-notes",
      title: "Summarize release notes",
      startPath: "Notes",
      lastPath: "Notes",
      createdAt: now - 1000 * 60 * 60 * 96,
      updatedAt: now - 1000 * 60 * 60 * 20,
      duration: 12_000,
      userText: "Summarize the notes in this folder.",
      assistantText: [
        "Here is the short version:",
        "",
        "> The project is moving from filesystem browsing into agent conversations.",
        "",
        "The immediate UI need is a readable transcript view. It should show user prompts, final assistant answers, and hide implementation detail like tool calls or intermediate reasoning.",
      ].join("\n"),
    }),
  ];
};

const createSeedThread = (input: {
  readonly id: string;
  readonly title: string;
  readonly startPath: string;
  readonly lastPath: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly duration: number;
  readonly userText: string;
  readonly assistantText: string;
}): MutableAgentThread => {
  const userMessage: UserMessage = {
    role: "user",
    id: `${input.id}-user`,
    timestamp: input.createdAt,
    path: input.startPath,
    content: [{ type: "text", content: input.userText }],
  };
  const assistantMessage: AssistantMessage = {
    ...createAssistantMessage(input.updatedAt),
    id: `${input.id}-assistant`,
    duration: input.duration,
    content: [
      {
        type: "response",
        response: [{ type: "text", content: input.assistantText }],
      },
    ],
  };
  const messages: AgentMessage[] = [userMessage, assistantMessage];

  return {
    id: input.id,
    title: input.title,
    startPath: input.startPath,
    lastPath: input.lastPath,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    messageCount: messages.length,
    messages,
    activities: [
      {
        id: `${input.id}-activity-command`,
        itemId: `${input.id}-command`,
        kind: "tool.completed",
        tone: "tool",
        status: "completed",
        title: "Command",
        summary: "$ pnpm typecheck",
        createdAt: input.updatedAt - 1000,
        updatedAt: input.updatedAt - 1000,
        sequence: 0,
        payload: { command: "pnpm typecheck", exitCode: 0 },
      },
    ],
    proposedPlans: [],
  };
};

const createAssistantMessage = (timestamp: number): AssistantMessage => ({
  role: "assistant",
  id: randomUUID(),
  timestamp,
  duration: 0,
  model: "mock-agent",
  provider: "mock",
  stopReason: "stop",
  content: [
    {
      type: "response",
      response: [{ type: "text", content: "Mock response..." }],
    },
  ],
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
  },
});

const createTitle = (content: AgentContent): string => {
  const text = content.find((block) => block.type === "text")?.content.trim();

  if (text === undefined || text.length === 0) {
    return "New chat";
  }

  return text.replace(/\s+/g, " ").slice(0, 80);
};

const updateThread = (thread: MutableAgentThread, path: string, updatedAt: number): void => {
  thread.lastPath = path;
  thread.updatedAt = updatedAt;
  thread.messageCount = thread.messages.length;
};

const toThreadSummary = (thread: AgentThread): AgentThreadSummary => ({
  id: thread.id,
  title: thread.title,
  startPath: thread.startPath,
  lastPath: thread.lastPath,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
  messageCount: thread.messageCount,
});

const isThreadInRoot = (thread: AgentThread, rootPath: string | undefined): boolean => {
  if (rootPath === undefined || rootPath === "") {
    return true;
  }

  return thread.startPath === rootPath || thread.startPath.startsWith(`${rootPath}/`);
};

const cloneThread = (thread: AgentThread): AgentThread => ({
  ...thread,
  messages: thread.messages.map(cloneMessage),
  activities: thread.activities.map((activity) => ({ ...activity })),
  proposedPlans: thread.proposedPlans?.map((plan) => ({ ...plan })),
});

const cloneMessage = (message: AgentMessage): AgentMessage => {
  if (message.role === "user" || message.role === "toolResult") {
    return { ...message, content: cloneContent(message.content) };
  }

  if (message.role === "assistant") {
    return {
      ...message,
      content: message.content.map((block) => {
        if (block.type === "response") {
          return { ...block, response: cloneContent(block.response) };
        }

        return { ...block };
      }),
    };
  }

  return { ...message, content: { ...message.content } };
};

const cloneContent = (content: AgentContent): AgentContent =>
  content.map((block) => ({ ...block, ...(block.metadata !== undefined ? { metadata: { ...block.metadata } } : {}) }));

type MutableAgentThread = {
  -readonly [Key in keyof AgentThread]: AgentThread[Key];
};
