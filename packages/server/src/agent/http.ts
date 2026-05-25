import type { IncomingMessage, ServerResponse } from "node:http";

import { AgentError, toAgentError } from "./errors.js";
import { isAgentContent } from "./validation.js";
import type { AgentContent, AgentThreadGroup, AgentUiContext, IAgentHarness } from "./types.js";
import {
  AgentRunManager,
  type AgentRunRecord,
  type AgentSseEnvelope,
  type StartAgentRunInput,
} from "./run-manager.js";

const jsonHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type, Last-Event-ID",
  "content-type": "application/json",
} as const;

const sseHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type, Last-Event-ID",
  "cache-control": "no-cache, no-transform",
  "connection": "keep-alive",
  "content-type": "text/event-stream; charset=utf-8",
  "x-accel-buffering": "no",
} as const;

export interface AgentHttpService {
  readonly runManager: AgentRunManager;
  readonly handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
}

export const createAgentHttpService = (options: {
  readonly harness: IAgentHarness;
  readonly onActivity?: () => void;
}): AgentHttpService => {
  const runManager = new AgentRunManager({ harness: options.harness, onActivity: options.onActivity });

  return {
    runManager,
    handleRequest: async (request, response) => handleAgentHttpRequest(request, response, options.harness, runManager),
  };
};

const handleAgentHttpRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  harness: IAgentHarness,
  runManager: AgentRunManager,
): Promise<boolean> => {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (!requestUrl.pathname.startsWith("/agent")) {
    return false;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, jsonHeaders);
    response.end();
    return true;
  }

  try {
    if (request.method === "GET" && requestUrl.pathname === "/agent/threads") {
      const result = await harness.retrieveThreads({
        rootPath: requestUrl.searchParams.get("rootPath") ?? undefined,
        limit: parseLimit(requestUrl.searchParams.get("limit")),
      });
      sendJson(response, 200, { groups: withStreamingState(result.groups, runManager) });
      return true;
    }

    const threadMatch = /^\/agent\/threads\/([^/]+)$/.exec(requestUrl.pathname);

    if (request.method === "GET" && threadMatch !== null) {
      const threadId = decodeURIComponent(threadMatch[1] ?? "");
      const thread = await harness.getThread({ threadId });
      sendJson(response, 200, {
        thread,
        activeRun: runManager.getActiveRunForThread(thread),
      });
      return true;
    }

    if (request.method === "POST" && requestUrl.pathname === "/agent/runs") {
      const input = parseStartRunInput(await readJsonBody(request));
      const run = runManager.startRun(input);
      streamRun(response, request, runManager, run, 0);
      return true;
    }

    const editMatch = /^\/agent\/threads\/([^/]+)\/edit$/.exec(requestUrl.pathname);

    if (request.method === "POST" && editMatch !== null) {
      const threadId = decodeURIComponent(editMatch[1] ?? "");
      const input = parseEditRunInput(threadId, await readJsonBody(request));

      if (runManager.isThreadRunning(threadId)) {
        throw new AgentError("THREAD_ACTIVE", "Cannot edit a thread while it is running");
      }

      const thread = await harness.getThread({ threadId });

      if (thread.isStreaming === true) {
        throw new AgentError("THREAD_ACTIVE", "Cannot edit a thread while it is running");
      }

      const run = runManager.startRun(input);
      streamRun(response, request, runManager, run, 0);
      return true;
    }

    const runEventsMatch = /^\/agent\/runs\/([^/]+)\/events$/.exec(requestUrl.pathname);

    if (request.method === "GET" && runEventsMatch !== null) {
      const runId = decodeURIComponent(runEventsMatch[1] ?? "");
      const run = runManager.getRun(runId);

      if (run === undefined) {
        sendJson(response, 404, { code: "RUN_NOT_FOUND", message: "Run not found" });
        return true;
      }

      streamRun(response, request, runManager, run, parseAfterEventId(request, requestUrl));
      return true;
    }

    const cancelMatch = /^\/agent\/threads\/([^/]+)\/runs\/([^/]+)\/cancel$/.exec(requestUrl.pathname);

    if (request.method === "POST" && cancelMatch !== null) {
      await runManager.cancelRun(
        decodeURIComponent(cancelMatch[1] ?? ""),
        decodeURIComponent(cancelMatch[2] ?? ""),
      );
      sendJson(response, 200, { ok: true });
      return true;
    }

    const steerMatch = /^\/agent\/threads\/([^/]+)\/runs\/([^/]+)\/steer$/.exec(requestUrl.pathname);

    if (request.method === "POST" && steerMatch !== null) {
      const result = await runManager.steerRun(
        parseSteerRunInput(
          decodeURIComponent(steerMatch[1] ?? ""),
          decodeURIComponent(steerMatch[2] ?? ""),
          await readJsonBody(request),
        ),
      );
      sendJson(response, 200, result);
      return true;
    }

    sendJson(response, 404, { code: "NOT_FOUND", message: "Agent endpoint not found" });
    return true;
  } catch (error) {
    const agentError = toAgentError(error);
    sendJson(response, getAgentErrorStatus(agentError), {
      code: agentError.code,
      message: agentError.message,
    });
    return true;
  }
};

const streamRun = (
  response: ServerResponse,
  request: IncomingMessage,
  runManager: AgentRunManager,
  run: AgentRunRecord,
  afterEnvelopeId: number,
): void => {
  response.writeHead(200, sseHeaders);
  response.write(": connected\n\n");

  let shouldEnd = false;
  const subscription = runManager.subscribe(run, afterEnvelopeId, (envelope) => {
    response.write(formatSseEnvelope(envelope));

    if (envelope.type === "run_end" || envelope.type === "error") {
      shouldEnd = true;
      queueMicrotask(() => {
        subscription.unsubscribe();
        response.end();
      });
    }
  });

  if (shouldEnd || run.status === "completed" || run.status === "failed") {
    subscription.unsubscribe();
    response.end();
    return;
  }

  request.on("close", () => {
    subscription.unsubscribe();
    response.end();
  });
};

const parseLimit = (rawLimit: string | null): number | undefined => {
  if (rawLimit === null || rawLimit.length === 0) {
    return undefined;
  }

  const limit = Number.parseInt(rawLimit, 10);
  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
};

const parseAfterEventId = (request: IncomingMessage, requestUrl: URL): number => {
  const raw = request.headers["last-event-id"] ?? requestUrl.searchParams.get("after");
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (value === undefined || value === null || value.length === 0) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

const parseStartRunInput = (body: unknown): StartAgentRunInput => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Run request must be a JSON object");
  }

  const input = body as Record<string, unknown>;

  if (
    (input["threadId"] !== undefined && typeof input["threadId"] !== "string") ||
    typeof input["path"] !== "string" ||
    !isAgentContent(input["content"]) ||
    (input["clientRunId"] !== undefined && typeof input["clientRunId"] !== "string")
  ) {
    throw new Error("Invalid run request");
  }

  return {
    threadId: input["threadId"] as string | undefined,
    path: input["path"],
    content: input["content"] as AgentContent,
    uiContext: parseAgentUiContext(input["uiContext"]),
    clientRunId: input["clientRunId"] as string | undefined,
  };
};

const parseEditRunInput = (threadId: string, body: unknown): StartAgentRunInput => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Edit request must be a JSON object");
  }

  const input = body as Record<string, unknown>;
  const numTurns = input["numTurns"] === undefined ? 1 : input["numTurns"];

  if (
    threadId.length === 0 ||
    typeof input["path"] !== "string" ||
    !isAgentContent(input["content"]) ||
    (input["clientRunId"] !== undefined && typeof input["clientRunId"] !== "string") ||
    !Number.isInteger(numTurns) ||
    (numTurns as number) <= 0
  ) {
    throw new Error("Invalid edit request");
  }

  return {
    threadId,
    path: input["path"],
    content: input["content"] as AgentContent,
    uiContext: parseAgentUiContext(input["uiContext"]),
    clientRunId: input["clientRunId"] as string | undefined,
    edit: { numTurns: numTurns as number },
  };
};

const parseSteerRunInput = (
  threadId: string,
  runId: string,
  body: unknown,
): {
  readonly threadId: string;
  readonly runId: string;
  readonly path: string;
  readonly content: AgentContent;
  readonly uiContext?: AgentUiContext;
} => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Steer request must be a JSON object");
  }

  const input = body as Record<string, unknown>;

  if (threadId.length === 0 || runId.length === 0 || typeof input["path"] !== "string" || !isAgentContent(input["content"])) {
    throw new Error("Invalid steer request");
  }

  return {
    threadId,
    runId,
    path: input["path"],
    content: input["content"] as AgentContent,
    uiContext: parseAgentUiContext(input["uiContext"]),
  };
};

const parseAgentUiContext = (value: unknown): AgentUiContext | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid UI context");
  }

  const context = value as Record<string, unknown>;

  if (Object.keys(context).some((key) => key !== "openFiles")) {
    throw new Error("Invalid UI context");
  }

  if (!Array.isArray(context["openFiles"])) {
    throw new Error("Invalid UI context");
  }

  return {
    openFiles: context["openFiles"].map((file): AgentUiContext["openFiles"][number] => {
      if (
        typeof file !== "object" ||
        file === null ||
        Array.isArray(file) ||
        typeof (file as Record<string, unknown>)["path"] !== "string" ||
        typeof (file as Record<string, unknown>)["isFocused"] !== "boolean"
      ) {
        throw new Error("Invalid UI context");
      }

      const openFile = file as Record<string, unknown>;
      return {
        path: openFile["path"] as string,
        isFocused: openFile["isFocused"] as boolean,
      };
    }),
  };
};

const withStreamingState = (
  groups: readonly AgentThreadGroup[],
  runManager: AgentRunManager,
): AgentThreadGroup[] =>
  groups.map((group) => ({
    ...group,
    threads: group.threads.map((thread) => ({
      ...thread,
      isStreaming: thread.isStreaming === true || runManager.isThreadRunning(thread.id),
    })),
  }));

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const bodyText = Buffer.concat(chunks).toString("utf8");

  if (bodyText.length === 0) {
    return {};
  }

  return JSON.parse(bodyText) as unknown;
};

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(body));
};

const getAgentErrorStatus = (error: AgentError): number => {
  if (error.code === "THREAD_NOT_FOUND" || error.code === "RUN_NOT_FOUND") {
    return 404;
  }

  if (error.code === "THREAD_ACTIVE" || error.code === "RUN_NOT_ACTIVE" || error.code === "RUN_THREAD_MISMATCH") {
    return 409;
  }

  return 400;
};

const formatSseEnvelope = (envelope: AgentSseEnvelope): string =>
  [
    `id: ${String(envelope.id)}`,
    `event: ${envelope.type}`,
    `data: ${JSON.stringify(envelope.data)}`,
    "",
    "",
  ].join("\n");
