import { describe, expect, it } from "vitest";

import {
  parseBrowserControlServerMessage,
  shouldReconnectBrowserControlWebsocket,
} from "../../src/cloud/browser-control-bridge";

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

  it("parses heartbeat pong frames", () => {
    expect(parseBrowserControlServerMessage(JSON.stringify({
      type: "pong",
      requestId: "heartbeat-1",
      serverTime: "2026-05-26T10:00:00.000Z",
    }))).toEqual({
      type: "pong",
      requestId: "heartbeat-1",
      serverTime: "2026-05-26T10:00:00.000Z",
    });
  });
});

describe("browser-control bridge reconnects", () => {
  it("reconnects after an abnormal websocket close", () => {
    expect(shouldReconnectBrowserControlWebsocket({
      closeCode: 1006,
      isCancelled: false,
    })).toBe(true);
  });

  it("reconnects after a remote normal websocket close", () => {
    expect(shouldReconnectBrowserControlWebsocket({
      closeCode: 1000,
      isCancelled: false,
    })).toBe(true);
  });

  it("does not reconnect after the bridge unmounts", () => {
    expect(shouldReconnectBrowserControlWebsocket({
      closeCode: 1000,
      isCancelled: true,
    })).toBe(false);
  });

  it("does not reconnect after a protocol error", () => {
    expect(shouldReconnectBrowserControlWebsocket({
      closeCode: 1003,
      isCancelled: false,
    })).toBe(false);
  });
});
