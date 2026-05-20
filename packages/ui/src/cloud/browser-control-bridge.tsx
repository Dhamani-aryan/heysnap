"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  BrowserControlExtensionCommandError,
  createBrowserControlClientId,
  sendBrowserControlExtensionCommand,
} from "./browser-control-extension";

export interface BrowserControlExecutorInput {
  readonly command: string;
  readonly params: unknown;
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
}

export type BrowserControlExecutor = (
  input: BrowserControlExecutorInput,
) => Promise<unknown> | unknown;

export interface BrowserControlBridgeProps {
  readonly websocketUrl: string | undefined;
  readonly extensionId?: string;
  readonly executor?: BrowserControlExecutor;
  readonly onEnsureBrowserWindow?: () => Promise<number | null> | number | null;
  readonly onStatusChange?: (status: BrowserControlStatus) => void;
}

export interface BrowserControlStatus {
  readonly state: BrowserControlStatusState;
  readonly label: string;
  readonly detail?: string;
}

export type BrowserControlStatusState =
  | "unavailable"
  | "checking_extension"
  | "extension_unavailable"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

interface PendingBrowserControlRequest {
  readonly abortController: AbortController;
}

type BrowserControlServerMessage =
  | {
      readonly type: "request";
      readonly requestId: string;
      readonly command: BrowserControlCommandName;
      readonly params?: unknown;
      readonly timeoutMs?: number;
    }
  | {
      readonly type: "cancel";
      readonly requestId: string;
      readonly reason?: string;
    };

export function BrowserControlBridge({
  websocketUrl,
  extensionId,
  executor,
  onEnsureBrowserWindow,
  onStatusChange,
}: BrowserControlBridgeProps): React.ReactElement | null {
  const clientId = useMemo(() => createClientId(), []);
  const executorRef = useRef(executor);
  const extensionIdRef = useRef(extensionId);
  const ensureBrowserWindowRef = useRef(onEnsureBrowserWindow);

  useEffect(() => {
    executorRef.current = executor;
  }, [executor]);

  useEffect(() => {
    extensionIdRef.current = extensionId;
  }, [extensionId]);

  useEffect(() => {
    ensureBrowserWindowRef.current = onEnsureBrowserWindow;
  }, [onEnsureBrowserWindow]);

  useEffect(() => {
    if (websocketUrl === undefined) {
      onStatusChange?.({ state: "unavailable", label: "Unavailable" });
      return;
    }

    let webSocket: WebSocket | null = null;
    let isCancelled = false;
    const pendingRequests = new Map<string, PendingBrowserControlRequest>();
    const setStatus = (status: BrowserControlStatus): void => {
      if (!isCancelled) {
        onStatusChange?.(status);
      }
    };

    const closePendingRequests = (reason: string): void => {
      for (const pendingRequest of pendingRequests.values()) {
        pendingRequest.abortController.abort(reason);
      }
      pendingRequests.clear();
    };

    const connect = async (): Promise<void> => {
      setStatus({ state: "checking_extension", label: "Checking" });

      const resolvedExecutor = executorRef.current ?? createExtensionExecutor(extensionIdRef.current);
      if (resolvedExecutor === undefined) {
        setStatus({
          state: "extension_unavailable",
          label: "Extension missing",
          detail: "Chrome extension messaging is unavailable.",
        });
        return;
      }

      try {
        await resolvedExecutor({ command: "ping", params: undefined, signal: new AbortController().signal });
      } catch (error) {
        setStatus({
          state: "extension_unavailable",
          label: "Extension missing",
          detail: error instanceof Error ? error.message : "Chrome extension did not respond.",
        });
        return;
      }

      if (isCancelled) {
        return;
      }

      setStatus({ state: "connecting", label: "Connecting" });
      const socket = new WebSocket(websocketUrl);
      webSocket = socket;

      socket.addEventListener("open", () => {
        setStatus({ state: "connected", label: "Connected" });
        socket.send(JSON.stringify({
          type: "hello",
          protocolVersion: 1,
          clientId,
          capabilities: ["chrome.runtime"],
        }));
      });

      socket.addEventListener("message", (event) => {
        const message = parseServerMessage(event.data);

        if (message === null) {
          socket.close(1003, "Invalid browser-control message");
          return;
        }

        if (message.type === "cancel") {
          pendingRequests.get(message.requestId)?.abortController.abort(message.reason);
          pendingRequests.delete(message.requestId);
          return;
        }

        console.log("[browser-control] received websocket request", {
          requestId: message.requestId,
          command: message.command,
          params: message.params,
          timeoutMs: message.timeoutMs,
        });

        const abortController = new AbortController();
        pendingRequests.set(message.requestId, { abortController });

        void executeRequest({
          abortController,
          executor: executorRef.current ?? createExtensionExecutor(extensionIdRef.current),
          ensureBrowserWindow: ensureBrowserWindowRef.current,
          message,
          webSocket: socket,
        }).finally(() => {
          pendingRequests.delete(message.requestId);
        });
      });

      socket.addEventListener("close", () => {
        closePendingRequests("Browser-control socket closed");
        setStatus({ state: "disconnected", label: "Disconnected" });
      });

      socket.addEventListener("error", () => {
        setStatus({ state: "error", label: "Connection error" });
      });
    };

    void connect().catch((error) => {
      setStatus({
        state: "error",
        label: "Connection error",
        detail: error instanceof Error ? error.message : "Failed to connect browser control.",
      });
    });

    return () => {
      isCancelled = true;
      closePendingRequests("Browser-control bridge unmounted");
      webSocket?.close(1000, "Browser-control bridge unmounted");
    };
  }, [clientId, extensionId, onStatusChange, websocketUrl]);

  return null;
}

const executeRequest = async (input: {
  readonly abortController: AbortController;
  readonly ensureBrowserWindow: (() => Promise<number | null> | number | null) | undefined;
  readonly executor: BrowserControlExecutor | undefined;
  readonly message: Extract<BrowserControlServerMessage, { readonly type: "request" }>;
  readonly webSocket: WebSocket;
}): Promise<void> => {
  if (input.executor === undefined) {
    sendResponse(input.webSocket, {
      type: "response",
      requestId: input.message.requestId,
      ok: false,
      error: {
        code: "BROWSER_EXECUTOR_UNAVAILABLE",
        message: "Browser executor is not available in this workspace.",
      },
    });
    return;
  }

  try {
    if (input.ensureBrowserWindow !== undefined) {
      const windowId = await input.ensureBrowserWindow();

      if (windowId === null) {
        sendResponse(input.webSocket, {
          type: "response",
          requestId: input.message.requestId,
          ok: false,
          error: {
            code: "BROWSER_WINDOW_UNAVAILABLE",
            message: "Chrome is connected, but the browser window could not be opened.",
          },
        });
        return;
      }
    }

    const result = await input.executor({
      command: input.message.command,
      params: input.message.params,
      signal: input.abortController.signal,
      timeoutMs: input.message.timeoutMs,
    });

    sendResponse(input.webSocket, {
      type: "response",
      requestId: input.message.requestId,
      ok: true,
      result,
    });
  } catch (error) {
    const extensionError = error instanceof BrowserControlExtensionCommandError ? error : null;
    sendResponse(input.webSocket, {
      type: "response",
      requestId: input.message.requestId,
      ok: false,
      error: {
        code: extensionError?.code ?? "BROWSER_EXECUTOR_ERROR",
        message: error instanceof Error ? error.message : "Browser executor failed.",
      },
    });
  }
};

const createExtensionExecutor = (extensionId: string | undefined): BrowserControlExecutor | undefined => {
  const normalizedExtensionId = extensionId?.trim();

  if (normalizedExtensionId === undefined || normalizedExtensionId.length === 0) {
    return undefined;
  }

  return async (input) => sendBrowserControlExtensionCommand(normalizedExtensionId, input.command, input.params, input.signal);
};

const sendResponse = (webSocket: WebSocket, response: unknown): void => {
  if (webSocket.readyState === WebSocket.OPEN) {
    webSocket.send(JSON.stringify(response));
  }
};

const parseServerMessage = (data: unknown): BrowserControlServerMessage | null => {
  if (typeof data !== "string") {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const message = parsed as Record<string, unknown>;

  if (message["type"] === "request") {
    return typeof message["requestId"] === "string" &&
      typeof message["command"] === "string" &&
      browserControlCommandNames.has(message["command"])
      ? {
          type: "request",
          requestId: message["requestId"],
          command: message["command"] as BrowserControlCommandName,
          params: message["params"],
          timeoutMs: typeof message["timeoutMs"] === "number" ? message["timeoutMs"] : undefined,
        }
      : null;
  }

  if (message["type"] === "cancel") {
    return typeof message["requestId"] === "string"
      ? {
          type: "cancel",
          requestId: message["requestId"],
          reason: typeof message["reason"] === "string" ? message["reason"] : undefined,
        }
      : null;
  }

  return null;
};

type BrowserControlCommandName =
  | "getTabs"
  | "createNewTab"
  | "closeTab"
  | "tab.focus"
  | "tab.back"
  | "tab.forward"
  | "tab.goTo"
  | "tab.refresh"
  | "tab.evaluate"
  | "tab.cdp";

const browserControlCommandNames = new Set<string>([
  "getTabs",
  "createNewTab",
  "closeTab",
  "tab.focus",
  "tab.back",
  "tab.forward",
  "tab.goTo",
  "tab.refresh",
  "tab.evaluate",
  "tab.cdp",
]);

const createClientId = (): string => {
  return createBrowserControlClientId();
};
