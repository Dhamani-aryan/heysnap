"use client";

export interface ClientDiagnosticLog {
  readonly event: string;
  readonly source?: string;
  readonly message?: string;
  readonly time: string;
  readonly fields?: Record<string, unknown>;
}

export const CLIENT_DIAGNOSTIC_EVENT = "heysnap:client-diagnostic-log";

export const emitClientDiagnostic = (
  event: string,
  fields: Record<string, unknown> = {},
  options: {
    readonly source?: string;
    readonly message?: string;
  } = {},
): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent<ClientDiagnosticLog>(CLIENT_DIAGNOSTIC_EVENT, {
    detail: {
      event,
      source: options.source,
      message: options.message,
      time: new Date().toISOString(),
      fields: sanitizeFields(fields),
    },
  }));
};

export const normalizeDiagnosticUrl = (rawUrl: string | undefined): string | undefined => {
  if (rawUrl === undefined) {
    return undefined;
  }

  try {
    const url = new URL(rawUrl, window.location.href);
    url.searchParams.delete("accessToken");
    url.searchParams.delete("token");
    return `${url.protocol}//${url.host}${url.pathname}${url.search}`;
  } catch {
    return rawUrl;
  }
};

export const readDiagnosticComputerId = (rawUrl: string | undefined): string | undefined => {
  if (rawUrl === undefined || typeof window === "undefined") {
    return undefined;
  }

  try {
    const url = new URL(rawUrl, window.location.href);
    const match = /^\/gateway\/computers\/([^/]+)\//u.exec(url.pathname);
    return match === null ? undefined : decodeURIComponent(match[1] ?? "");
  } catch {
    return undefined;
  }
};

const sanitizeFields = (fields: Record<string, unknown>): Record<string, unknown> => {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    output[key] = sanitizeValue(key, value, 0);
  }

  return output;
};

const sanitizeValue = (key: string, value: unknown, depth: number): unknown => {
  if (isSecretField(key)) {
    return "[redacted]";
  }

  if (depth > 4) {
    return "[truncated]";
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return typeof value === "string" ? value.slice(0, 1000) : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((entry) => sanitizeValue(key, entry, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [childKey, entry] of Object.entries(value).slice(0, 50)) {
      output[childKey] = sanitizeValue(childKey, entry, depth + 1);
    }

    return output;
  }

  return String(value);
};

const isSecretField = (key: string): boolean => {
  const normalized = key.toLowerCase();
  return normalized.includes("token") || normalized.includes("authorization") || normalized.includes("password");
};
