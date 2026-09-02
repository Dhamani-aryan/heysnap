import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import {
  attachBrowserControlWebSocketServer,
  createBrowserControlService,
} from "../src/browser-control/service.js";

const servers: Server[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("browser-control service", () => {
  it("responds to browser-control heartbeat pings", async () => {
    const { baseUrl } = await startBrowserControlServer();
    const client = await openBrowserControlClient(baseUrl, "user-1");

    client.send(JSON.stringify({ type: "ping", requestId: "heartbeat-1" }));

    const response = await waitForJsonMessage<{ readonly type: string; readonly requestId: string; readonly serverTime: string }>(client);
    expect(response).toMatchObject({
      type: "pong",
      requestId: "heartbeat-1",
      serverTime: expect.any(String),
    });

    client.close();
  });

  it("routes CLI requests to the connected target user client", async () => {
    const { baseUrl } = await startBrowserControlServer();
    const client = await openBrowserControlClient(baseUrl, "user-1");
    client.send(JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      clientId: "client-1",
      capabilities: ["browser.navigate"],
    }));

    const responsePromise = fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "user-1",
        command: "tab.goTo",
        params: { tabId: 123, url: "https://example.com" },
      }),
    });
    const request = await waitForJsonMessage<BrowserControlRequestMessage>(client);

    expect(request).toMatchObject({
      type: "request",
      command: "tab.goTo",
      params: { tabId: 123, url: "https://example.com" },
    });

    client.send(JSON.stringify({
      type: "response",
      requestId: request.requestId,
      ok: true,
      result: { url: "https://example.com" },
    }));

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: { url: "https://example.com" },
    });

    client.close();
  });

  it("normalizes browser command request shapes before sending them to the client", async () => {
    const { baseUrl } = await startBrowserControlServer();
    const client = await openBrowserControlClient(baseUrl, "user-1");
    client.send(JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      clientId: "client-1",
      capabilities: ["browser-control.v1"],
    }));

    const responsePromise = fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "user-1",
        command: "createNewTab",
        params: {
          url: "https://example.com",
          active: true,
          waitForLoad: { timeoutMs: 5000, waitUntil: "complete" },
        },
      }),
    });
    const request = await waitForJsonMessage<BrowserControlRequestMessage>(client);

    expect(request).toMatchObject({
      type: "request",
      command: "createNewTab",
      params: {
        tabs: [{ url: "https://example.com", active: true }],
        waitForLoad: { timeoutMs: 5000, waitUntil: "complete" },
      },
    });

    client.send(JSON.stringify({
      type: "response",
      requestId: request.requestId,
      ok: true,
      result: { tabIds: [456] },
    }));

    expect(await (await responsePromise).json()).toEqual({
      ok: true,
      result: { tabIds: [456] },
    });

    client.close();
  });

  it("accepts navigation wait options and tab evaluate requests", async () => {
    const { baseUrl } = await startBrowserControlServer();
    const client = await openBrowserControlClient(baseUrl, "user-1");
    client.send(JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      clientId: "client-1",
      capabilities: ["browser-control.v1"],
    }));

    const navigateResponsePromise = fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "user-1",
        command: "tab.goTo",
        params: {
          tabId: 123,
          url: "https://example.com",
          waitForLoad: { timeoutMs: 5000, waitUntil: "networkIdle" },
        },
      }),
    });
    const navigateRequest = await waitForJsonMessage<BrowserControlRequestMessage>(client);

    expect(navigateRequest).toMatchObject({
      type: "request",
      command: "tab.goTo",
      params: {
        tabId: 123,
        url: "https://example.com",
        waitForLoad: { timeoutMs: 5000, waitUntil: "networkIdle" },
      },
    });

    client.send(JSON.stringify({
      type: "response",
      requestId: navigateRequest.requestId,
      ok: true,
      result: { navigated: true },
    }));
    expect(await (await navigateResponsePromise).json()).toEqual({
      ok: true,
      result: { navigated: true },
    });

    const evaluateResponsePromise = fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "user-1",
        command: "tab.evaluate",
        params: {
          tabId: 123,
          expression: "location.href",
          awaitPromise: true,
          returnByValue: true,
          timeoutMs: 1000,
        },
      }),
    });
    const evaluateRequest = await waitForJsonMessage<BrowserControlRequestMessage>(client);

    expect(evaluateRequest).toMatchObject({
      type: "request",
      command: "tab.evaluate",
      params: {
        tabId: 123,
        expression: "location.href",
        awaitPromise: true,
        returnByValue: true,
        timeoutMs: 1000,
      },
    });

    client.send(JSON.stringify({
      type: "response",
      requestId: evaluateRequest.requestId,
      ok: true,
      result: { ok: true, result: "https://example.com/" },
    }));
    expect(await (await evaluateResponsePromise).json()).toEqual({
      ok: true,
      result: { ok: true, result: "https://example.com/" },
    });

    client.close();
  });

  it("routes CLI requests to the latest connected client when no target user is provided", async () => {
    const { baseUrl } = await startBrowserControlServer();
    const first = await openBrowserControlClient(baseUrl, "user-1");
    first.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "first", capabilities: [] }));
    await delay(5);
    const second = await openBrowserControlClient(baseUrl, "user-2");
    second.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "second", capabilities: [] }));

    const responsePromise = fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "getTabs",
        params: {},
      }),
    });
    const request = await waitForJsonMessage<BrowserControlRequestMessage>(second);

    second.send(JSON.stringify({
      type: "response",
      requestId: request.requestId,
      ok: true,
      result: { client: "second" },
    }));

    expect(await (await responsePromise).json()).toEqual({
      ok: true,
      result: { client: "second" },
    });

    first.close();
    second.close();
  });


  it("routes to the latest active client for a user", async () => {
    const { baseUrl } = await startBrowserControlServer();
    const first = await openBrowserControlClient(baseUrl, "user-1");
    first.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "first", capabilities: [] }));
    await delay(5);
    const second = await openBrowserControlClient(baseUrl, "user-1");
    second.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "second", capabilities: [] }));

    const responsePromise = fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "user-1",
        command: "tab.cdp",
        params: { tabId: 123, method: "Page.captureScreenshot" },
      }),
    });
    const request = await waitForJsonMessage<BrowserControlRequestMessage>(second);

    second.send(JSON.stringify({
      type: "response",
      requestId: request.requestId,
      ok: true,
      result: { client: "second" },
    }));

    expect(await (await responsePromise).json()).toEqual({
      ok: true,
      result: { client: "second" },
    });

    first.close();
    second.close();
  });

  it("forwards browser-control attachment metadata and serves request-scoped chunks", async () => {
    const root = await createTempRoot();
    await writeFile(join(root, "avatar.png"), Buffer.from("hello-browser-file", "utf8"));
    const { baseUrl } = await startBrowserControlServer({ filesystemRootPath: root });
    const client = await openBrowserControlClient(baseUrl, "user-1");
    client.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "client-1", capabilities: [] }));

    const responsePromise = fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "user-1",
        command: "tab.evaluate",
        params: { tabId: 123, expression: "location.href" },
        attachments: [{
          id: "avatar",
          path: "avatar.png",
          mimeType: "image/png",
        }],
      }),
    });
    const request = await waitForJsonMessage<BrowserControlRequestMessage>(client);

    expect(request).toMatchObject({
      type: "request",
      command: "tab.evaluate",
      attachments: [{
        id: "avatar",
        name: "avatar.png",
        mimeType: "image/png",
        size: Buffer.byteLength("hello-browser-file"),
      }],
    });

    client.send(JSON.stringify({
      type: "attachment.read",
      requestId: request.requestId,
      chunkRequestId: "chunk-1",
      attachmentId: "avatar",
      offset: 0,
      length: 5,
    }));
    const chunk = await waitForJsonMessage<BrowserControlAttachmentChunkMessage>(client);

    expect(chunk).toEqual({
      type: "attachment.chunk",
      requestId: request.requestId,
      chunkRequestId: "chunk-1",
      attachmentId: "avatar",
      offset: 0,
      dataBase64: Buffer.from("hello", "utf8").toString("base64"),
      done: false,
    });

    client.send(JSON.stringify({
      type: "response",
      requestId: request.requestId,
      ok: true,
      result: { hydrated: true },
    }));

    expect(await (await responsePromise).json()).toEqual({
      ok: true,
      result: { hydrated: true },
    });

    client.close();
  });

  it("rejects invalid browser-control attachment requests", async () => {
    const root = await createTempRoot();
    await mkdir(join(root, "folder"));
    await writeFile(join(root, "file.txt"), "hello");
    await writeFile(join(root, "large.bin"), "");
    await truncate(join(root, "large.bin"), (50 * 1024 * 1024) + 1);
    const { baseUrl } = await startBrowserControlServer({ filesystemRootPath: root });

    await expectInvalidAttachmentRequest(baseUrl, [{
      id: "outside",
      path: "../outside.txt",
    }], "Path cannot contain parent directory segments");

    await expectInvalidAttachmentRequest(baseUrl, [{
      id: "missing",
      path: "missing.txt",
    }], "was not found");

    await expectInvalidAttachmentRequest(baseUrl, [{
      id: "directory",
      path: "folder",
    }], "must point to a file");

    await expectInvalidAttachmentRequest(baseUrl, [
      { id: "same", path: "file.txt" },
      { id: "same", path: "file.txt" },
    ], "duplicate id");

    await expectInvalidAttachmentRequest(baseUrl, [{
      id: "large",
      path: "large.bin",
    }], "per-file limit");
  });

  it("rejects attachment chunks after the browser-control request completes", async () => {
    const root = await createTempRoot();
    await writeFile(join(root, "file.txt"), "hello");
    const { baseUrl } = await startBrowserControlServer({ filesystemRootPath: root });
    const client = await openBrowserControlClient(baseUrl, "user-1");
    client.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "client-1", capabilities: [] }));

    const responsePromise = fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "user-1",
        command: "tab.evaluate",
        params: { tabId: 123, expression: "location.href" },
        attachments: [{ id: "file", path: "file.txt" }],
      }),
    });
    const request = await waitForJsonMessage<BrowserControlRequestMessage>(client);

    client.send(JSON.stringify({
      type: "response",
      requestId: request.requestId,
      ok: true,
      result: { ok: true },
    }));
    expect(await (await responsePromise).json()).toEqual({
      ok: true,
      result: { ok: true },
    });

    client.send(JSON.stringify({
      type: "attachment.read",
      requestId: request.requestId,
      chunkRequestId: "late-chunk",
      attachmentId: "file",
      offset: 0,
      length: 5,
    }));

    expect(await waitForJsonMessage<BrowserControlAttachmentErrorMessage>(client)).toMatchObject({
      type: "attachment.error",
      requestId: request.requestId,
      chunkRequestId: "late-chunk",
      attachmentId: "file",
      error: { code: "BROWSER_ATTACHMENT_REQUEST_NOT_FOUND" },
    });

    client.close();
  });

  it("forwards screenshot capture params and writes streamed output atomically", async () => {
    const root = await createTempRoot();
    const { baseUrl } = await startBrowserControlServer({ filesystemRootPath: root });
    const client = await openBrowserControlClient(baseUrl, "user-1");
    client.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "client-1", capabilities: [] }));

    const responsePromise = fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "user-1",
        command: "tab.screenshot",
        params: {
          tabId: 123,
          path: "screenshots/page.png",
          captureMode: "viewport",
          fromSurface: true,
        },
      }),
    });
    const request = await waitForJsonMessage<BrowserControlRequestMessage>(client);

    expect(request).toMatchObject({
      type: "request",
      command: "tab.screenshot",
      params: {
        tabId: 123,
        outputId: "screenshot",
        captureMode: "viewport",
        format: "png",
        fromSurface: true,
      },
      outputs: [{
        id: "screenshot",
        mimeType: "image/png",
        maxBytes: 50 * 1024 * 1024,
      }],
    });
    expect(JSON.stringify(request.params)).not.toContain("screenshots/page.png");

    const bytes = Buffer.from("fake-png-bytes", "utf8");
    client.send(JSON.stringify({
      type: "output.write",
      requestId: request.requestId,
      writeRequestId: "write-1",
      outputId: "screenshot",
      offset: 0,
      dataBase64: bytes.toString("base64"),
      done: true,
    }));
    expect(await waitForJsonMessage<BrowserControlOutputAckMessage>(client)).toMatchObject({
      type: "output.ack",
      requestId: request.requestId,
      writeRequestId: "write-1",
      outputId: "screenshot",
      offset: 0,
      bytesWritten: bytes.byteLength,
      done: true,
    });

    client.send(JSON.stringify({
      type: "response",
      requestId: request.requestId,
      ok: true,
      result: { tabId: 123, size: bytes.byteLength },
    }));

    expect(await (await responsePromise).json()).toEqual({
      ok: true,
      result: {
        tabId: 123,
        path: "screenshots/page.png",
        format: "png",
        mimeType: "image/png",
        size: bytes.byteLength,
        overwritten: false,
      },
    });
    expect(await readFile(join(root, "screenshots/page.png"), "utf8")).toBe("fake-png-bytes");

    client.close();
  });

  it("forwards tab.evaluate downloadable outputs and writes streamed files atomically", async () => {
    const root = await createTempRoot();
    const { baseUrl } = await startBrowserControlServer({ filesystemRootPath: root });
    const client = await openBrowserControlClient(baseUrl, "user-1");
    client.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "client-1", capabilities: [] }));

    const responsePromise = fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "user-1",
        command: "tab.evaluate",
        params: {
          tabId: 123,
          expression: "await window.__heysnapDownloads.save('export', 'hello')",
        },
        outputs: [{
          id: "export",
          path: "downloads/export.txt",
          mimeType: "text/plain",
        }],
      }),
    });
    const request = await waitForJsonMessage<BrowserControlRequestMessage>(client);

    expect(request).toMatchObject({
      type: "request",
      command: "tab.evaluate",
      params: {
        tabId: 123,
        expression: "await window.__heysnapDownloads.save('export', 'hello')",
      },
      outputs: [{
        id: "export",
        mimeType: "text/plain",
        maxBytes: 100 * 1024 * 1024,
      }],
    });
    expect(JSON.stringify(request.outputs)).not.toContain("downloads/export.txt");

    const bytes = Buffer.from("downloaded bytes", "utf8");
    client.send(JSON.stringify({
      type: "output.write",
      requestId: request.requestId,
      writeRequestId: "write-download",
      outputId: "export",
      offset: 0,
      dataBase64: bytes.toString("base64"),
      done: true,
    }));
    expect(await waitForJsonMessage<BrowserControlOutputAckMessage>(client)).toMatchObject({
      type: "output.ack",
      requestId: request.requestId,
      writeRequestId: "write-download",
      outputId: "export",
      offset: 0,
      bytesWritten: bytes.byteLength,
      done: true,
    });

    client.send(JSON.stringify({
      type: "response",
      requestId: request.requestId,
      ok: true,
      result: { ok: true, result: { saved: true } },
    }));

    expect(await (await responsePromise).json()).toEqual({
      ok: true,
      result: {
        evaluation: { ok: true, result: { saved: true } },
        outputs: [{
          id: "export",
          path: "downloads/export.txt",
          mimeType: "text/plain",
          size: bytes.byteLength,
          overwritten: false,
        }],
      },
    });
    expect(await readFile(join(root, "downloads/export.txt"), "utf8")).toBe("downloaded bytes");

    client.close();
  });

  it("rejects invalid downloadable output requests", async () => {
    const root = await createTempRoot();
    await mkdir(join(root, "folder"));
    await writeFile(join(root, "exists.txt"), "old");
    await writeFile(join(root, "target.txt"), "target");
    await symlink(join(root, "target.txt"), join(root, "link.txt"));
    const { baseUrl } = await startBrowserControlServer({ filesystemRootPath: root });

    await expectInvalidOutputRequest(baseUrl, [{
      id: "outside",
      path: "../outside.txt",
    }], "Path cannot contain parent directory segments");

    await expectInvalidOutputRequest(baseUrl, [
      { id: "same", path: "one.txt" },
      { id: "same", path: "two.txt" },
    ], "duplicate id");

    await expectInvalidOutputRequest(baseUrl, [{
      id: "directory",
      path: "folder",
    }], "must point to a file path");

    await expectInvalidOutputRequest(baseUrl, [{
      id: "exists",
      path: "exists.txt",
    }], "already exists");

    await expectInvalidOutputRequest(baseUrl, [{
      id: "symlink",
      path: "link.txt",
      overwrite: true,
    }], "cannot point to a symlink");

    await expectInvalidOutputRequest(baseUrl, [{
      id: "large",
      path: "large.bin",
      maxBytes: (100 * 1024 * 1024) + 1,
    }], "maxBytes cannot exceed");

    await expectInvalidOutputRequest(baseUrl, [{
      id: "wrong-command",
      path: "tabs.txt",
    }], "outputs are only supported for tab.evaluate", "getTabs", {});
  });

  it("rejects invalid screenshot requests and late output writes", async () => {
    const root = await createTempRoot();
    await mkdir(join(root, "folder"));
    await writeFile(join(root, "exists.png"), "old");
    const { baseUrl } = await startBrowserControlServer({ filesystemRootPath: root });

    await expectInvalidScreenshotRequest(baseUrl, {
      tabId: 123,
      path: "../outside.png",
    }, "Path cannot contain parent directory segments");

    await expectInvalidScreenshotRequest(baseUrl, {
      tabId: 123,
      path: "exists.png",
    }, "already exists");

    await expectInvalidScreenshotRequest(baseUrl, {
      tabId: 123,
      path: "folder",
    }, "must point to a file path");

    await expectInvalidScreenshotRequest(baseUrl, {
      tabId: 123,
      path: "image.png",
      format: "jpeg",
    }, "format must match");

    await expectInvalidScreenshotRequest(baseUrl, {
      tabId: 123,
      path: "image.jpeg",
      quality: 101,
    }, "quality must be between");

    await expectInvalidScreenshotRequest(baseUrl, {
      tabId: 123,
      path: "image.png",
      captureMode: "clip",
    }, "clip is required");

    const client = await openBrowserControlClient(baseUrl, "user-1");
    client.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "client-1", capabilities: [] }));
    const responsePromise = fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "user-1",
        command: "tab.screenshot",
        params: { tabId: 123, path: "late.png" },
      }),
    });
    const request = await waitForJsonMessage<BrowserControlRequestMessage>(client);

    client.send(JSON.stringify({
      type: "response",
      requestId: request.requestId,
      ok: false,
      error: { code: "BROWSER_EXECUTOR_ERROR", message: "capture failed" },
    }));
    expect(await (await responsePromise).json()).toMatchObject({
      ok: false,
      error: { code: "BROWSER_EXECUTOR_ERROR" },
    });

    client.send(JSON.stringify({
      type: "output.write",
      requestId: request.requestId,
      writeRequestId: "late-write",
      outputId: "screenshot",
      offset: 0,
      dataBase64: Buffer.from("late").toString("base64"),
      done: true,
    }));
    expect(await waitForJsonMessage<BrowserControlOutputErrorMessage>(client)).toMatchObject({
      type: "output.error",
      requestId: request.requestId,
      writeRequestId: "late-write",
      outputId: "screenshot",
      error: { code: "BROWSER_OUTPUT_REQUEST_NOT_FOUND" },
    });

    client.close();
  });

  it("returns stable errors when no client is connected or a client times out", async () => {
    const { baseUrl } = await startBrowserControlServer();

    const unavailable = await fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "missing-user",
        command: "tab.goTo",
        params: { tabId: 123, url: "https://example.com" },
      }),
    });

    expect(await unavailable.json()).toMatchObject({
      ok: false,
      error: {
        code: "CHROME_NOT_CONNECTED",
        message: expect.stringContaining("Chrome is not connected"),
      },
    });

    const client = await openBrowserControlClient(baseUrl, "user-1");
    client.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "client-1", capabilities: [] }));

    const timeout = await fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "user-1",
        command: "tab.refresh",
        params: { tabId: 123 },
        timeoutMs: 10,
      }),
    });

    expect(await timeout.json()).toMatchObject({
      ok: false,
      error: { code: "BROWSER_CONTROL_TIMEOUT" },
    });

    client.close();
  });

  it("waits for a reconnecting browser-control client before failing a request", async () => {
    const { baseUrl } = await startBrowserControlServer({ noClientRetryDelaysMs: [20, 20] });

    const responsePromise = fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "user-1",
        command: "tab.refresh",
        params: { tabId: 123 },
      }),
    });

    await delay(1);
    const client = await openBrowserControlClient(baseUrl, "user-1");
    client.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "client-1", capabilities: [] }));

    const request = await waitForJsonMessage<BrowserControlRequestMessage>(client);
    expect(request).toMatchObject({
      type: "request",
      command: "tab.refresh",
      params: { tabId: 123 },
    });

    client.send(JSON.stringify({
      type: "response",
      requestId: request.requestId,
      ok: true,
      result: { refreshed: true },
    }));

    expect(await (await responsePromise).json()).toEqual({
      ok: true,
      result: { refreshed: true },
    });

    client.close();
  });

  it("rejects unsupported browser commands and invalid command params", async () => {
    const { baseUrl } = await startBrowserControlServer();

    const unsupported = await fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "browser.navigate",
        params: { url: "https://example.com" },
      }),
    });

    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: expect.stringContaining("Unsupported browser-control command"),
      },
    });

    const invalidParams = await fetch(`${baseUrl}/browser-control/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "tab.goTo",
        params: { url: "https://example.com" },
      }),
    });

    expect(invalidParams.status).toBe(400);
    expect(await invalidParams.json()).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: expect.stringContaining("tab.goTo.params.tabId"),
      },
    });
  });

  it("reports browser-control status for a user", async () => {
    const { baseUrl } = await startBrowserControlServer();
    const client = await openBrowserControlClient(baseUrl, "user-1");
    client.send(JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      clientId: "client-1",
      capabilities: ["browser.screenshot"],
    }));
    await delay(10);

    const response = await fetch(`${baseUrl}/browser-control/status`);

    expect(await response.json()).toMatchObject({
      status: {
        connected: true,
        clientId: "client-1",
        capabilities: ["browser.screenshot"],
        lastSeenAt: expect.any(String),
      },
    });

    client.close();
  });
});

interface BrowserControlRequestMessage {
  readonly type: "request";
  readonly requestId: string;
  readonly command: string;
  readonly params?: unknown;
  readonly attachments?: unknown;
  readonly outputs?: unknown;
}

interface BrowserControlAttachmentChunkMessage {
  readonly type: "attachment.chunk";
  readonly requestId: string;
  readonly chunkRequestId: string;
  readonly attachmentId: string;
  readonly offset: number;
  readonly dataBase64: string;
  readonly done: boolean;
}

interface BrowserControlAttachmentErrorMessage {
  readonly type: "attachment.error";
  readonly requestId: string;
  readonly chunkRequestId: string;
  readonly attachmentId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

interface BrowserControlOutputAckMessage {
  readonly type: "output.ack";
  readonly requestId: string;
  readonly writeRequestId: string;
  readonly outputId: string;
  readonly offset: number;
  readonly bytesWritten: number;
  readonly done: boolean;
}

interface BrowserControlOutputErrorMessage {
  readonly type: "output.error";
  readonly requestId: string;
  readonly writeRequestId: string;
  readonly outputId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

const startBrowserControlServer = async (options: {
  readonly filesystemRootPath?: string;
  readonly noClientRetryDelaysMs?: readonly number[];
} = {}): Promise<{
  readonly server: Server;
  readonly baseUrl: string;
}> => {
  const service = createBrowserControlService({
    noClientRetryDelaysMs: [],
    ...options,
  });
  const server = createServer((request, response) => {
    void service.handleRequest(request, response).then((handled) => {
      if (!handled) {
        response.writeHead(404);
        response.end();
      }
    });
  });
  attachBrowserControlWebSocketServer(server, service);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return { server, baseUrl: `http://127.0.0.1:${String(address.port)}` };
};

const createTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ank1015-browser-control-"));
  tempDirectories.push(root);
  return root;
};

const expectInvalidAttachmentRequest = async (
  baseUrl: string,
  attachments: unknown,
  expectedMessage: string,
): Promise<void> => {
  const response = await fetch(`${baseUrl}/browser-control/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "tab.evaluate",
      params: { tabId: 123, expression: "location.href" },
      attachments,
    }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    ok: false,
    error: {
      code: "INVALID_REQUEST",
      message: expect.stringContaining(expectedMessage),
    },
  });
};

const expectInvalidScreenshotRequest = async (
  baseUrl: string,
  params: unknown,
  expectedMessage: string,
): Promise<void> => {
  const response = await fetch(`${baseUrl}/browser-control/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "tab.screenshot",
      params,
    }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    ok: false,
    error: {
      code: "INVALID_REQUEST",
      message: expect.stringContaining(expectedMessage),
    },
  });
};

const expectInvalidOutputRequest = async (
  baseUrl: string,
  outputs: unknown,
  expectedMessage: string,
  command = "tab.evaluate",
  params: unknown = { tabId: 123, expression: "location.href" },
): Promise<void> => {
  const response = await fetch(`${baseUrl}/browser-control/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command,
      params,
      outputs,
    }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    ok: false,
    error: {
      code: "INVALID_REQUEST",
      message: expect.stringContaining(expectedMessage),
    },
  });
};

const openBrowserControlClient = (baseUrl: string, userId: string): Promise<WebSocket> =>
  openWebSocket(baseUrl.replace(/^http/, "ws") + "/browser-control", {
    "x-heysnap-user-id": userId,
    "x-heysnap-access-session-id": "access-session",
  });

const openWebSocket = (
  url: string,
  headers: Record<string, string>,
): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const webSocket = new WebSocket(url, { headers });
    webSocket.once("open", () => resolve(webSocket));
    webSocket.once("error", reject);
    webSocket.once("unexpected-response", (_request, response) => {
      reject(new Error(`Unexpected response ${String(response.statusCode)}`));
    });
  });

const waitForJsonMessage = <TMessage>(webSocket: WebSocket): Promise<TMessage> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for websocket message")), 3000);
    webSocket.once("message", (data) => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(data.toString("utf8")) as TMessage);
      } catch (error) {
        reject(error);
      }
    });
  });

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
