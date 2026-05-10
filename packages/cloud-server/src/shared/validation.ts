import { badRequest } from "./errors.js";

export const readJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw badRequest("INVALID_JSON", "Request body must be valid JSON");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw badRequest("INVALID_BODY", "Request body must be a JSON object");
  }

  return body as Record<string, unknown>;
};

export const stringField = (
  input: Record<string, unknown>,
  key: string,
  options: { readonly required?: boolean; readonly maxLength?: number } = {},
): string | undefined => {
  const value = input[key];

  if (value === undefined) {
    if (options.required === true) {
      throw badRequest("INVALID_BODY", `${key} is required`);
    }

    return undefined;
  }

  if (typeof value !== "string") {
    throw badRequest("INVALID_BODY", `${key} must be a string`);
  }

  const trimmed = value.trim();

  if (options.required === true && trimmed.length === 0) {
    throw badRequest("INVALID_BODY", `${key} is required`);
  }

  if (options.maxLength !== undefined && trimmed.length > options.maxLength) {
    throw badRequest("INVALID_BODY", `${key} is too long`);
  }

  return trimmed;
};

export const normalizeEmail = (email: string): string => {
  const normalized = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw badRequest("INVALID_EMAIL", "Email must be a valid email address");
  }

  return normalized;
};

export const normalizeUsername = (username: string): string => {
  const normalized = username.trim().toLowerCase();

  if (normalized.length < 3) {
    throw badRequest("INVALID_USERNAME", "Username must be at least 3 characters");
  }

  if (normalized.length > 40) {
    throw badRequest("INVALID_USERNAME", "Username must be at most 40 characters");
  }

  if (!/^[a-z0-9_-]+$/.test(normalized)) {
    throw badRequest("INVALID_USERNAME", "Username may only contain letters, numbers, underscores, and hyphens");
  }

  return normalized;
};

export const requirePassword = (password: string): void => {
  if (password.length < 6) {
    throw badRequest("WEAK_PASSWORD", "Password must be at least 6 characters");
  }
};
