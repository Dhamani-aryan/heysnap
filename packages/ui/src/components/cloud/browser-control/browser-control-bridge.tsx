"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  BrowserControlExtensionCommandError,
  createBrowserControlClientId,
  sendBrowserControlExtensionCommand,
} from "../../../cloud/browser-control-extension";
import {
  emitClientDiagnostic,
  normalizeDiagnosticUrl,
  readDiagnosticComputerId,
} from "../../../cloud/client-diagnostics";

import { parseBrowserControlServerMessage } from "./browser-control-bridge-messages";
import type {
  BrowserControlAttachmentChunk,
  BrowserControlAttachmentMetadata,
  BrowserControlAttachmentReader,
  BrowserControlBridgeProps,
  BrowserControlExecutor,
  BrowserControlOutputAck,
  BrowserControlOutputMetadata,
  BrowserControlOutputWriter,
  BrowserControlServerMessage,
  BrowserControlStatus,
} from "./browser-control-bridge-types";

const EXTENSION_RETRY_DELAY_MS = 2500;
const BROWSER_CONTROL_RECONNECT_DELAY_MS = 1000;

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
    const diagnosticComputerId = readDiagnosticComputerId(resolvedWebsocketUrl);
    let webSocket: WebSocket | null = null;
    let isCancelled = false;
    let socketOpenedAt = 0;
    let messagesIn = 0;
    let messagesOut = 0;
    const pendingRequests = new Map<string, PendingBrowserControlRequest>();
    const pendingAttachmentReads = new Map<string, PendingBrowserControlAttachmentRead>();
    const pendingOutputWrites = new Map<string, PendingBrowserControlOutputWrite>();
    let extensionRetryTimer: number | undefined;
    let websocketReconnectTimer: number | undefined;
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

    const scheduleWebsocketReconnect = (event: CloseEvent): void => {
      if (!shouldReconnectBrowserControlWebsocket({ closeCode: event.code, isCancelled })) {
        return;
      }

      if (websocketReconnectTimer !== undefined) {
        return;
      }

      setStatus({
        state: "disconnected",
        label: "Reconnecting",
        detail: "Browser control disconnected. Reconnecting...",
      });
      emitClientDiagnostic("browser_control_ws.reconnect_scheduled", {
        computerId: diagnosticComputerId,
        url: normalizeDiagnosticUrl(resolvedWebsocketUrl),
        clientId,
        closeCode: event.code,
        closeReason: event.reason,
        wasClean: event.wasClean,
        delayMs: BROWSER_CONTROL_RECONNECT_DELAY_MS,
      }, { source: "browser-control-bridge", message: "Browser-control websocket reconnect scheduled" });
      websocketReconnectTimer = window.setTimeout(() => {
        websocketReconnectTimer = undefined;
        void connect().catch(handleConnectError);
      }, BROWSER_CONTROL_RECONNECT_DELAY_MS);
    };

    async function connect(): Promise<void> {
      setStatus({ state: "checking_extension", label: "Checking" });

      const resolvedExecutor = executorRef.current ?? createExtensionExecutor(extensionIdRef.current);
      if (resolvedExecutor === undefined) {
        emitClientDiagnostic("browser_control_ws.extension_unavailable", {
          computerId: diagnosticComputerId,
          url: normalizeDiagnosticUrl(resolvedWebsocketUrl),
          reason: "executor_unavailable",
        }, { source: "browser-control-bridge", message: "Browser-control extension executor unavailable" });
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
        emitClientDiagnostic("browser_control_ws.extension_unavailable", {
          computerId: diagnosticComputerId,
          url: normalizeDiagnosticUrl(resolvedWebsocketUrl),
          reason: "ping_failed",
          errorMessage: error instanceof Error ? error.message : "Chrome extension did not respond.",
        }, { source: "browser-control-bridge", message: "Browser-control extension ping failed" });
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
      emitClientDiagnostic("browser_control_ws.connect_start", {
        computerId: diagnosticComputerId,
        url: normalizeDiagnosticUrl(resolvedWebsocketUrl),
        clientId,
      }, { source: "browser-control-bridge", message: "Browser-control websocket connecting" });
      const socket = new WebSocket(resolvedWebsocketUrl);
      webSocket = socket;
      socketOpenedAt = Date.now();
      messagesIn = 0;
      messagesOut = 0;

      socket.addEventListener("open", () => {
        setStatus({ state: "connected", label: "Connected" });
        emitClientDiagnostic("browser_control_ws.open", {
          computerId: diagnosticComputerId,
          url: normalizeDiagnosticUrl(resolvedWebsocketUrl),
          clientId,
        }, { source: "browser-control-bridge", message: "Browser-control websocket opened" });
        messagesOut += 1;
        socket.send(JSON.stringify({
          type: "hello",
          protocolVersion: 1,
          clientId,
          capabilities: ["chrome.runtime"],
        }));
      });

      socket.addEventListener("message", (event) => {
        messagesIn += 1;
        const message = parseBrowserControlServerMessage(event.data);

        if (message === null) {
          emitClientDiagnostic("browser_control_ws.invalid_message", {
            computerId: diagnosticComputerId,
            url: normalizeDiagnosticUrl(resolvedWebsocketUrl),
            clientId,
          }, { source: "browser-control-bridge", message: "Invalid browser-control websocket message" });
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

      socket.addEventListener("close", (event) => {
        if (webSocket === socket) {
          webSocket = null;
        }

        closePendingRequests("Browser-control socket closed");
        closePendingAttachmentReads("Browser-control socket closed");
        closePendingOutputWrites("Browser-control socket closed");
        emitClientDiagnostic("browser_control_ws.close", {
          computerId: diagnosticComputerId,
          url: normalizeDiagnosticUrl(resolvedWebsocketUrl),
          clientId,
          closeCode: event.code,
          closeReason: event.reason,
          wasClean: event.wasClean,
          ageMs: Date.now() - socketOpenedAt,
          messagesIn,
          messagesOut,
          pendingRequestCount: pendingRequests.size,
          pendingAttachmentReadCount: pendingAttachmentReads.size,
          pendingOutputWriteCount: pendingOutputWrites.size,
        }, { source: "browser-control-bridge", message: "Browser-control websocket closed" });
        if (shouldReconnectBrowserControlWebsocket({ closeCode: event.code, isCancelled })) {
          scheduleWebsocketReconnect(event);
        } else {
          setStatus({ state: "disconnected", label: "Disconnected" });
        }
      });

      socket.addEventListener("error", () => {
        emitClientDiagnostic("browser_control_ws.error", {
          computerId: diagnosticComputerId,
          url: normalizeDiagnosticUrl(resolvedWebsocketUrl),
          clientId,
          ageMs: Date.now() - socketOpenedAt,
          messagesIn,
          messagesOut,
        }, { source: "browser-control-bridge", message: "Browser-control websocket error" });
        setStatus({ state: "error", label: "Connection error" });
      });
    }

    void connect().catch(handleConnectError);

    return () => {
      isCancelled = true;
      if (extensionRetryTimer !== undefined) {
        window.clearTimeout(extensionRetryTimer);
      }
      if (websocketReconnectTimer !== undefined) {
        window.clearTimeout(websocketReconnectTimer);
      }
      closePendingRequests("Browser-control bridge unmounted");
      closePendingAttachmentReads("Browser-control bridge unmounted");
      closePendingOutputWrites("Browser-control bridge unmounted");
      webSocket?.close(1000, "Browser-control bridge unmounted");
    };
  }, [clientId, extensionId, onStatusChange, websocketUrl]);

  return null;
}

export const shouldReconnectBrowserControlWebsocket = (
  input: { readonly closeCode: number; readonly isCancelled: boolean },
): boolean => {
  if (input.isCancelled) {
    return false;
  }

  return input.closeCode !== 1003;
};

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

const createClientId = (): string => {
  return createBrowserControlClientId();
};
