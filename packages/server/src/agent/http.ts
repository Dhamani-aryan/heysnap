import type { IncomingMessage, ServerResponse } from "node:http";

import { toAgentError } from "./errors.js";
import { isAgentContent } from "./validation.js";
import type { AgentContent, IAgentHarness } from "./types.js";
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

export const createAgentHttpService = (options: { readonly harness: IAgentHarness }): AgentHttpService => {
  const runManager = new AgentRunManager({ harness: options.harness });

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
      sendJson(response, 200, { groups: result.groups });
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

    sendJson(response, 404, { code: "NOT_FOUND", message: "Agent endpoint not found" });
    return true;
  } catch (error) {
    const agentError = toAgentError(error);
    sendJson(response, agentError.code === "THREAD_NOT_FOUND" ? 404 : 400, {
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
    clientRunId: input["clientRunId"] as string | undefined,
  };
};

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

const formatSseEnvelope = (envelope: AgentSseEnvelope): string =>
  [
    `id: ${String(envelope.id)}`,
    `event: ${envelope.type}`,
    `data: ${JSON.stringify(envelope.data)}`,
    "",
    "",
  ].join("\n");
