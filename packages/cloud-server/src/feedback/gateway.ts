import type { Context } from "hono";

import type { CloudStore, FeedbackReportRecord } from "../db/types.js";
import type { GatewayAccessService } from "../gateway/access-sessions.js";
import type { TunnelStatusRegistry } from "../gateway/tunnel.js";
import type { AppVariables } from "../shared/context.js";
import { badRequest } from "../shared/errors.js";
import { readJsonBody, stringField } from "../shared/validation.js";
import { serializeFeedbackReport } from "./serialization.js";

const MAX_FEEDBACK_COMMENT_LENGTH = 5_000;

export const handleGatewayFeedbackRequest = async (
  context: Context<{ Variables: AppVariables }>,
  options: {
    readonly store: CloudStore;
    readonly gatewayAccessService: GatewayAccessService;
    readonly tunnelRegistry: TunnelStatusRegistry;
  },
): Promise<Response> => {
  const computerId = context.req.param("computerId");
  const requestUrl = new URL(context.req.url);

  if (computerId === undefined || computerId.length === 0) {
    return context.json({ error: { code: "NOT_FOUND", message: "Computer not found" } }, 404);
  }

  const token = readBearerToken(context.req.header("authorization"))
    ?? requestUrl.searchParams.get("accessToken")
    ?? requestUrl.searchParams.get("token")
    ?? undefined;

  if (token === undefined || token.length === 0) {
    return context.json({ error: { code: "UNAUTHORIZED", message: "Gateway access token is required" } }, 401);
  }

  const accessSession = await options.gatewayAccessService.authenticateAccessToken({ token, computerId });

  if (accessSession === null) {
    return context.json({ error: { code: "UNAUTHORIZED", message: "Invalid gateway access token" } }, 401);
  }

  const body = await readJsonBody(context.req.raw);
  const comment = stringField(body, "comment", {
    required: true,
    maxLength: MAX_FEEDBACK_COMMENT_LENGTH,
  }) ?? "";
  const threadId = stringField(body, "threadId", { maxLength: 240 }) ?? null;
  const cwd = stringField(body, "cwd", { maxLength: 4_096 }) ?? null;
  const clientContext = readOptionalObject(body["clientContext"]);
  const report = await options.store.createFeedbackReport({
    userId: accessSession.userId,
    computerId,
    accessSessionId: accessSession.id,
    comment,
    threadId,
    cwd,
    clientContext: clientContext ?? {},
  });

  const completed = await requestMachineSnapshot(options, report, {
    comment,
    threadId,
    cwd,
  });

  return context.json({ feedback: serializeFeedbackReport(completed) }, 201);
};

const requestMachineSnapshot = async (
  options: {
    readonly store: CloudStore;
    readonly tunnelRegistry: TunnelStatusRegistry;
  },
  report: FeedbackReportRecord,
  input: {
    readonly comment: string;
    readonly threadId: string | null;
    readonly cwd: string | null;
  },
): Promise<FeedbackReportRecord> => {
  if (options.tunnelRegistry.proxyHttpRequest === undefined) {
    return markCommentOnly(options.store, report.id, "Machine tunnel HTTP proxy is unavailable");
  }

  const body = Buffer.from(JSON.stringify({
    feedbackId: report.id,
    comment: input.comment,
    threadId: input.threadId,
    cwd: input.cwd,
    createdAt: report.createdAt.toISOString(),
  }));

  let proxied;
  try {
    proxied = await options.tunnelRegistry.proxyHttpRequest(report.computerId, {
      path: "/feedback/snapshot",
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body,
    });
  } catch (error) {
    return markCommentOnly(options.store, report.id, errorMessage(error, "Machine snapshot request failed"));
  }

  if (proxied === null) {
    return markCommentOnly(options.store, report.id, "Machine tunnel is not connected");
  }

  if (proxied.statusCode < 200 || proxied.statusCode >= 300) {
    return markCommentOnly(options.store, report.id, readMachineSnapshotError(proxied.body, proxied.statusCode));
  }

  const latest = await options.store.getFeedbackReportById(report.id);

  if (latest?.status === "complete") {
    return latest;
  }

  return markCommentOnly(options.store, report.id, "Machine snapshot finished without uploading an archive");
};

const markCommentOnly = async (
  store: CloudStore,
  feedbackId: string,
  message: string,
): Promise<FeedbackReportRecord> => {
  const updated = await store.markFeedbackReportCommentOnly({
    feedbackId,
    errorMessage: message.slice(0, 1_000),
  });

  if (updated === null) {
    throw badRequest("FEEDBACK_NOT_FOUND", "Feedback report not found");
  }

  return updated;
};

const readMachineSnapshotError = (body: Buffer, statusCode: number): string => {
  const text = body.toString("utf8").trim();

  if (text.length === 0) {
    return `Machine snapshot failed with HTTP ${statusCode}`;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record["message"] === "string") {
        return record["message"];
      }
      if (typeof record["error"] === "string") {
        return record["error"];
      }
      const nestedError = record["error"];
      if (typeof nestedError === "object" && nestedError !== null) {
        const nested = nestedError as Record<string, unknown>;
        if (typeof nested["message"] === "string") {
          return nested["message"];
        }
      }
    }
  } catch {
    // Fall back to the response text below.
  }

  return text.slice(0, 1_000);
};

const readOptionalObject = (value: unknown): Record<string, unknown> | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("INVALID_BODY", "clientContext must be an object");
  }

  return value as Record<string, unknown>;
};

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const readBearerToken = (authorization: string | undefined): string | undefined => {
  if (authorization === undefined) {
    return undefined;
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || token === undefined || token.trim().length === 0) {
    return undefined;
  }

  return token.trim();
};
