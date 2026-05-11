import type {
  AgentContent,
  AgentRunEvent,
  AgentThread,
  AgentThreadGroup,
} from "./types";

const REQUEST_TIMEOUT_MS = 5000;
const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 3;

export interface AgentActiveRun {
  readonly runId: string;
  readonly threadId: string;
  readonly status: "running";
  readonly eventsUrl: string;
  readonly replayAfterEventId?: number;
}

export interface GetAgentThreadResult {
  readonly thread: AgentThread;
  readonly activeRun?: AgentActiveRun;
}

export const retrieveAgentThreadGroups = async (
  agentBaseUrl: string,
  input: { readonly rootPath?: string; readonly limit?: number } = {},
): Promise<AgentThreadGroup[]> => {
  const url = buildAgentUrl(agentBaseUrl, "/threads");

  if (input.rootPath !== undefined) {
    url.searchParams.set("rootPath", input.rootPath);
  }

  if (input.limit !== undefined) {
    url.searchParams.set("limit", String(input.limit));
  }

  const response = await fetchJson<{ readonly groups: AgentThreadGroup[] }>(url);
  return response.groups;
};

export const getAgentThread = async (agentBaseUrl: string, threadId: string): Promise<GetAgentThreadResult> => {
  return fetchJson<GetAgentThreadResult>(buildAgentUrl(agentBaseUrl, `/threads/${encodeURIComponent(threadId)}`));
};

export interface StartAgentRunInput {
  readonly threadId?: string;
  readonly path: string;
  readonly content: AgentContent;
}

export interface SteerAgentRunInput {
  readonly threadId: string;
  readonly runId: string;
  readonly content: AgentContent;
}

export interface SteerAgentRunResult {
  readonly turnId: string;
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
  readonly done: Promise<void>;
}

export const startAgentRun = (
  agentBaseUrl: string,
  input: StartAgentRunInput,
  callbacks: AgentRunCallbacks,
): AgentRunHandle => {
  const requestId = createRequestId();
  const clientRunId = createRequestId();
  const state = createRunStreamState(agentBaseUrl, callbacks, requestId);

  void runStreamLoop(state, {
    method: "POST",
    url: buildAgentUrl(agentBaseUrl, "/runs").toString(),
    body: JSON.stringify({ ...input, clientRunId }),
  });

  return createRunHandle(state);
};

export const editAgentThreadUserMessage = (
  agentBaseUrl: string,
  input: Required<Pick<StartAgentRunInput, "threadId">> & StartAgentRunInput,
  callbacks: AgentRunCallbacks,
): AgentRunHandle => {
  const requestId = createRequestId();
  const clientRunId = createRequestId();
  const state = createRunStreamState(agentBaseUrl, callbacks, requestId);

  void runStreamLoop(state, {
    method: "POST",
    url: buildAgentUrl(agentBaseUrl, `/threads/${encodeURIComponent(input.threadId)}/edit`).toString(),
    body: JSON.stringify({
      path: input.path,
      content: input.content,
      numTurns: 1,
      clientRunId,
    }),
  });

  return createRunHandle(state);
};

export const resumeAgentRun = (
  agentBaseUrl: string,
  activeRun: AgentActiveRun,
  callbacks: AgentRunCallbacks,
): AgentRunHandle => {
  const requestId = createRequestId();
  const state = createRunStreamState(agentBaseUrl, callbacks, requestId);
  state.runId = activeRun.runId;
  state.threadId = activeRun.threadId;
  state.lastEventId = activeRun.replayAfterEventId ?? 0;
  callbacks.onRunStart?.({ requestId, runId: activeRun.runId, threadId: activeRun.threadId });

  const eventsUrl = resolveAgentUrl(agentBaseUrl, activeRun.eventsUrl);

  if (state.lastEventId > 0) {
    eventsUrl.searchParams.set("after", String(state.lastEventId));
  }

  void runStreamLoop(state, {
    method: "GET",
    url: eventsUrl.toString(),
  });

  return createRunHandle(state);
};

export const steerAgentRun = async (
  agentBaseUrl: string,
  input: SteerAgentRunInput,
): Promise<SteerAgentRunResult> => {
  return fetchJson<SteerAgentRunResult>(
    buildAgentUrl(
      agentBaseUrl,
      `/threads/${encodeURIComponent(input.threadId)}/runs/${encodeURIComponent(input.runId)}/steer`,
    ),
    {
      method: "POST",
      body: JSON.stringify({ content: input.content }),
    },
  );
};

interface RunStreamState {
  readonly agentBaseUrl: string;
  readonly callbacks: AgentRunCallbacks;
  readonly requestId: string;
  readonly abortController: AbortController;
  runId: string | null;
  threadId: string | null;
  lastEventId: number;
  cancelWhenReady: boolean;
  cancelRequestSent: boolean;
  closed: boolean;
  ended: boolean;
  settled: boolean;
  readonly done: Promise<void>;
  readonly resolveDone: () => void;
  readonly rejectDone: (error: Error) => void;
}

interface RunStreamRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body?: string;
}

type AgentSseMessage =
  | { readonly id: number; readonly event: "run_start"; readonly data: { readonly runId: string; readonly threadId: string } }
  | {
      readonly id: number;
      readonly event: "event";
      readonly data: { readonly runId: string; readonly threadId: string; readonly event: AgentRunEvent };
    }
  | { readonly id: number; readonly event: "run_end"; readonly data: { readonly runId: string; readonly threadId: string } }
  | { readonly id: number; readonly event: "error"; readonly data: { readonly code?: string; readonly message: string } };

const createRunStreamState = (
  agentBaseUrl: string,
  callbacks: AgentRunCallbacks,
  requestId: string,
): RunStreamState => {
  let resolveDone: () => void = () => {};
  let rejectDone: (error: Error) => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  return {
    agentBaseUrl,
    callbacks,
    requestId,
    abortController: new AbortController(),
    runId: null,
    threadId: null,
    lastEventId: 0,
    cancelWhenReady: false,
    cancelRequestSent: false,
    closed: false,
    ended: false,
    settled: false,
    done,
    resolveDone,
    rejectDone,
  };
};

const createRunHandle = (state: RunStreamState): AgentRunHandle => ({
  done: state.done,
  cancel: () => {
    state.cancelWhenReady = true;
    void sendCancelIfReady(state);
  },
  close: () => {
    state.closed = true;
    state.abortController.abort();
    settleRun(state);
  },
});

const runStreamLoop = async (state: RunStreamState, initialRequest: RunStreamRequest): Promise<void> => {
  let request = initialRequest;
  let reconnectAttempts = 0;

  while (!state.closed && !state.ended) {
    try {
      await readRunStream(state, request);
      return;
    } catch (error) {
      if (state.closed || state.ended || state.abortController.signal.aborted) {
        return;
      }

      reconnectAttempts += 1;

      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        failRun(state, error instanceof Error ? error : new Error("Agent run stream failed."));
        return;
      }

      await sleep(RECONNECT_DELAY_MS);

      if (state.runId !== null) {
        const url = buildAgentUrl(state.agentBaseUrl, `/runs/${encodeURIComponent(state.runId)}/events`);
        url.searchParams.set("after", String(state.lastEventId));
        request = { method: "GET", url: url.toString() };
      }
    }
  }
};

const readRunStream = async (state: RunStreamState, request: RunStreamRequest): Promise<void> => {
  const response = await fetch(request.url, {
    method: request.method,
    body: request.body,
    headers: {
      ...(request.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(state.lastEventId > 0 ? { "last-event-id": String(state.lastEventId) } : {}),
    },
    signal: state.abortController.signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (response.body === null) {
    throw new Error("Agent run did not return a stream.");
  }

  for await (const message of readSseMessages(response.body)) {
    handleRunStreamMessage(state, message);

    if (state.ended || state.closed) {
      return;
    }
  }

  if (!state.ended) {
    throw new Error("Agent run stream closed before completion.");
  }
};

const handleRunStreamMessage = (state: RunStreamState, message: AgentSseMessage): void => {
  state.lastEventId = Math.max(state.lastEventId, message.id);

  if (message.event === "run_start") {
    state.runId = message.data.runId;
    state.threadId = message.data.threadId;
    state.callbacks.onRunStart?.({
      requestId: state.requestId,
      runId: message.data.runId,
      threadId: message.data.threadId,
    });
    void sendCancelIfReady(state);
    return;
  }

  if (message.event === "event") {
    state.runId = message.data.runId;
    state.threadId = message.data.threadId;
    state.callbacks.onEvent?.(message.data.event);
    return;
  }

  if (message.event === "run_end") {
    state.ended = true;
    state.callbacks.onRunEnd?.({
      requestId: state.requestId,
      runId: message.data.runId,
      threadId: message.data.threadId,
    });
    settleRun(state);
    return;
  }

  state.ended = true;
  state.callbacks.onError?.(new Error(message.data.message));
  settleRun(state, new Error(message.data.message));
};

const sendCancelIfReady = async (state: RunStreamState): Promise<void> => {
  if (
    !state.cancelWhenReady ||
    state.cancelRequestSent ||
    state.runId === null ||
    state.threadId === null
  ) {
    return;
  }

  state.cancelRequestSent = true;
  const url = buildAgentUrl(
    state.agentBaseUrl,
    `/threads/${encodeURIComponent(state.threadId)}/runs/${encodeURIComponent(state.runId)}/cancel`,
  );

  try {
    await fetch(url, { method: "POST" });
  } catch (error) {
    state.callbacks.onError?.(error instanceof Error ? error : new Error("Failed to cancel agent run."));
  }
};

const failRun = (state: RunStreamState, error: Error): void => {
  if (state.ended || state.closed) {
    return;
  }

  state.ended = true;
  state.callbacks.onError?.(error);
  settleRun(state, error);
};

const settleRun = (state: RunStreamState, error?: Error): void => {
  if (state.settled) {
    return;
  }

  state.settled = true;
  if (error === undefined) {
    state.resolveDone();
    return;
  }

  state.rejectDone(error);
};

const fetchJson = async <TResponse>(
  url: URL,
  init: RequestInit = {},
): Promise<TResponse> => {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    return await response.json() as TResponse;
  } finally {
    globalThis.clearTimeout(timeout);
  }
};

const readSseMessages = async function* (body: ReadableStream<Uint8Array>): AsyncIterable<AgentSseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let boundaryIndex = buffer.indexOf("\n\n");

    while (boundaryIndex >= 0) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      const message = parseSseMessage(rawEvent);

      if (message !== null) {
        yield message;
      }

      boundaryIndex = buffer.indexOf("\n\n");
    }
  }
};

const parseSseMessage = (rawEvent: string): AgentSseMessage | null => {
  let id = 0;
  let event = "";
  const dataLines: string[] = [];

  for (const line of rawEvent.split("\n")) {
    if (line.length === 0 || line.startsWith(":")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
    const value = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trimStart() : "";

    if (field === "id") {
      id = Number.parseInt(value, 10);
    } else if (field === "event") {
      event = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  if (!Number.isInteger(id) || id <= 0 || dataLines.length === 0 || !isKnownSseEvent(event)) {
    return null;
  }

  return {
    id,
    event,
    data: JSON.parse(dataLines.join("\n")) as AgentSseMessage["data"],
  } as AgentSseMessage;
};

const isKnownSseEvent = (event: string): event is AgentSseMessage["event"] =>
  event === "run_start" || event === "event" || event === "run_end" || event === "error";

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = await response.json() as { readonly message?: string; readonly error?: { readonly message?: string } };
    return body.message ?? body.error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
};

const buildAgentUrl = (agentBaseUrl: string, path: string): URL => resolveAgentUrl(agentBaseUrl, `/agent${path}`);

const resolveAgentUrl = (agentBaseUrl: string, pathOrUrl: string): URL => {
  const url = new URL(agentBaseUrl);
  const relative = pathOrUrl.startsWith("/agent/")
    ? pathOrUrl.slice("/agent/".length)
    : pathOrUrl.replace(/^\/+/u, "");
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/${relative}`;
  return url;
};

const createRequestId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
