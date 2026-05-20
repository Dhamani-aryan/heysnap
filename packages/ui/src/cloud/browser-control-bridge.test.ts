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
});
