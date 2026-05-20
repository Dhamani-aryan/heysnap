import { createServer, type Server } from "node:http";

import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import {
  attachBrowserControlWebSocketServer,
  createBrowserControlService,
} from "../src/browser-control/service.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

describe("browser-control service", () => {
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
}

const startBrowserControlServer = async (): Promise<{
  readonly server: Server;
  readonly baseUrl: string;
}> => {
  const service = createBrowserControlService();
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
