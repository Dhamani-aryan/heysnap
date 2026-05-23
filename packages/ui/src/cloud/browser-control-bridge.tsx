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
  readonly outputs?: readonly BrowserControlOutputMetadata[];
  readonly readAttachment?: BrowserControlAttachmentReader;
  readonly writeOutput?: BrowserControlOutputWriter;
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

const EXTENSION_RETRY_DELAY_MS = 2500;

interface PendingBrowserControlRequest {
  readonly abortController: AbortController;
}

interface PendingBrowserControlAttachmentRead {
  readonly reject: (error: Error) => void;
  readonly resolve: (chunk: BrowserControlAttachmentChunk) => void;
}

interface PendingBrowserControlOutputWrite {
  readonly reject: (error: Error) => void;
  readonly resolve: (ack: BrowserControlOutputAck) => void;
}

export type BrowserControlServerMessage =
  | {
      readonly type: "request";
      readonly requestId: string;
      readonly command: BrowserControlCommandName;
      readonly params?: unknown;
      readonly timeoutMs?: number;
      readonly attachments?: readonly BrowserControlAttachmentMetadata[];
      readonly outputs?: readonly BrowserControlOutputMetadata[];
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
    }
  | {
      readonly type: "output.ack";
      readonly requestId: string;
      readonly writeRequestId: string;
      readonly outputId: string;
      readonly offset: number;
      readonly bytesWritten: number;
      readonly done: boolean;
    }
  | {
      readonly type: "output.error";
      readonly requestId: string;
      readonly writeRequestId: string;
      readonly outputId: string;
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

export interface BrowserControlOutputMetadata {
  readonly id: string;
  readonly mimeType: string;
  readonly maxBytes: number;
}

export interface BrowserControlOutputAck {
  readonly bytesWritten: number;
  readonly done: boolean;
  readonly offset: number;
  readonly outputId: string;
}

export type BrowserControlOutputWriter = (
  input: {
    readonly dataBase64: string;
    readonly done: boolean;
    readonly offset: number;
    readonly outputId: string;
    readonly signal: AbortSignal;
  },
) => Promise<BrowserControlOutputAck>;

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

    const resolvedWebsocketUrl = websocketUrl;
    let webSocket: WebSocket | null = null;
    let isCancelled = false;
    const pendingRequests = new Map<string, PendingBrowserControlRequest>();
    const pendingAttachmentReads = new Map<string, PendingBrowserControlAttachmentRead>();
    const pendingOutputWrites = new Map<string, PendingBrowserControlOutputWrite>();
    let extensionRetryTimer: number | undefined;
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
    const closePendingOutputWrites = (reason: string): void => {
      for (const [writeRequestId, pendingWrite] of pendingOutputWrites) {
        pendingOutputWrites.delete(writeRequestId);
        pendingWrite.reject(new BrowserControlExtensionCommandError("BROWSER_OUTPUT_CANCELLED", reason));
      }
    };

    const handleConnectError = (error: unknown): void => {
      setStatus({
        state: "error",
        label: "Connection error",
        detail: error instanceof Error ? error.message : "Failed to connect browser control.",
      });
    };

    const scheduleExtensionRetry = (): void => {
      if (isCancelled || extensionRetryTimer !== undefined) {
        return;
      }

      extensionRetryTimer = window.setTimeout(() => {
        extensionRetryTimer = undefined;
        void connect().catch(handleConnectError);
      }, EXTENSION_RETRY_DELAY_MS);
    };

    async function connect(): Promise<void> {
      setStatus({ state: "checking_extension", label: "Checking" });

      const resolvedExecutor = executorRef.current ?? createExtensionExecutor(extensionIdRef.current);
      if (resolvedExecutor === undefined) {
        setStatus({
          state: "extension_unavailable",
          label: "Extension missing",
          detail: "Chrome extension messaging is unavailable.",
        });
        scheduleExtensionRetry();
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
        scheduleExtensionRetry();
        return;
      }

      if (isCancelled) {
        return;
      }

      setStatus({ state: "connecting", label: "Connecting" });
      const socket = new WebSocket(resolvedWebsocketUrl);
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

        if (message.type === "output.ack" || message.type === "output.error") {
          settleOutputWrite(pendingOutputWrites, message);
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
          writeOutput: createOutputWriter({
            pendingOutputWrites,
            requestId: message.requestId,
            webSocket: socket,
          }),
        }).finally(() => {
          pendingRequests.delete(message.requestId);
        });
      });

      socket.addEventListener("close", () => {
        closePendingRequests("Browser-control socket closed");
        closePendingAttachmentReads("Browser-control socket closed");
        closePendingOutputWrites("Browser-control socket closed");
        setStatus({ state: "disconnected", label: "Disconnected" });
      });

      socket.addEventListener("error", () => {
        setStatus({ state: "error", label: "Connection error" });
      });
    }

    void connect().catch(handleConnectError);

    return () => {
      isCancelled = true;
      if (extensionRetryTimer !== undefined) {
        window.clearTimeout(extensionRetryTimer);
      }
      closePendingRequests("Browser-control bridge unmounted");
      closePendingAttachmentReads("Browser-control bridge unmounted");
      closePendingOutputWrites("Browser-control bridge unmounted");
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
  readonly writeOutput: BrowserControlOutputWriter;
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
      outputs: input.message.outputs,
      readAttachment: input.readAttachment,
      writeOutput: input.writeOutput,
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

    if ((input.outputs?.length ?? 0) > 0) {
      throw new BrowserControlExtensionCommandError("BROWSER_OUTPUTS_UNSUPPORTED", "Browser-control outputs require the workspace browser executor.");
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
    const outputs = parseOutputMetadata(message["outputs"]);

    if (attachments === null || outputs === null) {
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
          outputs,
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

  if (message["type"] === "output.ack") {
    return typeof message["requestId"] === "string" &&
      typeof message["writeRequestId"] === "string" &&
      typeof message["outputId"] === "string" &&
      typeof message["offset"] === "number" &&
      typeof message["bytesWritten"] === "number" &&
      typeof message["done"] === "boolean"
      ? {
          type: "output.ack",
          requestId: message["requestId"],
          writeRequestId: message["writeRequestId"],
          outputId: message["outputId"],
          offset: message["offset"],
          bytesWritten: message["bytesWritten"],
          done: message["done"],
        }
      : null;
  }

  if (message["type"] === "output.error") {
    const error = typeof message["error"] === "object" && message["error"] !== null && !Array.isArray(message["error"])
      ? message["error"] as Record<string, unknown>
      : null;

    return typeof message["requestId"] === "string" &&
      typeof message["writeRequestId"] === "string" &&
      typeof message["outputId"] === "string" &&
      typeof error?.["code"] === "string" &&
      typeof error["message"] === "string"
      ? {
          type: "output.error",
          requestId: message["requestId"],
          writeRequestId: message["writeRequestId"],
          outputId: message["outputId"],
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

const parseOutputMetadata = (value: unknown): readonly BrowserControlOutputMetadata[] | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const outputs: BrowserControlOutputMetadata[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return null;
    }

    const output = entry as Record<string, unknown>;
    if (
      typeof output["id"] !== "string" ||
      typeof output["mimeType"] !== "string" ||
      typeof output["maxBytes"] !== "number"
    ) {
      return null;
    }

    outputs.push({
      id: output["id"],
      mimeType: output["mimeType"],
      maxBytes: output["maxBytes"],
    });
  }

  return outputs;
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

const createOutputWriter = ({
  pendingOutputWrites,
  requestId,
  webSocket,
}: {
  readonly pendingOutputWrites: Map<string, PendingBrowserControlOutputWrite>;
  readonly requestId: string;
  readonly webSocket: WebSocket;
}): BrowserControlOutputWriter => async ({
  dataBase64,
  done,
  offset,
  outputId,
  signal,
}) => {
  if (webSocket.readyState !== WebSocket.OPEN) {
    throw new BrowserControlExtensionCommandError("BROWSER_OUTPUT_CANCELLED", "Browser-control socket is not open.");
  }

  const writeRequestId = createBrowserControlClientId();

  return await new Promise<BrowserControlOutputAck>((resolve, reject) => {
    const handleAbort = (): void => {
      pendingOutputWrites.delete(writeRequestId);
      reject(new BrowserControlExtensionCommandError("BROWSER_OUTPUT_CANCELLED", "Browser-control output write was cancelled."));
    };

    if (signal.aborted) {
      handleAbort();
      return;
    }

    pendingOutputWrites.set(writeRequestId, { resolve, reject });
    signal.addEventListener("abort", handleAbort, { once: true });

    try {
      webSocket.send(JSON.stringify({
        type: "output.write",
        requestId,
        writeRequestId,
        outputId,
        offset,
        dataBase64,
        done,
      }));
    } catch (error) {
      signal.removeEventListener("abort", handleAbort);
      pendingOutputWrites.delete(writeRequestId);
      reject(error instanceof Error ? error : new Error("Failed to write browser-control output chunk."));
    }
  });
};

const settleOutputWrite = (
  pendingOutputWrites: Map<string, PendingBrowserControlOutputWrite>,
  message: Extract<BrowserControlServerMessage, { readonly type: "output.ack" | "output.error" }>,
): void => {
  const pendingWrite = pendingOutputWrites.get(message.writeRequestId);

  if (pendingWrite === undefined) {
    return;
  }

  pendingOutputWrites.delete(message.writeRequestId);

  if (message.type === "output.error") {
    pendingWrite.reject(new BrowserControlExtensionCommandError(message.error.code, message.error.message));
    return;
  }

  pendingWrite.resolve({
    bytesWritten: message.bytesWritten,
    done: message.done,
    offset: message.offset,
    outputId: message.outputId,
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
  | "tab.screenshot"
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
  "tab.screenshot",
  "tab.cdp",
]);

const createClientId = (): string => {
  return createBrowserControlClientId();
};
