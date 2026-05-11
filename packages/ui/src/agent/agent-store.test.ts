import { describe, expect, it } from "vitest";

import { createAgentChatStore, getAssistantMarkdown, getTextContent } from "./agent-store";
import { createAgentThreadListStore, selectHasStreamingThreads } from "./agent-thread-list-store";
import type { AgentRunEvent, AgentRuntimeItem, AgentThread } from "./types";

const baseEvent = (
  type: AgentRunEvent["type"],
  input: Record<string, unknown>,
  sequence: number,
): AgentRunEvent => ({
  version: 2,
  type,
  runId: "run-1",
  threadId: "thread-1",
  sequence,
  createdAt: 1_000 + sequence,
  provider: "codex",
  ...input,
} as AgentRunEvent);

const assistantMessage = (id: string) => ({
  role: "assistant" as const,
  id,
  timestamp: 1_000,
  duration: 0,
  stopReason: "stop" as const,
  content: [
    {
      type: "response" as const,
      response: [{ type: "text" as const, content: "" }],
    },
  ],
});

const toolItem = (overrides: Partial<AgentRuntimeItem> = {}): AgentRuntimeItem => ({
  id: "tool-1",
  itemType: "command_execution",
  status: "running",
  title: "Shell command",
  summary: "Running pnpm test",
  ...overrides,
});

describe("agent chat store projector", () => {
  it("accumulates buffered assistant deltas without replacing the message id", () => {
    const store = createAgentChatStore();
    const message = assistantMessage("assistant-1");

    store.getState().applyRuntimeEvent(baseEvent("message.started", {
      messageId: message.id,
      messageType: "assistant",
      message,
    }, 1));
    store.getState().bufferRuntimeEvent(baseEvent("content.delta", {
      messageId: message.id,
      contentIndex: 0,
      streamKind: "assistant_text",
      delta: "Hello",
    }, 2));
    store.getState().bufferRuntimeEvent(baseEvent("content.delta", {
      messageId: message.id,
      contentIndex: 0,
      streamKind: "assistant_text",
      delta: " world",
    }, 3));
    store.getState().flushBufferedRuntimeEvents();

    const projected = store.getState().messagesById[message.id];
    expect(projected?.role).toBe("assistant");
    expect(store.getState().messageOrder).toEqual([message.id]);
    expect(getAssistantMarkdown(projected as typeof message)).toBe("Hello world");
    expect(store.getState().pendingDeltaBuffer).toEqual([]);
  });

  it("keeps row ordering references stable while an existing assistant message streams", () => {
    const store = createAgentChatStore();
    const message = assistantMessage("assistant-1");

    store.getState().applyRuntimeEvent(baseEvent("message.started", {
      messageId: message.id,
      messageType: "assistant",
      message,
    }, 1));
    const messageOrder = store.getState().messageOrder;
    const streamingIds = store.getState().streamingMessageIds;

    store.getState().applyRuntimeEvent(baseEvent("content.delta", {
      messageId: message.id,
      contentIndex: 0,
      streamKind: "assistant_text",
      delta: "Hello",
    }, 2));

    expect(store.getState().messageOrder).toBe(messageOrder);
    expect(store.getState().streamingMessageIds).toBe(streamingIds);
    expect(getAssistantMarkdown(store.getState().messagesById[message.id] as typeof message)).toBe("Hello");
  });

  it("reconciles optimistic user messages with server start and completion events", () => {
    const store = createAgentChatStore();
    const optimisticMessage = {
      role: "user" as const,
      id: "optimistic-user-1",
      timestamp: 1_000,
      path: "project",
      content: [{ type: "text" as const, content: "Run tests" }],
    };
    const serverMessage = {
      ...optimisticMessage,
      id: "user-1",
    };

    store.getState().addOptimisticUserMessage(optimisticMessage, {
      runId: null,
      threadId: "thread-1",
      startedAt: 1_000,
      optimisticUserMessageId: optimisticMessage.id,
    });
    store.getState().applyRuntimeEvent(baseEvent("message.started", {
      messageId: serverMessage.id,
      messageType: "user",
      message: serverMessage,
    }, 1));
    store.getState().applyRuntimeEvent(baseEvent("message.completed", {
      messageId: serverMessage.id,
      messageType: "user",
      message: serverMessage,
    }, 2));

    expect(store.getState().messageOrder).toEqual(["optimistic-user-1"]);
    expect(store.getState().messagesById["optimistic-user-1"]).toEqual(serverMessage);
    expect(store.getState().messagesById["user-1"]).toBeUndefined();
    expect(store.getState().timelineRows).toEqual([
      {
        kind: "message",
        id: "message:optimistic-user-1",
        messageId: "optimistic-user-1",
        role: "user",
        createdAt: 1_000,
      },
      {
        kind: "status",
        id: "status:optimistic-user-1",
        messageId: "optimistic-user-1",
        createdAt: 1_000,
      },
    ]);
    expect(store.getState().activeRun?.optimisticUserMessageId).toBeNull();
  });

  it("merges replayed ongoing turn events into the loaded thread snapshot", () => {
    const store = createAgentChatStore();
    const loadedUser = {
      role: "user" as const,
      id: "loaded-user",
      timestamp: 1_000,
      path: "project",
      content: [{ type: "text" as const, content: "Setup a typescript project here." }],
    };
    const loadedAssistant = {
      ...assistantMessage("loaded-assistant"),
      timestamp: 2_000,
      content: [
        {
          type: "response" as const,
          response: [{ type: "text" as const, content: "Hello world" }],
        },
      ],
    };

    store.getState().loadThread({
      id: "thread-1",
      title: "Setup",
      startPath: "project",
      lastPath: "project",
      createdAt: 1,
      updatedAt: 2,
      messageCount: 1,
      messages: [loadedUser, loadedAssistant],
      activities: [],
    });
    store.getState().markRunStarted({ runId: "run-1", threadId: "thread-1" });

    store.getState().applyRuntimeEvent(baseEvent("message.started", {
      messageId: "replayed-user",
      messageType: "user",
      message: { ...loadedUser, id: "replayed-user" },
    }, 1));
    store.getState().applyRuntimeEvent(baseEvent("message.started", {
      messageId: "replayed-assistant",
      messageType: "assistant",
      message: assistantMessage("replayed-assistant"),
    }, 2));
    store.getState().applyRuntimeEvent(baseEvent("content.delta", {
      messageId: "replayed-assistant",
      contentIndex: 0,
      streamKind: "assistant_text",
      delta: "Hello",
    }, 3));
    store.getState().applyRuntimeEvent(baseEvent("content.delta", {
      messageId: "replayed-assistant",
      contentIndex: 0,
      streamKind: "assistant_text",
      delta: " world",
    }, 4));
    store.getState().applyRuntimeEvent(baseEvent("content.delta", {
      messageId: "replayed-assistant",
      contentIndex: 0,
      streamKind: "assistant_text",
      delta: "!",
    }, 5));

    expect(store.getState().messageOrder).toEqual(["loaded-user", "loaded-assistant", "replayed-assistant"]);
    expect(store.getState().messagesById["replayed-user"]).toBeUndefined();
    expect(getAssistantMarkdown(store.getState().messagesById["replayed-assistant"] as typeof loadedAssistant)).toBe("Hello world!");
    expect(store.getState().timelineRows.map((row) => row.id)).toEqual([
      "message:loaded-user",
      "status:loaded-user",
      "message:replayed-assistant",
    ]);
  });

  it("renders only the latest assistant message in a turn", () => {
    const store = createAgentChatStore();
    const user = {
      role: "user" as const,
      id: "user-1",
      timestamp: 1_000,
      path: "project",
      content: [{ type: "text" as const, content: "Do work" }],
    };
    const firstAssistant = {
      ...assistantMessage("assistant-1"),
      timestamp: 2_000,
      content: [
        {
          type: "response" as const,
          response: [{ type: "text" as const, content: "First update" }],
        },
      ],
    };
    const secondAssistant = {
      ...assistantMessage("assistant-2"),
      timestamp: 3_000,
      content: [
        {
          type: "response" as const,
          response: [{ type: "text" as const, content: "Second update" }],
        },
      ],
    };

    store.getState().loadThread({
      id: "thread-1",
      title: "Thread",
      startPath: "project",
      lastPath: "project",
      createdAt: 1,
      updatedAt: 2,
      messageCount: 1,
      messages: [user, firstAssistant, secondAssistant],
      activities: [],
    });

    expect(store.getState().timelineRows.map((row) => row.id)).toEqual([
      "message:user-1",
      "status:user-1",
      "message:assistant-2",
    ]);
  });

  it("optimistically edits the latest user message and clears following conversation", () => {
    const store = createAgentChatStore();
    const user = {
      role: "user" as const,
      id: "user-1",
      timestamp: 1_000,
      path: "project",
      content: [{ type: "text" as const, content: "Original prompt" }],
    };
    const assistant = {
      ...assistantMessage("assistant-1"),
      timestamp: 2_000,
      content: [
        {
          type: "response" as const,
          response: [{ type: "text" as const, content: "Old answer" }],
        },
      ],
    };

    store.getState().loadThread({
      id: "thread-1",
      title: "Thread",
      startPath: "project",
      lastPath: "project",
      createdAt: 1,
      updatedAt: 2,
      messageCount: 1,
      messages: [user, assistant],
      activities: [{
        id: "activity-1",
        kind: "tool.completed",
        tone: "tool",
        status: "completed",
        title: "Command",
        createdAt: 1,
        sequence: 1,
      }],
    });

    store.getState().startEditedUserMessageRun({
      messageId: user.id,
      content: [{ type: "text", content: "Edited prompt" }],
      activeRun: {
        runId: null,
        threadId: "thread-1",
        startedAt: 3,
        optimisticUserMessageId: user.id,
      },
    });

    expect(store.getState().messageOrder).toEqual(["user-1"]);
    const editedMessage = store.getState().messagesById["user-1"];
    expect(editedMessage?.role).toBe("user");
    expect(editedMessage?.role === "user" ? getTextContent(editedMessage.content) : "").toBe("Edited prompt");
    expect(store.getState().messagesById["assistant-1"]).toBeUndefined();
    expect(store.getState().activityOrder).toEqual([]);
    expect(store.getState().timelineRows.map((row) => row.id)).toEqual([
      "message:user-1",
      "status:user-1",
    ]);
    expect(store.getState().activeRun?.optimisticUserMessageId).toBe("user-1");
  });

  it("projects tool lifecycle events into one stable activity row", () => {
    const store = createAgentChatStore();

    store.getState().applyRuntimeEvent(baseEvent("item.started", {
      item: toolItem(),
    }, 1));
    store.getState().applyRuntimeEvent(baseEvent("item.completed", {
      item: toolItem({ status: "completed", summary: "Tests passed" }),
    }, 2));

    expect(store.getState().activityOrder).toEqual(["activity:tool-1"]);
    expect(store.getState().activitiesById["activity:tool-1"]).toMatchObject({
      title: "Shell command",
      status: "completed",
      summary: "Tests passed",
      createdAt: 1_001,
    });
  });

  it("completes streamed assistant messages without replacing streamed text or message object", () => {
    const store = createAgentChatStore();
    const message = assistantMessage("assistant-1");

    store.getState().applyRuntimeEvent(baseEvent("turn.started", {}, 1));
    store.getState().applyRuntimeEvent(baseEvent("message.started", {
      messageId: message.id,
      messageType: "assistant",
      message,
    }, 2));
    store.getState().applyRuntimeEvent(baseEvent("content.delta", {
      messageId: message.id,
      contentIndex: 0,
      streamKind: "assistant_text",
      delta: "Streamed text",
    }, 3));
    const streamedMessage = store.getState().messagesById[message.id];
    store.getState().applyRuntimeEvent(baseEvent("message.completed", {
      messageId: message.id,
      messageType: "assistant",
      message: assistantMessage(message.id),
    }, 4));
    store.getState().applyRuntimeEvent(baseEvent("turn.completed", {
      status: "completed",
    }, 30));

    const projected = store.getState().messagesById[message.id];
    expect(projected?.role).toBe("assistant");
    expect(projected).toBe(streamedMessage);
    expect(getAssistantMarkdown(projected as typeof message)).toBe("Streamed text");
    expect((projected as typeof message).duration).toBe(0);
    expect(store.getState().streamingMessageIds).toEqual([]);
  });

  it("loads history messages, activities, and proposed plans into normalized maps", () => {
    const store = createAgentChatStore();
    const thread: AgentThread = {
      id: "thread-1",
      title: "Existing thread",
      startPath: "project",
      lastPath: "project",
      createdAt: 1,
      updatedAt: 2,
      messageCount: 1,
      messages: [assistantMessage("assistant-1")],
      activities: [{
        id: "activity-1",
        kind: "thinking",
        tone: "thinking",
        status: "completed",
        title: "Thinking",
        createdAt: 1,
      }],
      proposedPlans: [{
        id: "plan-1",
        content: "- Step one",
        status: "completed",
        createdAt: 1,
        updatedAt: 2,
      }],
    };

    store.getState().loadThread(thread);

    expect(store.getState().messageOrder).toEqual(["assistant-1"]);
    expect(store.getState().activityOrder).toEqual(["activity-1"]);
    expect(store.getState().proposedPlanOrder).toEqual(["plan-1"]);
  });

  it("updates the active thread summary from thread runtime events", () => {
    const store = createAgentChatStore();

    store.getState().applyRuntimeEvent(baseEvent("thread.updated", {
      thread: {
        id: "thread-1",
        title: "New title",
        startPath: "project",
        lastPath: "project/src",
        createdAt: 1,
        updatedAt: 3,
        messageCount: 2,
      },
    }, 1));

    expect(store.getState().threadSummary).toMatchObject({
      id: "thread-1",
      title: "New title",
      messageCount: 2,
    });
  });
});

describe("agent thread list store", () => {
  it("replaces groups and upserts streamed summaries", () => {
    const store = createAgentThreadListStore();

    store.getState().replaceGroups([{
      path: "project",
      threads: [{
        id: "thread-1",
        title: "Old title",
        startPath: "project",
        lastPath: "project",
        createdAt: 1,
        updatedAt: 2,
        messageCount: 1,
      }],
    }]);
    store.getState().upsertThread({
      id: "thread-1",
      title: "New title",
      startPath: "project",
      lastPath: "project",
      createdAt: 1,
      updatedAt: 4,
      messageCount: 2,
    });
    store.getState().upsertThread({
      id: "thread-2",
      title: "Another thread",
      startPath: "other",
      lastPath: "other",
      createdAt: 1,
      updatedAt: 3,
      messageCount: 1,
    });

    expect(store.getState().groups).toEqual([
      {
        path: "other",
        threads: [{
          id: "thread-2",
          title: "Another thread",
          startPath: "other",
          lastPath: "other",
          createdAt: 1,
          updatedAt: 3,
          messageCount: 1,
        }],
      },
      {
        path: "project",
        threads: [{
          id: "thread-1",
          title: "New title",
          startPath: "project",
          lastPath: "project",
          createdAt: 1,
          updatedAt: 4,
          messageCount: 2,
        }],
      },
    ]);
  });

  it("detects streaming threads from replaced groups", () => {
    const store = createAgentThreadListStore();

    expect(selectHasStreamingThreads(store.getState())).toBe(false);

    store.getState().replaceGroups([{
      path: "project",
      threads: [
        {
          id: "thread-1",
          title: "Idle thread",
          startPath: "project",
          lastPath: "project",
          createdAt: 1,
          updatedAt: 2,
          messageCount: 1,
        },
        {
          id: "thread-2",
          title: "Streaming thread",
          startPath: "project",
          lastPath: "project",
          createdAt: 1,
          updatedAt: 3,
          messageCount: 1,
          isStreaming: true,
        },
      ],
    }]);

    expect(selectHasStreamingThreads(store.getState())).toBe(true);

    store.getState().setThreadStreaming("thread-2", false);

    expect(selectHasStreamingThreads(store.getState())).toBe(false);
  });
});
