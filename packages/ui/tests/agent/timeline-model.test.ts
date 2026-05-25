import { describe, expect, it } from "vitest";

import { computeStableRows, deriveTimelineRows, type StableRowsState } from "../../src/agent/timeline-model";
import type { AgentMessage } from "../../src/agent/types";

const userMessage: AgentMessage = {
  role: "user",
  id: "user-1",
  timestamp: 1_000,
  path: "packages/ui",
  content: [{ type: "text", content: "Please inspect this" }],
};

const assistantMessage: AgentMessage = {
  role: "assistant",
  id: "assistant-1",
  timestamp: 3_000,
  duration: 1_000,
  stopReason: "stop",
  content: [
    {
      type: "response",
      response: [{ type: "text", content: "Done." }],
    },
  ],
};

describe("timeline model", () => {
  it("places a stable status row directly after user messages", () => {
    const rows = deriveTimelineRows({
      messages: [userMessage, assistantMessage],
      isWorking: false,
    });

    expect(rows.map((row) => row.kind)).toEqual(["message", "status", "message"]);
    expect(rows[1]).toMatchObject({
      kind: "status",
      state: "worked",
      id: "status:user-1",
    });
  });

  it("marks only the latest user status as working", () => {
    const secondUser: AgentMessage = {
      ...userMessage,
      id: "user-2",
      timestamp: 4_000,
      content: [{ type: "text", content: "Now do this" }],
    };
    const rows = deriveTimelineRows({
      messages: [userMessage, assistantMessage, secondUser],
      isWorking: true,
    });

    expect(rows.filter((row) => row.kind === "status").map((row) => row.state)).toEqual(["worked", "working"]);
  });

  it("shows only the latest assistant message for a user turn", () => {
    const firstAssistant: AgentMessage = {
      ...assistantMessage,
      id: "assistant-older",
      content: [
        {
          type: "response" as const,
          response: [{ type: "text" as const, content: "Older commentary." }],
        },
      ],
    };
    const latestAssistant: AgentMessage = {
      ...assistantMessage,
      id: "assistant-latest",
      content: [
        {
          type: "response" as const,
          response: [{ type: "text" as const, content: "Latest commentary." }],
        },
      ],
    };
    const rows = deriveTimelineRows({
      messages: [userMessage, firstAssistant, latestAssistant],
      isWorking: true,
    });

    expect(rows.map((row) => row.id)).toEqual(["message:user-1", "status:user-1", "message:assistant-latest"]);
  });

  it("reuses assistant row objects when only the run status changes", () => {
    const rows = deriveTimelineRows({
      messages: [userMessage, assistantMessage],
      isWorking: true,
    });
    const initial: StableRowsState = { byId: new Map(), result: [] };
    const projected = computeStableRows(rows, initial);
    const recomputedRows = deriveTimelineRows({
      messages: [userMessage, assistantMessage],
      isWorking: false,
    });
    const next = computeStableRows(recomputedRows, projected);

    expect(next.result).not.toBe(projected.result);
    expect(next.result[0]).toBe(projected.result[0]);
    expect(next.result[1]).not.toBe(projected.result[1]);
    expect(next.result[2]).toBe(projected.result[2]);
  });

  it("keeps assistant rows stable when completion only changes hidden metadata", () => {
    const initialRows = deriveTimelineRows({
      messages: [userMessage, { ...assistantMessage, duration: 0, stopReason: "stop" }],
      isWorking: true,
    });
    const projected = computeStableRows(initialRows, { byId: new Map(), result: [] });
    const rows = deriveTimelineRows({
      messages: [userMessage, { ...assistantMessage, duration: 2_000, stopReason: "stop" }],
      isWorking: false,
    });
    const next = computeStableRows(rows, projected);

    expect(next.result[2]).toBe(projected.result[2]);
  });
});
