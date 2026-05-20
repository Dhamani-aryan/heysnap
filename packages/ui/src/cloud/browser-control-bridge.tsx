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
  readonly attachments?: readonly BrowserControlAttachmentMetadata[];
  readonly readAttachment?: BrowserControlAttachmentReader;
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

interface PendingBrowserControlAttachmentRead {
  readonly reject: (error: Error) => void;
  readonly resolve: (chunk: BrowserControlAttachmentChunk) => void;
}

export type BrowserControlServerMessage =
  | {
      readonly type: "request";
      readonly requestId: string;
      readonly command: BrowserControlCommandName;
      readonly params?: unknown;
      readonly timeoutMs?: number;
      readonly attachments?: readonly BrowserControlAttachmentMetadata[];
    }
  | {
      readonly type: "cancel";
      readonly requestId: string;
      readonly reason?: string;
    }
  | {
      readonly type: "attachment.chunk";
      readonly requestId: string;
      readonly chunkRequestId: string;
      readonly attachmentId: string;
      readonly offset: number;
      readonly dataBase64: string;
      readonly done: boolean;
    }
  | {
      readonly type: "attachment.error";
      readonly requestId: string;
      readonly chunkRequestId: string;
      readonly attachmentId: string;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };

export interface BrowserControlAttachmentMetadata {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
}

export interface BrowserControlAttachmentChunk {
  readonly attachmentId: string;
  readonly dataBase64: string;
  readonly done: boolean;
  readonly offset: number;
}

export type BrowserControlAttachmentReader = (
  input: {
    readonly attachmentId: string;
    readonly length: number;
    readonly offset: number;
    readonly signal: AbortSignal;
  },
) => Promise<BrowserControlAttachmentChunk>;

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
    const pendingAttachmentReads = new Map<string, PendingBrowserControlAttachmentRead>();
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
    const closePendingAttachmentReads = (reason: string): void => {
      for (const [chunkRequestId, pendingRead] of pendingAttachmentReads) {
        pendingAttachmentReads.delete(chunkRequestId);
        pendingRead.reject(new BrowserControlExtensionCommandError("BROWSER_ATTACHMENT_CANCELLED", reason));
      }
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
        const message = parseBrowserControlServerMessage(event.data);

        if (message === null) {
          socket.close(1003, "Invalid browser-control message");
          return;
        }

        if (message.type === "attachment.chunk" || message.type === "attachment.error") {
          settleAttachmentRead(pendingAttachmentReads, message);
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
          readAttachment: createAttachmentReader({
            pendingAttachmentReads,
            requestId: message.requestId,
            webSocket: socket,
          }),
          webSocket: socket,
        }).finally(() => {
          pendingRequests.delete(message.requestId);
        });
      });

      socket.addEventListener("close", () => {
        closePendingRequests("Browser-control socket closed");
        closePendingAttachmentReads("Browser-control socket closed");
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
      closePendingAttachmentReads("Browser-control bridge unmounted");
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
  readonly readAttachment: BrowserControlAttachmentReader;
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
      attachments: input.message.attachments,
      readAttachment: input.readAttachment,
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

  return async (input) => {
    if ((input.attachments?.length ?? 0) > 0) {
      throw new BrowserControlExtensionCommandError("BROWSER_ATTACHMENTS_UNSUPPORTED", "Browser-control attachments require the workspace browser executor.");
    }

    return sendBrowserControlExtensionCommand(normalizedExtensionId, input.command, input.params, input.signal);
  };
};

const sendResponse = (webSocket: WebSocket, response: unknown): void => {
  if (webSocket.readyState === WebSocket.OPEN) {
    webSocket.send(JSON.stringify(response));
  }
};

export const parseBrowserControlServerMessage = (data: unknown): BrowserControlServerMessage | null => {
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
    const attachments = parseAttachmentMetadata(message["attachments"]);

    if (attachments === null) {
      return null;
    }

    return typeof message["requestId"] === "string" &&
      typeof message["command"] === "string" &&
      browserControlCommandNames.has(message["command"])
      ? {
          type: "request",
          requestId: message["requestId"],
          command: message["command"] as BrowserControlCommandName,
          params: message["params"],
          timeoutMs: typeof message["timeoutMs"] === "number" ? message["timeoutMs"] : undefined,
          attachments,
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

  if (message["type"] === "attachment.chunk") {
    return typeof message["requestId"] === "string" &&
      typeof message["chunkRequestId"] === "string" &&
      typeof message["attachmentId"] === "string" &&
      typeof message["offset"] === "number" &&
      typeof message["dataBase64"] === "string" &&
      typeof message["done"] === "boolean"
      ? {
          type: "attachment.chunk",
          requestId: message["requestId"],
          chunkRequestId: message["chunkRequestId"],
          attachmentId: message["attachmentId"],
          offset: message["offset"],
          dataBase64: message["dataBase64"],
          done: message["done"],
        }
      : null;
  }

  if (message["type"] === "attachment.error") {
    const error = typeof message["error"] === "object" && message["error"] !== null && !Array.isArray(message["error"])
      ? message["error"] as Record<string, unknown>
      : null;

    return typeof message["requestId"] === "string" &&
      typeof message["chunkRequestId"] === "string" &&
      typeof message["attachmentId"] === "string" &&
      typeof error?.["code"] === "string" &&
      typeof error["message"] === "string"
      ? {
          type: "attachment.error",
          requestId: message["requestId"],
          chunkRequestId: message["chunkRequestId"],
          attachmentId: message["attachmentId"],
          error: {
            code: error["code"],
            message: error["message"],
          },
        }
      : null;
  }

  return null;
};

const parseAttachmentMetadata = (value: unknown): readonly BrowserControlAttachmentMetadata[] | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const attachments: BrowserControlAttachmentMetadata[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return null;
    }

    const attachment = entry as Record<string, unknown>;
    if (
      typeof attachment["id"] !== "string" ||
      typeof attachment["name"] !== "string" ||
      typeof attachment["mimeType"] !== "string" ||
      typeof attachment["size"] !== "number"
    ) {
      return null;
    }

    attachments.push({
      id: attachment["id"],
      name: attachment["name"],
      mimeType: attachment["mimeType"],
      size: attachment["size"],
    });
  }

  return attachments;
};

const createAttachmentReader = ({
  pendingAttachmentReads,
  requestId,
  webSocket,
}: {
  readonly pendingAttachmentReads: Map<string, PendingBrowserControlAttachmentRead>;
  readonly requestId: string;
  readonly webSocket: WebSocket;
}): BrowserControlAttachmentReader => async ({
  attachmentId,
  length,
  offset,
  signal,
}) => {
  if (webSocket.readyState !== WebSocket.OPEN) {
    throw new BrowserControlExtensionCommandError("BROWSER_ATTACHMENT_CANCELLED", "Browser-control socket is not open.");
  }

  const chunkRequestId = createBrowserControlClientId();

  return await new Promise<BrowserControlAttachmentChunk>((resolve, reject) => {
    const handleAbort = (): void => {
      pendingAttachmentReads.delete(chunkRequestId);
      reject(new BrowserControlExtensionCommandError("BROWSER_ATTACHMENT_CANCELLED", "Browser-control attachment read was cancelled."));
    };

    if (signal.aborted) {
      handleAbort();
      return;
    }

    pendingAttachmentReads.set(chunkRequestId, { resolve, reject });
    signal.addEventListener("abort", handleAbort, { once: true });

    try {
      webSocket.send(JSON.stringify({
        type: "attachment.read",
        requestId,
        chunkRequestId,
        attachmentId,
        offset,
        length,
      }));
    } catch (error) {
      signal.removeEventListener("abort", handleAbort);
      pendingAttachmentReads.delete(chunkRequestId);
      reject(error instanceof Error ? error : new Error("Failed to request browser-control attachment chunk."));
    }
  });
};

const settleAttachmentRead = (
  pendingAttachmentReads: Map<string, PendingBrowserControlAttachmentRead>,
  message: Extract<BrowserControlServerMessage, { readonly type: "attachment.chunk" | "attachment.error" }>,
): void => {
  const pendingRead = pendingAttachmentReads.get(message.chunkRequestId);

  if (pendingRead === undefined) {
    return;
  }

  pendingAttachmentReads.delete(message.chunkRequestId);

  if (message.type === "attachment.error") {
    pendingRead.reject(new BrowserControlExtensionCommandError(message.error.code, message.error.message));
    return;
  }

  pendingRead.resolve({
    attachmentId: message.attachmentId,
    dataBase64: message.dataBase64,
    done: message.done,
    offset: message.offset,
  });
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
