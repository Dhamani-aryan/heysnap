import { Hono } from "hono";

import { requireAuth } from "../auth/middleware.js";
import type { AuthService } from "../auth/service.js";
import type { AppVariables } from "../shared/context.js";
import { logger } from "../shared/logger.js";
import { badRequest } from "../shared/errors.js";

const MAX_CLIENT_LOGS_PER_REQUEST = 50;
const MAX_EVENT_NAME_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 500;

export const createDiagnosticsRoutes = (authService: AuthService): Hono<{ Variables: AppVariables }> => {
  const app = new Hono<{ Variables: AppVariables }>();

  app.post("/client-logs", requireAuth(authService), async (context) => {
    const user = context.get("currentUser");
    const body = await context.req.json().catch(() => null);
    const logs = parseClientLogs(body);

    for (const entry of logs) {
      logger.info({
        ...entry.fields,
        event: "client.diagnostic",
        userId: user.id,
        source: entry.source,
        clientEvent: entry.event,
        clientTime: entry.time,
      }, entry.message ?? "client diagnostic event");
    }

    return context.json({ ok: true, accepted: logs.length });
  });

  return app;
};

interface ClientLogEntry {
  readonly event: string;
  readonly source?: string;
  readonly time?: string;
  readonly message?: string;
  readonly fields: Record<string, unknown>;
}

const parseClientLogs = (value: unknown): ClientLogEntry[] => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("INVALID_DIAGNOSTIC_LOGS", "Diagnostic logs body must be an object.");
  }

  const entries = (value as { readonly logs?: unknown }).logs;

  if (!Array.isArray(entries)) {
    throw badRequest("INVALID_DIAGNOSTIC_LOGS", "Diagnostic logs body must include a logs array.");
  }

  if (entries.length > MAX_CLIENT_LOGS_PER_REQUEST) {
    throw badRequest(
      "INVALID_DIAGNOSTIC_LOGS",
      `Diagnostic log requests cannot include more than ${String(MAX_CLIENT_LOGS_PER_REQUEST)} entries.`,
    );
  }

  return entries.map(parseClientLogEntry);
};

const parseClientLogEntry = (value: unknown): ClientLogEntry => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("INVALID_DIAGNOSTIC_LOGS", "Diagnostic log entries must be objects.");
  }

  const record = value as Record<string, unknown>;
  const event = readBoundedString(record["event"], "event", MAX_EVENT_NAME_LENGTH, true) ?? "";
  const source = readBoundedString(record["source"], "source", MAX_EVENT_NAME_LENGTH, false);
  const time = readBoundedString(record["time"], "time", 80, false);
  const message = readBoundedString(record["message"], "message", MAX_MESSAGE_LENGTH, false);
  const fields = readFields(record["fields"]);

  return {
    event,
    source,
    time,
    message,
    fields,
  };
};

const readFields = (value: unknown): Record<string, unknown> => {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("INVALID_DIAGNOSTIC_LOGS", "Diagnostic log fields must be an object.");
  }

  return sanitizeValue(value, 0) as Record<string, unknown>;
};

const readBoundedString = (
  value: unknown,
  fieldName: string,
  maxLength: number,
  required: boolean,
): string | undefined => {
  if (value === undefined) {
    if (required) {
      throw badRequest("INVALID_DIAGNOSTIC_LOGS", `Diagnostic log ${fieldName} is required.`);
    }

    return undefined;
  }

  if (typeof value !== "string") {
    throw badRequest("INVALID_DIAGNOSTIC_LOGS", `Diagnostic log ${fieldName} must be a string.`);
  }

  const trimmed = value.trim();

  if (required && trimmed.length === 0) {
    throw badRequest("INVALID_DIAGNOSTIC_LOGS", `Diagnostic log ${fieldName} is required.`);
  }

  return trimmed.slice(0, maxLength);
};

const sanitizeValue = (value: unknown, depth: number): unknown => {
  if (depth > 4) {
    return "[truncated]";
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value === "string" ? value.slice(0, 1000) : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((entry) => sanitizeValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value).slice(0, 50)) {
      if (isSecretField(key)) {
        output[key] = "[redacted]";
        continue;
      }

      output[key] = sanitizeValue(entry, depth + 1);
    }

    return output;
  }

  return String(value);
};

const isSecretField = (key: string): boolean => {
  const normalized = key.toLowerCase();
  return normalized.includes("token") || normalized.includes("authorization") || normalized.includes("password");
};
