import type {
  BrowserControlAttachmentMetadata,
  BrowserControlCommandName,
  BrowserControlOutputMetadata,
  BrowserControlServerMessage,
} from "./browser-control-bridge-types";

export const parseBrowserControlServerMessage = (data: unknown): BrowserControlServerMessage | null => {
  if (typeof data !== "string") {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const message = parsed as Record<string, unknown>;

  if (message["type"] === "request") {
    const attachments = parseAttachmentMetadata(message["attachments"]);
    const outputs = parseOutputMetadata(message["outputs"]);

    if (attachments === null || outputs === null) {
      return null;
    }

    return typeof message["requestId"] === "string" &&
      typeof message["command"] === "string" &&
      browserControlCommandNames.has(message["command"])
      ? {
          type: "request",
          requestId: message["requestId"],
          command: message["command"] as BrowserControlCommandName,
          params: message["params"],
          timeoutMs: typeof message["timeoutMs"] === "number" ? message["timeoutMs"] : undefined,
          attachments,
          outputs,
        }
      : null;
  }

  if (message["type"] === "cancel") {
    return typeof message["requestId"] === "string"
      ? {
          type: "cancel",
          requestId: message["requestId"],
          reason: typeof message["reason"] === "string" ? message["reason"] : undefined,
        }
      : null;
  }

  if (message["type"] === "pong") {
    return typeof message["requestId"] === "string" && typeof message["serverTime"] === "string"
      ? {
          type: "pong",
          requestId: message["requestId"],
          serverTime: message["serverTime"],
        }
      : null;
  }

  if (message["type"] === "attachment.chunk") {
    return typeof message["requestId"] === "string" &&
      typeof message["chunkRequestId"] === "string" &&
      typeof message["attachmentId"] === "string" &&
      typeof message["offset"] === "number" &&
      typeof message["dataBase64"] === "string" &&
      typeof message["done"] === "boolean"
      ? {
          type: "attachment.chunk",
          requestId: message["requestId"],
          chunkRequestId: message["chunkRequestId"],
          attachmentId: message["attachmentId"],
          offset: message["offset"],
          dataBase64: message["dataBase64"],
          done: message["done"],
        }
      : null;
  }

  if (message["type"] === "attachment.error") {
    const error = typeof message["error"] === "object" && message["error"] !== null && !Array.isArray(message["error"])
      ? message["error"] as Record<string, unknown>
      : null;

    return typeof message["requestId"] === "string" &&
      typeof message["chunkRequestId"] === "string" &&
      typeof message["attachmentId"] === "string" &&
      typeof error?.["code"] === "string" &&
      typeof error["message"] === "string"
      ? {
          type: "attachment.error",
          requestId: message["requestId"],
          chunkRequestId: message["chunkRequestId"],
          attachmentId: message["attachmentId"],
          error: {
            code: error["code"],
            message: error["message"],
          },
        }
      : null;
  }

  if (message["type"] === "output.ack") {
    return typeof message["requestId"] === "string" &&
      typeof message["writeRequestId"] === "string" &&
      typeof message["outputId"] === "string" &&
      typeof message["offset"] === "number" &&
      typeof message["bytesWritten"] === "number" &&
      typeof message["done"] === "boolean"
      ? {
          type: "output.ack",
          requestId: message["requestId"],
          writeRequestId: message["writeRequestId"],
          outputId: message["outputId"],
          offset: message["offset"],
          bytesWritten: message["bytesWritten"],
          done: message["done"],
        }
      : null;
  }

  if (message["type"] === "output.error") {
    const error = typeof message["error"] === "object" && message["error"] !== null && !Array.isArray(message["error"])
      ? message["error"] as Record<string, unknown>
      : null;

    return typeof message["requestId"] === "string" &&
      typeof message["writeRequestId"] === "string" &&
      typeof message["outputId"] === "string" &&
      typeof error?.["code"] === "string" &&
      typeof error["message"] === "string"
      ? {
          type: "output.error",
          requestId: message["requestId"],
          writeRequestId: message["writeRequestId"],
          outputId: message["outputId"],
          error: {
            code: error["code"],
            message: error["message"],
          },
        }
      : null;
  }

  return null;
};

const parseAttachmentMetadata = (value: unknown): readonly BrowserControlAttachmentMetadata[] | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const attachments: BrowserControlAttachmentMetadata[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return null;
    }

    const attachment = entry as Record<string, unknown>;
    if (
      typeof attachment["id"] !== "string" ||
      typeof attachment["name"] !== "string" ||
      typeof attachment["mimeType"] !== "string" ||
      typeof attachment["size"] !== "number"
    ) {
      return null;
    }

    attachments.push({
      id: attachment["id"],
      name: attachment["name"],
      mimeType: attachment["mimeType"],
      size: attachment["size"],
    });
  }

  return attachments;
};

const parseOutputMetadata = (value: unknown): readonly BrowserControlOutputMetadata[] | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const outputs: BrowserControlOutputMetadata[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return null;
    }

    const output = entry as Record<string, unknown>;
    if (
      typeof output["id"] !== "string" ||
      typeof output["mimeType"] !== "string" ||
      typeof output["maxBytes"] !== "number"
    ) {
      return null;
    }

    outputs.push({
      id: output["id"],
      mimeType: output["mimeType"],
      maxBytes: output["maxBytes"],
    });
  }

  return outputs;
};

const browserControlCommandNames = new Set<string>([
  "getTabs",
  "createNewTab",
  "closeTab",
  "tab.focus",
  "tab.back",
  "tab.forward",
  "tab.goTo",
  "tab.refresh",
  "tab.evaluate",
  "tab.screenshot",
  "tab.cdp",
]);
