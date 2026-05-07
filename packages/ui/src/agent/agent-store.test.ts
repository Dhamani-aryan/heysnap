import { describe, expect, it } from "vitest";

import { createAgentChatStore, getAssistantMarkdown } from "./agent-store";
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
});
