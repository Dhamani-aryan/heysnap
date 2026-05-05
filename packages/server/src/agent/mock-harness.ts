import { randomUUID } from "node:crypto";

import { AgentError } from "./errors.js";
import type {
  AgentContent,
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
    const existingThread = input.threadId === undefined ? undefined : this.threads.get(input.threadId);

    if (input.threadId !== undefined && existingThread === undefined) {
      throw new AgentError("THREAD_NOT_FOUND", "Thread not found");
    }

    const thread = existingThread ?? createThread(input, now);
    const threadId = thread.id;
    const scope = { runId, threadId };

    if (existingThread === undefined) {
      this.threads.set(thread.id, thread);
    }

    yield { ...scope, type: "agent_start" };
    yield { ...scope, type: "turn_start" };

    if (existingThread === undefined) {
      yield { ...scope, type: "thread_created", thread: toThreadSummary(thread) };
    }

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
      ...scope,
      type: "message_start",
      messageType: "user",
      messageId: userMessage.id,
      message: userMessage,
    };
    yield {
      ...scope,
      type: "message_end",
      messageType: "user",
      messageId: userMessage.id,
      message: userMessage,
    };

    const assistantMessage = createAssistantMessage(now);
    thread.messages.push(assistantMessage);
    updateThread(thread, input.path, Date.now());

    yield {
      ...scope,
      type: "message_start",
      messageType: "assistant",
      messageId: assistantMessage.id,
      message: assistantMessage,
    };
    yield {
      ...scope,
      type: "message_update",
      messageType: "assistant",
      messageId: assistantMessage.id,
      message: assistantMessage,
    };
    yield {
      ...scope,
      type: "message_end",
      messageType: "assistant",
      messageId: assistantMessage.id,
      message: assistantMessage,
    };

    yield { ...scope, type: "thread_updated", thread: toThreadSummary(thread) };
    yield { ...scope, type: "turn_end" };
    yield { ...scope, type: "agent_end", agentMessages: [userMessage, assistantMessage] };
  }

  async cancelRun(): Promise<void> {
    return Promise.resolve();
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
});

const createSeedThreads = (): MutableAgentThread[] => {
  const now = Date.now();

  return [
    createSeedThread({
      id: "mock-thread-desktop-plan",
      title: "Plan the desktop chat surface",
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
      userText: "Build the shared filesystem explorer and keep web and desktop identical.",
      assistantText: [
        "Implemented as a shared React surface so both apps consume the same component.",
        "",
        "**Important bits:**",
        "",
        "1. The server keeps paths root-relative.",
        "2. The UI handles selection, context menus, rename, trash, and folder navigation.",
        "3. Web and desktop only pass their WebSocket URL overrides.",
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
      userText: "Design the server-side agent WebSocket contract.",
      assistantText: [
        "The clean shape is a single `/agent` WebSocket endpoint with request messages and streamed run events.",
        "",
        "For static history, the UI only needs:",
        "",
        "- `retrieveThreads` for grouped summaries",
        "- `getThread` for the full conversation",
        "- `sendMessage` later for live runs",
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
