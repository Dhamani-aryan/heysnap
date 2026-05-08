import { CapabilityError } from "./errors.js";
import type { CapabilityClientMessage } from "./types.js";

export const parseCapabilityClientMessage = (data: unknown): CapabilityClientMessage => {
  const rawText = dataToText(data);
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    throw new CapabilityError("INVALID_MESSAGE", "Message must be valid JSON");
  }

  if (!isCapabilityClientMessage(parsed)) {
    throw new CapabilityError("INVALID_MESSAGE", "Invalid capability message");
  }

  return parsed;
};

const isCapabilityClientMessage = (value: unknown): value is CapabilityClientMessage => {
  if (!isRecord(value) || typeof value["type"] !== "string" || typeof value["requestId"] !== "string") {
    return false;
  }

  switch (value["type"]) {
    case "listCapabilities":
    case "ping":
      return true;
    case "installTool":
    case "updateTool":
    case "connectTool":
    case "disconnectTool":
    case "refreshToolStatus":
      return typeof value["toolId"] === "string" && value["toolId"].length > 0;
    case "sendToolInput":
      return typeof value["operationId"] === "string" && value["operationId"].length > 0 &&
        typeof value["input"] === "string" && value["input"].length > 0;
    case "installSkill":
      return typeof value["skillId"] === "string" && value["skillId"].length > 0;
    case "setSkillActive":
      return typeof value["skillId"] === "string" && value["skillId"].length > 0 && typeof value["active"] === "boolean";
    default:
      return false;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

  throw new CapabilityError("INVALID_MESSAGE", "Capability message must be text.");
};
