import { describe, expect, it } from "vitest";

import { AgentError } from "../src/agent/errors.js";
import { MockAgentHarness } from "../src/agent/mock-harness.js";
import type { AgentContent, AgentRunEvent } from "../src/agent/types.js";

describe("mock agent harness", () => {
  it("can seed previous threads for UI development", async () => {
    const harness = new MockAgentHarness({ seedThreads: true });
    const result = await harness.retrieveThreads({});

    expect(result.groups.length).toBeGreaterThan(0);
    expect(result.groups.some((group) => group.threads.length > 0)).toBe(true);
    expect(result.groups.flatMap((group) => group.threads).map((thread) => thread.title)).toContain(
      "Plan the chat surface",
    );
  });

  it("creates a thread, emits user and assistant messages, and stores the conversation", async () => {
    const harness = new MockAgentHarness();
    const events = await collectEvents(harness.sendMessage({
      path: "Projects/app",
      content: textContent("Please help me"),
    }));

    const threadCreated = events.find((event) => event.type === "thread.created");
    expect(threadCreated).toBeDefined();
    expect(events.map((event) => event.type)).toEqual([
      "thread.created",
      "turn.started",
      "message.started",
      "message.completed",
      "item.started",
      "item.completed",
      "message.started",
      "content.delta",
      "message.completed",
      "turn.completed",
      "thread.updated",
    ]);

    const thread = await harness.getThread({ threadId: events[0]?.threadId ?? "" });
    expect(thread).toMatchObject({
      title: "Please help me",
      startPath: "Projects/app",
      lastPath: "Projects/app",
      messageCount: 2,
      messages: [
        { role: "user", path: "Projects/app" },
        {
          role: "assistant",
          content: [{ type: "response", response: [{ type: "text", content: "Mock response..." }] }],
        },
      ],
    });
  });

  it("groups threads by start path and sorts groups by latest thread", async () => {
    const harness = new MockAgentHarness();
    await collectEvents(harness.sendMessage({ path: "Alpha", content: textContent("Old alpha") }));
    await sleep(2);
    await collectEvents(harness.sendMessage({ path: "Alpha", content: textContent("New alpha") }));
    await sleep(2);
    await collectEvents(harness.sendMessage({ path: "Zed", content: textContent("Z thread") }));

    const result = await harness.retrieveThreads({});

    expect(result.groups.map((group) => group.path)).toEqual(["Zed", "Alpha"]);
    expect(result.groups[1]?.threads.map((thread) => thread.title)).toEqual(["New alpha", "Old alpha"]);
  });

  it("appends to existing threads and updates lastPath", async () => {
    const harness = new MockAgentHarness();
    const firstEvents = await collectEvents(harness.sendMessage({
      path: "Projects",
      content: textContent("Start here"),
    }));
    const threadId = firstEvents[0]?.threadId ?? "";

    await collectEvents(harness.sendMessage({
      threadId,
      path: "Projects/src",
      content: textContent("Now here"),
    }));

    const thread = await harness.getThread({ threadId });

    expect(thread).toMatchObject({
      startPath: "Projects",
      lastPath: "Projects/src",
      messageCount: 4,
    });
  });

  it("throws THREAD_NOT_FOUND for missing threads", async () => {
    const harness = new MockAgentHarness();

    await expect(harness.getThread({ threadId: "missing" })).rejects.toMatchObject({
      code: "THREAD_NOT_FOUND",
    } satisfies Partial<AgentError>);
  });
});

const textContent = (content: string): AgentContent => [{ type: "text", content }];

const collectEvents = async (events: AsyncIterable<AgentRunEvent>): Promise<AgentRunEvent[]> => {
  const collected: AgentRunEvent[] = [];

  for await (const event of events) {
    collected.push(event);
  }

  return collected;
};

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
