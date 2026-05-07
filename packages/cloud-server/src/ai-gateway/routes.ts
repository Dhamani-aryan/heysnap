import { Hono } from "hono";

import type { CloudServerConfig } from "../config.js";
import type { AiUsageRequestRecord, CloudStore } from "../db/types.js";
import { authenticateMachineToken } from "../machines/auth.js";
import { badGateway, notFound, serviceUnavailable } from "../shared/errors.js";

const GATEWAY_PREFIX = "/llm/openai/v1";
const PROVIDER = "azure";
const DEFAULT_CAPTURE_BODY_MAX_BYTES = 262_144;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const SECRET_HEADER_NAMES = new Set([
  "api-key",
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
]);

export const createAiGatewayRoutes = (
  store: CloudStore,
  config: CloudServerConfig,
): Hono => {
  const app = new Hono();

  app.all("/openai/v1/*", async (context) => {
    const azureBaseUrl = config.aiGatewayAzureBaseUrl;
    const azureApiKey = config.aiGatewayAzureApiKey;

    if (azureBaseUrl === undefined || azureApiKey === undefined) {
      throw serviceUnavailable("AI_GATEWAY_NOT_CONFIGURED", "AI gateway is not configured");
    }

    const startedAt = new Date();
    const machine = await authenticateMachineToken(store, config, context.req.header("api-key"));
    const computer = await store.getComputerById(machine.computerId);

    if (computer === null) {
      throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
    }

    await store.touchMachineIdentity({ identityId: machine.id, lastUsedAt: startedAt });

    const requestUrl = new URL(context.req.url);
    const upstreamPath = buildUpstreamPath(requestUrl);
    const upstreamUrl = buildUpstreamUrl(azureBaseUrl, requestUrl);
    const captureBodies = config.aiGatewayCaptureBodies === true;
    const captureMaxBytes = config.aiGatewayCaptureBodyMaxBytes ?? DEFAULT_CAPTURE_BODY_MAX_BYTES;
    const requestBody = await readProxyRequestBody(context.req.raw, captureBodies, captureMaxBytes);
    const usage = await store.createAiUsageRequest({
      userId: computer.ownerUserId,
      computerId: computer.id,
      machineIdentityId: machine.id,
      provider: PROVIDER,
      model: extractModelFromJsonText(requestBody.text),
      method: context.req.method,
      upstreamPath,
      status: "started",
      metadata: {
        gatewayPath: requestUrl.pathname,
      },
      startedAt,
    });

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: context.req.method,
        headers: buildUpstreamRequestHeaders(context.req.raw.headers, azureApiKey, requestBody.body),
        body: requestBody.body,
        ...(["GET", "HEAD"].includes(context.req.method) ? {} : { duplex: "half" as const }),
      });
      const responseHeaders = buildDownstreamResponseHeaders(upstreamResponse.headers);
      const observer = new AiGatewayResponseObserver({
        usageId: usage.id,
        startedAt,
        store,
        httpStatus: upstreamResponse.status,
        captureBodies,
        captureMaxBytes,
        requestCapture: requestBody.capture,
        requestHeaders: redactHeaders(context.req.raw.headers),
        responseHeaders: redactHeaders(upstreamResponse.headers),
      });
      const observedBody = upstreamResponse.body === null
        ? null
        : upstreamResponse.body.pipeThrough(observer.createTransformStream());

      if (observedBody === null) {
        void observer.finish().catch((error) => {
          console.error("failed to finish AI usage logging", error);
        });
      }

      return new Response(observedBody, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      await failUsage(store, usage, startedAt, error);
      throw badGateway("AI_GATEWAY_UPSTREAM_ERROR", "AI gateway upstream request failed");
    }
  });

  return app;
};

const buildUpstreamPath = (requestUrl: URL): string => {
  const suffix = requestUrl.pathname.startsWith(GATEWAY_PREFIX)
    ? requestUrl.pathname.slice(GATEWAY_PREFIX.length)
    : requestUrl.pathname;
  const normalizedSuffix = suffix.length === 0 ? "/" : suffix;

  return `${normalizedSuffix}${requestUrl.search}`;
};

const buildUpstreamUrl = (configuredUrl: string, requestUrl: URL): string => {
  const upstreamUrl = new URL(configuredUrl);
  const suffixPath = buildUpstreamPath(new URL(`${requestUrl.origin}${requestUrl.pathname}`));
  const normalizedSuffix = suffixPath.replace(/^\/+/, "");
  const configuredPath = upstreamUrl.pathname.replace(/\/+$/, "");

  if (!configuredPath.endsWith(`/${normalizedSuffix}`)) {
    upstreamUrl.pathname = `${configuredPath}/${normalizedSuffix}`.replace(/\/{2,}/g, "/");
  }

  for (const [key, value] of requestUrl.searchParams.entries()) {
    upstreamUrl.searchParams.set(key, value);
  }

  return upstreamUrl.toString();
};

const readProxyRequestBody = async (
  request: Request,
  captureBodies: boolean,
  maxBytes: number,
): Promise<{
  readonly body: RequestInit["body"] | null | undefined;
  readonly text: string | null;
  readonly capture: BodyCapture | null;
}> => {
  if (["GET", "HEAD"].includes(request.method)) {
    return { body: undefined, text: null, capture: null };
  }

  if (!captureBodies) {
    return { body: request.body, text: null, capture: null };
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  const capture = captureBytes(bytes, maxBytes);

  return {
    body: bytes,
    text: capture.text,
    capture,
  };
};

const buildUpstreamRequestHeaders = (
  source: Headers,
  azureApiKey: string,
  body: RequestInit["body"] | null | undefined,
): Headers => {
  const headers = new Headers(source);

  for (const name of Array.from(headers.keys())) {
    const lowerName = name.toLowerCase();

    if (
      HOP_BY_HOP_HEADERS.has(lowerName) ||
      lowerName === "host" ||
      lowerName === "content-length"
    ) {
      headers.delete(name);
    }
  }

  headers.set("api-key", azureApiKey);

  if (body === undefined || body === null) {
    headers.delete("content-length");
  }

  return headers;
};

const buildDownstreamResponseHeaders = (source: Headers): Headers => {
  const headers = new Headers(source);

  for (const name of Array.from(headers.keys())) {
    const lowerName = name.toLowerCase();

    if (HOP_BY_HOP_HEADERS.has(lowerName) || lowerName === "content-length") {
      headers.delete(name);
    }
  }

  return headers;
};

interface BodyCapture {
  readonly text: string;
  readonly truncated: boolean;
}

const captureBytes = (bytes: Uint8Array, maxBytes: number): BodyCapture => {
  const slice = bytes.slice(0, maxBytes);

  return {
    text: new TextDecoder().decode(slice),
    truncated: bytes.byteLength > maxBytes,
  };
};

const redactHeaders = (headers: Headers): Record<string, string> => {
  const redacted: Record<string, string> = {};

  headers.forEach((value, name) => {
    const lowerName = name.toLowerCase();
    redacted[name] = SECRET_HEADER_NAMES.has(lowerName) || lowerName.includes("secret") || lowerName.includes("token")
      ? "[redacted]"
      : value;
  });

  return redacted;
};

interface AiGatewayResponseObserverOptions {
  readonly usageId: string;
  readonly startedAt: Date;
  readonly store: CloudStore;
  readonly httpStatus: number;
  readonly captureBodies: boolean;
  readonly captureMaxBytes: number;
  readonly requestCapture: BodyCapture | null;
  readonly requestHeaders: Record<string, string>;
  readonly responseHeaders: Record<string, string>;
}

class AiGatewayResponseObserver {
  private readonly decoder = new TextDecoder();
  private readonly usageParser = new UsageStreamParser();
  private responseText = "";
  private responseTruncated = false;

  constructor(private readonly options: AiGatewayResponseObserverOptions) {}

  createTransformStream(): TransformStream<Uint8Array, Uint8Array> {
    return new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        this.observeChunk(chunk);
        controller.enqueue(chunk);
      },
      flush: () => this.finish(),
    });
  }

  private observeChunk(chunk: Uint8Array): void {
    const text = this.decoder.decode(chunk, { stream: true });
    this.usageParser.push(text);

    if (!this.options.captureBodies || this.responseTruncated) {
      return;
    }

    const next = this.responseText + text;

    if (next.length > this.options.captureMaxBytes) {
      this.responseText = next.slice(0, this.options.captureMaxBytes);
      this.responseTruncated = true;
      return;
    }

    this.responseText = next;
  }

  async finish(): Promise<void> {
    const tail = this.decoder.decode();

    if (tail.length > 0) {
      this.usageParser.push(tail);
    }

    const completedAt = new Date();
    const observed = this.usageParser.finish();

    await this.options.store.updateAiUsageRequest({
      id: this.options.usageId,
      status: this.options.httpStatus >= 400 ? "failed" : "succeeded",
      httpStatus: this.options.httpStatus,
      model: observed.model,
      inputTokens: observed.inputTokens,
      outputTokens: observed.outputTokens,
      cachedInputTokens: observed.cachedInputTokens,
      reasoningOutputTokens: observed.reasoningOutputTokens,
      totalTokens: observed.totalTokens,
      completedAt,
      durationMs: completedAt.getTime() - this.options.startedAt.getTime(),
      metadata: {
        usageParseError: observed.parseError,
      },
    });

    if (this.options.captureBodies) {
      await this.options.store.createAiUsagePayload({
        usageRequestId: this.options.usageId,
        requestHeaders: this.options.requestHeaders,
        requestBody: this.options.requestCapture?.text ?? null,
        requestBodyTruncated: this.options.requestCapture?.truncated ?? false,
        responseHeaders: this.options.responseHeaders,
        responseBody: this.responseText.length > 0 ? this.responseText : null,
        responseBodyTruncated: this.responseTruncated,
      });
    }
  }
}

interface ObservedUsage {
  readonly model: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
  readonly parseError: string | null;
}

class UsageStreamParser {
  private buffer = "";
  private model: string | null = null;
  private inputTokens = 0;
  private outputTokens = 0;
  private cachedInputTokens = 0;
  private reasoningOutputTokens = 0;
  private totalTokens = 0;
  private parseError: string | null = null;

  push(text: string): void {
    this.buffer += text;

    for (;;) {
      const separatorIndex = this.buffer.search(/\r?\n\r?\n/);

      if (separatorIndex === -1) {
        break;
      }

      const eventText = this.buffer.slice(0, separatorIndex);
      const separator = this.buffer.match(/\r?\n\r?\n/)?.[0] ?? "\n\n";
      this.buffer = this.buffer.slice(separatorIndex + separator.length);
      this.observeEvent(eventText);
    }
  }

  finish(): ObservedUsage {
    if (this.buffer.trim().length > 0) {
      this.observeEvent(this.buffer);
    }

    return {
      model: this.model,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cachedInputTokens: this.cachedInputTokens,
      reasoningOutputTokens: this.reasoningOutputTokens,
      totalTokens: this.totalTokens,
      parseError: this.parseError,
    };
  }

  private observeEvent(eventText: string): void {
    const dataLines = eventText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"));
    const data = (dataLines.length > 0
      ? dataLines.map((line) => line.slice("data:".length).trimStart()).join("\n")
      : eventText).trim();

    if (data.length === 0 || data === "[DONE]") {
      return;
    }

    try {
      this.observeJson(JSON.parse(data) as unknown);
    } catch (error) {
      this.parseError = error instanceof Error ? error.message : "Unable to parse usage event";
    }
  }

  private observeJson(value: unknown): void {
    const record = asRecord(value);
    const response = asRecord(record?.["response"]);
    const model = stringField(record, "model") ?? stringField(response, "model");
    const usage = asRecord(record?.["usage"]) ?? asRecord(response?.["usage"]);

    if (model !== undefined) {
      this.model = model;
    }

    if (usage !== undefined) {
      const parsed = readUsage(usage);
      this.inputTokens = parsed.inputTokens;
      this.outputTokens = parsed.outputTokens;
      this.cachedInputTokens = parsed.cachedInputTokens;
      this.reasoningOutputTokens = parsed.reasoningOutputTokens;
      this.totalTokens = parsed.totalTokens;
    }
  }
}

const readUsage = (usage: Record<string, unknown>) => {
  const inputTokens = numberField(usage, "input_tokens") ?? numberField(usage, "prompt_tokens") ?? 0;
  const outputTokens = numberField(usage, "output_tokens") ?? numberField(usage, "completion_tokens") ?? 0;
  const totalTokens = numberField(usage, "total_tokens") ?? inputTokens + outputTokens;
  const inputDetails = asRecord(usage["input_tokens_details"]) ?? asRecord(usage["prompt_tokens_details"]);
  const outputDetails = asRecord(usage["output_tokens_details"]) ?? asRecord(usage["completion_tokens_details"]);

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: numberField(inputDetails, "cached_tokens") ?? 0,
    reasoningOutputTokens: numberField(outputDetails, "reasoning_tokens") ?? 0,
    totalTokens,
  };
};

const extractModelFromJsonText = (text: string | null): string | null => {
  if (text === null) {
    return null;
  }

  try {
    return stringField(asRecord(JSON.parse(text) as unknown), "model") ?? null;
  } catch {
    return null;
  }
};

const failUsage = async (
  store: CloudStore,
  usage: AiUsageRequestRecord,
  startedAt: Date,
  error: unknown,
): Promise<void> => {
  const completedAt = new Date();
  await store.updateAiUsageRequest({
    id: usage.id,
    status: "failed",
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    errorMessage: error instanceof Error ? error.message : "Upstream request failed",
  });
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const stringField = (record: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
};

const numberField = (record: Record<string, unknown> | undefined, key: string): number | undefined => {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};
