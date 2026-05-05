import type { AgentClientMessage, AgentServerMessage, AgentThread, AgentThreadGroup } from "./types";

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
      const message = parseMessage(event.data);

      if (message.type === "hello" || message.type === "pong") {
        return;
      }

      if (message.requestId !== requestId) {
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

const parseMessage = (data: unknown): AgentServerMessage => {
  if (typeof data !== "string") {
    throw new Error("Agent history message must be text.");
  }

  return JSON.parse(data) as AgentServerMessage;
};

const createRequestId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};
