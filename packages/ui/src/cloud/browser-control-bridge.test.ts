import { describe, expect, it } from "vitest";

import { parseBrowserControlServerMessage } from "./browser-control-bridge";

describe("browser-control bridge protocol", () => {
  it("parses request attachment metadata", () => {
    expect(parseBrowserControlServerMessage(JSON.stringify({
      type: "request",
      requestId: "request-1",
      command: "tab.evaluate",
      params: { tabId: 123, expression: "location.href" },
      timeoutMs: 10000,
      attachments: [{
        id: "avatar",
        name: "avatar.png",
        mimeType: "image/png",
        size: 42,
      }],
    }))).toEqual({
      type: "request",
      requestId: "request-1",
      command: "tab.evaluate",
      params: { tabId: 123, expression: "location.href" },
      timeoutMs: 10000,
      attachments: [{
        id: "avatar",
        name: "avatar.png",
        mimeType: "image/png",
        size: 42,
      }],
    });
  });

  it("parses request output metadata", () => {
    expect(parseBrowserControlServerMessage(JSON.stringify({
      type: "request",
      requestId: "request-1",
      command: "tab.screenshot",
      params: { tabId: 123, outputId: "screenshot", format: "png" },
      outputs: [{
        id: "screenshot",
        mimeType: "image/png",
        maxBytes: 52428800,
      }],
    }))).toEqual({
      type: "request",
      requestId: "request-1",
      command: "tab.screenshot",
      params: { tabId: 123, outputId: "screenshot", format: "png" },
      timeoutMs: undefined,
      attachments: undefined,
      outputs: [{
        id: "screenshot",
        mimeType: "image/png",
        maxBytes: 52428800,
      }],
    });
  });

  it("parses attachment chunk and error frames", () => {
    expect(parseBrowserControlServerMessage(JSON.stringify({
      type: "attachment.chunk",
      requestId: "request-1",
      chunkRequestId: "chunk-1",
      attachmentId: "avatar",
      offset: 0,
      dataBase64: "aGVsbG8=",
      done: true,
    }))).toEqual({
      type: "attachment.chunk",
      requestId: "request-1",
      chunkRequestId: "chunk-1",
      attachmentId: "avatar",
      offset: 0,
      dataBase64: "aGVsbG8=",
      done: true,
    });

    expect(parseBrowserControlServerMessage(JSON.stringify({
      type: "attachment.error",
      requestId: "request-1",
      chunkRequestId: "chunk-1",
      attachmentId: "avatar",
      error: {
        code: "BROWSER_ATTACHMENT_CHANGED",
        message: "Attachment changed.",
      },
    }))).toEqual({
      type: "attachment.error",
      requestId: "request-1",
      chunkRequestId: "chunk-1",
      attachmentId: "avatar",
      error: {
        code: "BROWSER_ATTACHMENT_CHANGED",
        message: "Attachment changed.",
      },
    });
  });

  it("parses output ack and error frames", () => {
    expect(parseBrowserControlServerMessage(JSON.stringify({
      type: "output.ack",
      requestId: "request-1",
      writeRequestId: "write-1",
      outputId: "screenshot",
      offset: 0,
      bytesWritten: 42,
      done: true,
    }))).toEqual({
      type: "output.ack",
      requestId: "request-1",
      writeRequestId: "write-1",
      outputId: "screenshot",
      offset: 0,
      bytesWritten: 42,
      done: true,
    });

    expect(parseBrowserControlServerMessage(JSON.stringify({
      type: "output.error",
      requestId: "request-1",
      writeRequestId: "write-1",
      outputId: "screenshot",
      error: {
        code: "BROWSER_OUTPUT_TOO_LARGE",
        message: "Too large.",
      },
    }))).toEqual({
      type: "output.error",
      requestId: "request-1",
      writeRequestId: "write-1",
      outputId: "screenshot",
      error: {
        code: "BROWSER_OUTPUT_TOO_LARGE",
        message: "Too large.",
      },
    });
  });
});
