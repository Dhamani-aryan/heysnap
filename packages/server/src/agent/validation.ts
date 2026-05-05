import { AgentError } from "./errors.js";
import type { AgentClientMessage, AgentContent } from "./types.js";

export const parseAgentClientMessage = (data: unknown): AgentClientMessage => {
  const rawText = dataToText(data);
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    throw new AgentError("INVALID_MESSAGE", "Message must be valid JSON");
  }

  if (!isAgentClientMessage(parsed)) {
    throw new AgentError("INVALID_MESSAGE", "Invalid agent message");
  }

  return parsed;
};

export const isAgentClientMessage = (value: unknown): value is AgentClientMessage => {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value["type"] !== "string" || typeof value["requestId"] !== "string") {
    return false;
  }

  switch (value["type"]) {
    case "retrieveThreads":
      return optionalString(value["rootPath"]) && optionalPositiveInteger(value["limit"]);
    case "getThread":
      return typeof value["threadId"] === "string";
    case "sendMessage":
      return (
        optionalString(value["threadId"]) &&
        typeof value["path"] === "string" &&
        isAgentContent(value["content"])
      );
    case "cancelRun":
      return typeof value["threadId"] === "string" && typeof value["runId"] === "string";
    case "ping":
      return true;
    default:
      return false;
  }
};

export const isAgentContent = (value: unknown): value is AgentContent => {
  return Array.isArray(value) && value.every(isContentBlock);
};

const isContentBlock = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value["type"] !== "string") {
    return false;
  }

  if (value["metadata"] !== undefined && !isRecord(value["metadata"])) {
    return false;
  }

  switch (value["type"]) {
    case "text":
      return typeof value["content"] === "string";
    case "image":
      return typeof value["data"] === "string" && typeof value["mimeType"] === "string";
    case "file":
      return (
        typeof value["data"] === "string" &&
        typeof value["mimeType"] === "string" &&
        typeof value["filename"] === "string"
      );
    default:
      return false;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): boolean =>
  value === undefined || typeof value === "string";

const optionalPositiveInteger = (value: unknown): boolean =>
  value === undefined || (Number.isInteger(value) && typeof value === "number" && value > 0);

const dataToText = (data: unknown): string => {
  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  throw new AgentError("INVALID_MESSAGE", "Message data must be text");
};
