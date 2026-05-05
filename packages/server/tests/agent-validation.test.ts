import { describe, expect, it } from "vitest";

import { AgentError } from "../src/agent/errors.js";
import { isAgentContent, parseAgentClientMessage } from "../src/agent/validation.js";

describe("agent validation", () => {
  it("accepts text, image, and file content blocks", () => {
    expect(isAgentContent([
      { type: "text", content: "hello", metadata: { source: "test" } },
      { type: "image", data: "base64-image", mimeType: "image/png" },
      { type: "file", data: "base64-file", mimeType: "text/plain", filename: "note.txt" },
    ])).toBe(true);
  });

  it("rejects sendMessage payloads without AgentContent arrays", () => {
    expect(() => parseAgentClientMessage(JSON.stringify({
      type: "sendMessage",
      requestId: "bad-1",
      path: "",
      content: "hello",
    }))).toThrow(AgentError);
  });

  it("rejects invalid content blocks", () => {
    expect(isAgentContent([
      { type: "text" },
      { type: "image", data: "base64-image" },
      { type: "file", data: "base64-file", mimeType: "text/plain" },
    ])).toBe(false);
  });

  it("parses valid client messages", () => {
    expect(parseAgentClientMessage(JSON.stringify({
      type: "sendMessage",
      requestId: "send-1",
      path: "Projects",
      content: [{ type: "text", content: "Build this" }],
    }))).toMatchObject({
      type: "sendMessage",
      requestId: "send-1",
      path: "Projects",
    });
  });
});
