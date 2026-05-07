import type {
  AgentClientMessage,
  AgentContent,
  AgentRunEvent,
  AgentServerMessage,
  AgentThread,
  AgentThreadGroup,
} from "./types";

const REQUEST_TIMEOUT_MS = 5000;

export const retrieveAgentThreadGroups = async (
  websocketUrl: string,
  input: { readonly rootPath?: string; readonly limit?: number } = {},
): Promise<AgentThreadGroup[]> => {
  const requestId = createRequestId();
  const response = await sendAgentRequest(websocketUrl, {
    type: "retrieveThreads",
    requestId,
    rootPath: input.rootPath,
    limit: input.limit,
  }, requestId);

  if (response.type !== "threads") {
    throw new Error("Agent server returned an unexpected history response.");
  }

  return response.groups;
};

export const getAgentThread = async (websocketUrl: string, threadId: string): Promise<AgentThread> => {
  const requestId = createRequestId();
  const response = await sendAgentRequest(websocketUrl, {
    type: "getThread",
    requestId,
    threadId,
  }, requestId);

  if (response.type !== "thread") {
    throw new Error("Agent server returned an unexpected thread response.");
  }

  return response.thread;
};

export interface StartAgentRunInput {
  readonly threadId?: string;
  readonly path: string;
  readonly content: AgentContent;
}

export interface AgentRunCallbacks {
  readonly onRunStart?: (input: { readonly requestId: string; readonly runId: string; readonly threadId: string }) => void;
  readonly onEvent?: (event: AgentRunEvent) => void;
  readonly onRunEnd?: (input: { readonly requestId: string; readonly runId: string; readonly threadId: string }) => void;
  readonly onError?: (error: Error) => void;
}

export interface AgentRunHandle {
  readonly cancel: () => void;
  readonly close: () => void;
}

export const startAgentRun = (
  websocketUrl: string,
  input: StartAgentRunInput,
  callbacks: AgentRunCallbacks,
): AgentRunHandle => {
  const requestId = createRequestId();
  const socket = new WebSocket(websocketUrl);
  let runId: string | null = null;
  let threadId: string | null = null;
  let cancelRequestId: string | null = null;
  let cancelWhenReady = false;
  let isClosed = false;
  let hasEnded = false;

  const cleanup = (): void => {
    socket.removeEventListener("open", handleOpen);
    socket.removeEventListener("message", handleMessage);
    socket.removeEventListener("error", handleSocketError);
    socket.removeEventListener("close", handleClose);
  };

  const closeSocket = (): void => {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  };

  const finish = (message: Extract<AgentServerMessage, { readonly type: "run_end" }>): void => {
    if (hasEnded) {
      return;
    }

    hasEnded = true;
    callbacks.onRunEnd?.({
      requestId: message.requestId,
      runId: message.runId,
      threadId: message.threadId,
    });
    cleanup();
    closeSocket();
  };

  const fail = (error: Error): void => {
    if (hasEnded || isClosed) {
      return;
    }

    hasEnded = true;
    callbacks.onError?.(error);
    cleanup();
    closeSocket();
  };

  const sendCancel = (): void => {
    if (runId === null || threadId === null) {
      cancelWhenReady = true;
      return;
    }

    if (cancelRequestId !== null || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    cancelRequestId = createRequestId();
    sendMessage(socket, {
      type: "cancelRun",
      requestId: cancelRequestId,
      threadId,
      runId,
    });
  };

  function handleOpen(): void {
    sendMessage(socket, {
      type: "sendMessage",
      requestId,
      threadId: input.threadId,
      path: input.path,
      content: input.content,
    });
  }

  function handleMessage(event: MessageEvent): void {
    void handleParsedMessage(event.data);
  }

  async function handleParsedMessage(data: unknown): Promise<void> {
    let message: AgentServerMessage;

    try {
      message = await parseMessage(data);
    } catch (error) {
      fail(error instanceof Error ? error : new Error("Failed to parse agent run message."));
      return;
    }

    if (message.type === "hello" || message.type === "pong") {
      return;
    }

    if (message.type === "error") {
      if (
        message.requestId === undefined ||
        message.requestId === requestId ||
        message.requestId === cancelRequestId
      ) {
        fail(new Error(message.message));
      }
      return;
    }

    if (message.type === "run_start") {
      if (message.requestId !== requestId) {
        return;
      }

      runId = message.runId;
      threadId = message.threadId;
      callbacks.onRunStart?.({
        requestId: message.requestId,
        runId: message.runId,
        threadId: message.threadId,
      });

      if (cancelWhenReady) {
        sendCancel();
      }
      return;
    }

    if (message.type === "event") {
      if (message.requestId === requestId) {
        callbacks.onEvent?.(message.event);
      }
      return;
    }

    if (message.type === "run_end") {
      const isThisRun =
        message.requestId === requestId ||
        message.requestId === cancelRequestId ||
        (runId !== null && threadId !== null && message.runId === runId && message.threadId === threadId);

      if (isThisRun) {
        finish(message);
      }
    }
  }

  function handleSocketError(): void {
    fail(new Error("Agent run connection failed."));
  }

  function handleClose(): void {
    if (!hasEnded && !isClosed) {
      isClosed = true;
      cleanup();
      callbacks.onError?.(new Error("Agent run connection closed."));
      return;
    }

    isClosed = true;
  }

  socket.addEventListener("open", handleOpen);
  socket.addEventListener("message", handleMessage);
  socket.addEventListener("error", handleSocketError);
  socket.addEventListener("close", handleClose);

  return {
    cancel: sendCancel,
    close: () => {
      isClosed = true;
      cleanup();
      closeSocket();
    },
  };
};

const sendAgentRequest = async (
  websocketUrl: string,
  message: AgentClientMessage,
  requestId: string,
): Promise<Extract<AgentServerMessage, { readonly type: "threads" | "thread" | "error" }>> => {
  const socket = new WebSocket(websocketUrl);

  try {
    await waitForOpen(socket);
    sendMessage(socket, message);
    const response = await waitForMessage(socket, requestId);

    if (response.type === "error") {
      throw new Error(response.message);
    }

    return response;
  } finally {
    socket.close();
  }
};

const waitForOpen = async (socket: WebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out connecting to agent history."));
    }, REQUEST_TIMEOUT_MS);

    const handleOpen = (): void => {
      cleanup();
      resolve();
    };
    const handleError = (): void => {
      cleanup();
      reject(new Error("Failed to connect to agent history."));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("error", handleError);
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("error", handleError);
  });

const waitForMessage = async (
  socket: WebSocket,
  requestId: string,
): Promise<Extract<AgentServerMessage, { readonly type: "threads" | "thread" | "error" }>> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out loading thread history."));
    }, REQUEST_TIMEOUT_MS);

    const handleMessage = (event: MessageEvent): void => {
      void handleParsedMessage(event.data);
    };

    const handleParsedMessage = async (data: unknown): Promise<void> => {
      let message: AgentServerMessage;

      try {
        message = await parseMessage(data);
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error("Failed to parse agent history message."));
        return;
      }

      if (message.type === "hello" || message.type === "pong") {
        return;
      }

      if (message.requestId !== requestId) {
        return;
      }

      if (message.type !== "threads" && message.type !== "thread" && message.type !== "error") {
        return;
      }

      cleanup();
      resolve(message);
    };
    const handleError = (): void => {
      cleanup();
      reject(new Error("Failed to load thread history."));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", handleError);
    };

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleError);
  });

const sendMessage = (socket: WebSocket, message: AgentClientMessage): void => {
  socket.send(JSON.stringify(message));
};

const parseMessage = async (data: unknown): Promise<AgentServerMessage> => {
  const text = await messageDataToText(data);
  return JSON.parse(text) as AgentServerMessage;
};

const messageDataToText = async (data: unknown): Promise<string> => {
  if (typeof data !== "string") {
    if (data instanceof ArrayBuffer) {
      return new TextDecoder().decode(data);
    }

    if (typeof Blob !== "undefined" && data instanceof Blob) {
      return data.text();
    }

    throw new Error("Agent history message must be text.");
  }

  return data;
};

const createRequestId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};
