import { Hono } from "hono";

import type { CloudServerConfig } from "../config.js";
import type { AiUsageRequestRecord, CloudStore } from "../db/types.js";
import { authenticateMachineToken } from "../machines/auth.js";
import { badGateway, badRequest, notFound, serviceUnavailable } from "../shared/errors.js";

const GATEWAY_PREFIX = "/llm/openai/v1";
const ANTHROPIC_GATEWAY_PREFIX = "/llm/anthropic";
const AZURE_PROVIDER = "azure";
const ANTHROPIC_PROVIDER = "anthropic";
const IMAGE_MODEL = "gpt-image-2";
const ALLOWED_ANTHROPIC_MODELS = new Set([
  "claude-sonnet-4-6",
  "claude-opus-4-8",
]);
const CODEX_TURN_METADATA_HEADER = "x-codex-turn-metadata";
const REQUEST_USER_INPUT_TOOL_NAME = "request_user_input";
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
    const requestUrl = new URL(context.req.url);
    const routeKind = readGatewayRouteKind(requestUrl);
    const azureBaseUrl = routeKind === "images"
      ? config.aiGatewayAzureImagesBaseUrl
      : config.aiGatewayAzureBaseUrl;
    const azureApiKey = config.aiGatewayAzureApiKey;

    if (azureBaseUrl === undefined || azureApiKey === undefined) {
      throw serviceUnavailable(
        "AI_GATEWAY_NOT_CONFIGURED",
        routeKind === "images" ? "AI image gateway is not configured" : "AI gateway is not configured",
      );
    }

    const startedAt = new Date();
    const machine = await authenticateMachineToken(store, config, context.req.header("api-key"));
    const computer = await store.getComputerById(machine.computerId);

    if (computer === null) {
      throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
    }

    await store.touchMachineIdentity({ identityId: machine.id, lastUsedAt: startedAt });

    const upstreamPath = buildUpstreamPath(requestUrl, routeKind);
    const upstreamUrl = buildUpstreamUrl(azureBaseUrl, requestUrl, routeKind);
    const captureBodies = config.aiGatewayCaptureBodies === true;
    const captureMaxBytes = config.aiGatewayCaptureBodyMaxBytes ?? DEFAULT_CAPTURE_BODY_MAX_BYTES;
    const removeRequestUserInputTool = shouldRemoveRequestUserInputTool(context.req.raw.headers);
    const requestBody = routeKind === "images"
      ? await readImageProxyRequestBody(context.req.raw, captureBodies, captureMaxBytes)
      : await readProxyRequestBody(
        context.req.raw,
        captureBodies,
        captureMaxBytes,
        removeRequestUserInputTool,
      );
    const usageModel = routeKind === "images" ? IMAGE_MODEL : extractModelFromJsonText(requestBody.text);
    const gatewayMetadata = {
      gatewayPath: requestUrl.pathname,
      gatewayRouteKind: routeKind,
    };
    const usage = await store.createAiUsageRequest({
      userId: computer.ownerUserId,
      computerId: computer.id,
      machineIdentityId: machine.id,
      provider: AZURE_PROVIDER,
      model: usageModel,
      method: context.req.method,
      upstreamPath,
      status: "started",
      metadata: gatewayMetadata,
      startedAt,
    });

    try {
      const upstreamRequestHeaders = routeKind === "images"
        ? buildImageUpstreamRequestHeaders(context.req.raw.headers, azureApiKey, requestBody.body)
        : buildResponsesUpstreamRequestHeaders(context.req.raw.headers, azureApiKey, requestBody.body);
      const upstreamResponse = await fetch(upstreamUrl, {
        method: context.req.method,
        headers: upstreamRequestHeaders,
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
        requestHeaders: redactHeaders(upstreamRequestHeaders),
        responseHeaders: redactHeaders(upstreamResponse.headers),
        model: usageModel,
        metadata: gatewayMetadata,
      });
      let downstreamBody: ReadableStream<Uint8Array> | null = null;

      if (upstreamResponse.body === null) {
        void observer.finish().catch((error) => {
          console.error("failed to finish AI usage logging", error);
        });
      } else {
        const [clientBody, loggingBody] = upstreamResponse.body.tee();
        downstreamBody = clientBody;
        void observer.consume(loggingBody).catch((error) => {
          console.error("failed to finish AI usage logging", error);
        });
      }

      return new Response(downstreamBody, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      await failUsage(store, usage, startedAt, error);
      throw badGateway("AI_GATEWAY_UPSTREAM_ERROR", "AI gateway upstream request failed");
    }
  });

  app.all("/anthropic/v1/messages", async (context) => {
    const requestUrl = new URL(context.req.url);
    const anthropicBaseUrl = config.aiGatewayAnthropicBaseUrl;
    const anthropicApiKey = config.aiGatewayAnthropicApiKey;
    const anthropicWorkspaceId = config.aiGatewayAnthropicWorkspaceId;

    if (
      anthropicBaseUrl === undefined ||
      anthropicApiKey === undefined ||
      anthropicWorkspaceId === undefined
    ) {
      throw serviceUnavailable("AI_GATEWAY_NOT_CONFIGURED", "Anthropic AI gateway is not configured");
    }

    const startedAt = new Date();
    const machine = await authenticateMachineToken(
      store,
      config,
      context.req.header("x-api-key") ?? context.req.header("api-key"),
    );
    const computer = await store.getComputerById(machine.computerId);

    if (computer === null) {
      throw notFound("COMPUTER_NOT_FOUND", "Computer not found");
    }

    await store.touchMachineIdentity({ identityId: machine.id, lastUsedAt: startedAt });

    const upstreamPath = buildAnthropicUpstreamPath(requestUrl);
    const upstreamUrl = buildAnthropicUpstreamUrl(anthropicBaseUrl, requestUrl);
    const captureBodies = config.aiGatewayCaptureBodies === true;
    const captureMaxBytes = config.aiGatewayCaptureBodyMaxBytes ?? DEFAULT_CAPTURE_BODY_MAX_BYTES;
    const requestBody = await readProxyRequestBody(
      context.req.raw,
      captureBodies,
      captureMaxBytes,
      false,
    );
    const usageModel = extractModelFromJsonText(requestBody.text);
    const gatewayMetadata = {
      gatewayPath: requestUrl.pathname,
      gatewayRouteKind: "anthropic-messages",
    };
    const usage = await store.createAiUsageRequest({
      userId: computer.ownerUserId,
      computerId: computer.id,
      machineIdentityId: machine.id,
      provider: ANTHROPIC_PROVIDER,
      model: usageModel,
      method: context.req.method,
      upstreamPath,
      status: "started",
      metadata: gatewayMetadata,
      startedAt,
    });

    if (usageModel === null || !ALLOWED_ANTHROPIC_MODELS.has(usageModel)) {
      const error = new Error(`Anthropic model is not allowed: ${usageModel ?? "missing"}`);
      await failUsage(store, usage, startedAt, error);
      throw badRequest("ANTHROPIC_MODEL_NOT_ALLOWED", "Anthropic model is not allowed");
    }

    try {
      const upstreamRequestHeaders = buildAnthropicUpstreamRequestHeaders(
        context.req.raw.headers,
        anthropicApiKey,
        anthropicWorkspaceId,
        requestBody.body,
      );
      const upstreamResponse = await fetch(upstreamUrl, {
        method: context.req.method,
        headers: upstreamRequestHeaders,
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
        requestHeaders: redactHeaders(upstreamRequestHeaders),
        responseHeaders: redactHeaders(upstreamResponse.headers),
        model: usageModel,
        metadata: gatewayMetadata,
      });
      let downstreamBody: ReadableStream<Uint8Array> | null = null;

      if (upstreamResponse.body === null) {
        void observer.finish().catch((error) => {
          console.error("failed to finish AI usage logging", error);
        });
      } else {
        const [clientBody, loggingBody] = upstreamResponse.body.tee();
        downstreamBody = clientBody;
        void observer.consume(loggingBody).catch((error) => {
          console.error("failed to finish AI usage logging", error);
        });
      }

      return new Response(downstreamBody, {
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

type GatewayRouteKind = "responses" | "compact" | "images";

const readGatewayRouteKind = (requestUrl: URL): GatewayRouteKind => {
  const suffix = buildUpstreamPath(new URL(`${requestUrl.origin}${requestUrl.pathname}`));

  if (suffix === "/responses/compact") {
    return "compact";
  }

  return suffix.startsWith("/images/") ? "images" : "responses";
};

const buildUpstreamPath = (requestUrl: URL, routeKind?: GatewayRouteKind): string => {
  const suffix = requestUrl.pathname.startsWith(GATEWAY_PREFIX)
    ? requestUrl.pathname.slice(GATEWAY_PREFIX.length)
    : requestUrl.pathname;
  const normalizedSuffix = suffix.length === 0 ? "/" : suffix;

  return `${normalizedSuffix}${routeKind === "compact" ? "" : requestUrl.search}`;
};

const buildUpstreamUrl = (configuredUrl: string, requestUrl: URL, routeKind: GatewayRouteKind): string => {
  const upstreamUrl = new URL(configuredUrl);
  const suffixPath = buildUpstreamPath(new URL(`${requestUrl.origin}${requestUrl.pathname}`), routeKind);
  const normalizedSuffix = suffixPath.replace(/^\/+/, "");
  const configuredPath = upstreamUrl.pathname.replace(/\/+$/, "");

  if (routeKind === "compact" && configuredPath.endsWith("/responses")) {
    upstreamUrl.pathname = buildCompactUpstreamPath(configuredPath);
  } else if (!configuredPath.endsWith(`/${normalizedSuffix}`)) {
    upstreamUrl.pathname = `${configuredPath}/${normalizedSuffix}`.replace(/\/{2,}/g, "/");
  }

  if (routeKind === "compact") {
    upstreamUrl.search = "";
  } else {
    for (const [key, value] of requestUrl.searchParams.entries()) {
      upstreamUrl.searchParams.set(key, value);
    }
  }

  return upstreamUrl.toString();
};

const buildAnthropicUpstreamPath = (requestUrl: URL): string => {
  const suffix = requestUrl.pathname.startsWith(ANTHROPIC_GATEWAY_PREFIX)
    ? requestUrl.pathname.slice(ANTHROPIC_GATEWAY_PREFIX.length)
    : requestUrl.pathname;
  const normalizedSuffix = suffix.length === 0 ? "/" : suffix;

  return `${normalizedSuffix}${requestUrl.search}`;
};

const buildAnthropicUpstreamUrl = (configuredUrl: string, requestUrl: URL): string => {
  const upstreamUrl = new URL(configuredUrl);
  const suffixPath = buildAnthropicUpstreamPath(new URL(`${requestUrl.origin}${requestUrl.pathname}`));
  const normalizedSuffix = suffixPath.replace(/^\/+/, "");
  const configuredPath = upstreamUrl.pathname.replace(/\/+$/, "");
  let appendPath = normalizedSuffix;

  if (configuredPath.endsWith(`/${normalizedSuffix}`)) {
    appendPath = "";
  } else if (configuredPath.endsWith("/v1") && normalizedSuffix.startsWith("v1/")) {
    appendPath = normalizedSuffix.slice("v1/".length);
  }

  if (appendPath.length > 0) {
    upstreamUrl.pathname = `${configuredPath}/${appendPath}`.replace(/\/{2,}/g, "/");
  }

  for (const [key, value] of requestUrl.searchParams.entries()) {
    upstreamUrl.searchParams.set(key, value);
  }

  return upstreamUrl.toString();
};

const buildCompactUpstreamPath = (configuredPath: string): string => {
  if (configuredPath.endsWith("/openai/responses")) {
    return configuredPath.replace(/\/openai\/responses$/, "/openai/v1/responses/compact");
  }

  return `${configuredPath}/compact`.replace(/\/{2,}/g, "/");
};

const readProxyRequestBody = async (
  request: Request,
  captureBodies: boolean,
  maxBytes: number,
  removeRequestUserInputTool: boolean,
): Promise<{
  readonly body: RequestInit["body"] | null | undefined;
  readonly text: string | null;
  readonly capture: BodyCapture | null;
}> => {
  if (["GET", "HEAD"].includes(request.method)) {
    return { body: undefined, text: null, capture: null };
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!captureBodies && !contentType.includes("application/json")) {
    return { body: request.body, text: null, capture: null };
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  const capture = captureBodies ? captureBytes(bytes, maxBytes) : null;
  const text = new TextDecoder().decode(bytes);
  const normalizedText = contentType.includes("application/json") && removeRequestUserInputTool
    ? removeRequestUserInputToolFromJsonText(text)
    : null;
  const upstreamText = normalizedText ?? text;

  return {
    body: normalizedText ?? bytes,
    text: upstreamText,
    capture: captureBodies
      ? normalizedText === null ? capture : captureText(normalizedText, maxBytes)
      : null,
  };
};

const shouldRemoveRequestUserInputTool = (headers: Headers): boolean => {
  const rawMetadata = headers.get(CODEX_TURN_METADATA_HEADER);

  if (rawMetadata === null) {
    return false;
  }

  try {
    const parsed = JSON.parse(rawMetadata) as unknown;
    const metadata = asRecord(parsed);
    return isTruthyMetadataFlag(metadata?.["remove_request_user_input"]);
  } catch {
    return false;
  }
};

const isTruthyMetadataFlag = (value: unknown): boolean => value === true || value === "true";

const removeRequestUserInputToolFromJsonText = (text: string): string | null => {
  try {
    const parsed = JSON.parse(text) as unknown;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const requestBody = parsed as Record<string, unknown>;
    const tools = requestBody["tools"];

    if (!Array.isArray(tools)) {
      return null;
    }

    const filteredTools = tools.filter((tool) => {
      const toolRecord = asRecord(tool);
      return toolRecord?.["name"] !== REQUEST_USER_INPUT_TOOL_NAME;
    });

    if (filteredTools.length === tools.length) {
      return null;
    }

    return JSON.stringify({
      ...requestBody,
      tools: filteredTools,
    });
  } catch {
    return null;
  }
};

const readImageProxyRequestBody = async (
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

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("multipart/form-data")) {
    const sourceForm = await request.formData();
    const normalizedForm = new FormData();

    for (const [key, value] of sourceForm.entries()) {
      if (key === "model") {
        continue;
      }

      normalizedForm.append(key === "image[]" ? "image" : key, value);
    }

    return {
      body: normalizedForm,
      text: null,
      capture: captureBodies
        ? { text: "[multipart form-data omitted]", truncated: false }
        : null,
    };
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  const capture = captureBodies ? captureBytes(bytes, maxBytes) : null;
  const text = new TextDecoder().decode(bytes);

  if (contentType.includes("application/json")) {
    const normalizedText = stripModelFromJsonObject(text);

    return {
      body: normalizedText,
      text: normalizedText,
      capture: captureBodies ? captureText(normalizedText, maxBytes) : capture,
    };
  }

  return {
    body: bytes,
    text: capture?.text ?? null,
    capture,
  };
};

const stripModelFromJsonObject = (text: string): string => {
  try {
    const parsed = JSON.parse(text) as unknown;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return text;
    }

    const normalized = { ...(parsed as Record<string, unknown>) };
    delete normalized["model"];
    return JSON.stringify(normalized);
  } catch {
    return text;
  }
};

const buildResponsesUpstreamRequestHeaders = (
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

const buildImageUpstreamRequestHeaders = (
  source: Headers,
  azureApiKey: string,
  body: RequestInit["body"] | null | undefined,
): Headers => {
  const headers = new Headers(source);

  for (const name of Array.from(headers.keys())) {
    const lowerName = name.toLowerCase();

    if (
      HOP_BY_HOP_HEADERS.has(lowerName) ||
      SECRET_HEADER_NAMES.has(lowerName) ||
      lowerName === "host" ||
      lowerName === "content-length" ||
      (lowerName === "content-type" && body instanceof FormData)
    ) {
      headers.delete(name);
    }
  }

  headers.set("authorization", `Bearer ${azureApiKey}`);

  if (body === undefined || body === null) {
    headers.delete("content-length");
  }

  return headers;
};

const buildAnthropicUpstreamRequestHeaders = (
  source: Headers,
  anthropicApiKey: string,
  anthropicWorkspaceId: string,
  body: RequestInit["body"] | null | undefined,
): Headers => {
  const headers = new Headers(source);

  for (const name of Array.from(headers.keys())) {
    const lowerName = name.toLowerCase();

    if (
      HOP_BY_HOP_HEADERS.has(lowerName) ||
      SECRET_HEADER_NAMES.has(lowerName) ||
      lowerName === "host" ||
      lowerName === "content-length" ||
      lowerName === "anthropic-dangerous-direct-browser-access"
    ) {
      headers.delete(name);
    }
  }

  headers.set("x-api-key", anthropicApiKey);
  headers.set("anthropic-workspace-id", anthropicWorkspaceId);

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

const captureText = (text: string, maxBytes: number): BodyCapture => {
  return captureBytes(new TextEncoder().encode(text), maxBytes);
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
  readonly model: string | null;
  readonly metadata: Record<string, unknown>;
}

class AiGatewayResponseObserver {
  private readonly decoder = new TextDecoder();
  private readonly usageParser = new UsageStreamParser();
  private responseText = "";
  private responseTruncated = false;

  constructor(private readonly options: AiGatewayResponseObserverOptions) {}

  async consume(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();

    try {
      for (;;) {
        const next = await reader.read();

        if (next.done) {
          break;
        }

        this.observeChunk(next.value);
      }

      await this.finish();
    } catch (error) {
      await this.fail(error);
    } finally {
      reader.releaseLock();
    }
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
    const failed = this.options.httpStatus >= 400;

    await this.options.store.updateAiUsageRequest({
      id: this.options.usageId,
      status: failed ? "failed" : "succeeded",
      httpStatus: this.options.httpStatus,
      model: observed.model ?? this.options.model,
      inputTokens: observed.inputTokens,
      outputTokens: observed.outputTokens,
      cachedInputTokens: observed.cachedInputTokens,
      reasoningOutputTokens: observed.reasoningOutputTokens,
      totalTokens: observed.totalTokens,
      completedAt,
      durationMs: completedAt.getTime() - this.options.startedAt.getTime(),
      errorMessage: failed
        ? observed.errorMessage ?? `Upstream request failed with HTTP ${String(this.options.httpStatus)}`
        : null,
      metadata: {
        ...this.options.metadata,
        ...(observed.rawUsage !== undefined ? { upstreamUsage: observed.rawUsage } : {}),
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

  private async fail(error: unknown): Promise<void> {
    const completedAt = new Date();
    const observed = this.usageParser.finish();

    await this.options.store.updateAiUsageRequest({
      id: this.options.usageId,
      status: "failed",
      httpStatus: this.options.httpStatus,
      model: observed.model ?? this.options.model,
      inputTokens: observed.inputTokens,
      outputTokens: observed.outputTokens,
      cachedInputTokens: observed.cachedInputTokens,
      reasoningOutputTokens: observed.reasoningOutputTokens,
      totalTokens: observed.totalTokens,
      completedAt,
      durationMs: completedAt.getTime() - this.options.startedAt.getTime(),
      errorMessage: error instanceof Error ? error.message : "Upstream response stream failed",
      metadata: {
        ...this.options.metadata,
        ...(observed.rawUsage !== undefined ? { upstreamUsage: observed.rawUsage } : {}),
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
  readonly rawUsage: Record<string, unknown> | undefined;
  readonly errorMessage: string | null;
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
  private rawUsage: Record<string, unknown> | undefined;
  private errorMessage: string | null = null;
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
      this.buffer = "";
    }

    return {
      model: this.model,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cachedInputTokens: this.cachedInputTokens,
      reasoningOutputTokens: this.reasoningOutputTokens,
      totalTokens: this.totalTokens,
      rawUsage: this.rawUsage,
      errorMessage: this.errorMessage,
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
    const message = asRecord(record?.["message"]);
    const response = asRecord(record?.["response"]);
    const model = stringField(record, "model") ?? stringField(message, "model") ?? stringField(response, "model");
    const usage = asRecord(record?.["usage"]) ?? asRecord(message?.["usage"]) ?? asRecord(response?.["usage"]);
    const error = asRecord(record?.["error"]) ?? asRecord(message?.["error"]) ?? asRecord(response?.["error"]);

    if (model !== undefined) {
      this.model = model;
    }

    const errorMessage = stringField(error, "message") ?? stringField(error, "code");
    if (errorMessage !== undefined) {
      this.errorMessage = errorMessage;
    }

    if (usage !== undefined) {
      this.observeUsage(usage);
    }
  }

  private observeUsage(usage: Record<string, unknown>): void {
    const inputDetails = asRecord(usage["input_tokens_details"]) ?? asRecord(usage["prompt_tokens_details"]);
    const outputDetails = asRecord(usage["output_tokens_details"]) ?? asRecord(usage["completion_tokens_details"]);
    const anthropicCacheCreationTokens = readAnthropicCacheCreationTokens(usage);
    const anthropicCacheReadTokens = numberField(usage, "cache_read_input_tokens");
    const hasAnthropicCacheFields =
      usage["cache_creation_input_tokens"] !== undefined ||
      usage["cache_read_input_tokens"] !== undefined ||
      usage["cache_creation"] !== undefined;
    const inputTokens = numberField(usage, "input_tokens") ?? numberField(usage, "prompt_tokens");
    const outputTokens = numberField(usage, "output_tokens") ?? numberField(usage, "completion_tokens");
    const reasoningOutputTokens = numberField(outputDetails, "reasoning_tokens");

    if (inputTokens !== undefined || hasAnthropicCacheFields) {
      this.inputTokens = hasAnthropicCacheFields
        ? (inputTokens ?? 0) + anthropicCacheCreationTokens + (anthropicCacheReadTokens ?? 0)
        : inputTokens ?? 0;
      this.cachedInputTokens = hasAnthropicCacheFields
        ? anthropicCacheReadTokens ?? 0
        : numberField(inputDetails, "cached_tokens") ?? 0;
    }

    if (outputTokens !== undefined) {
      this.outputTokens = outputTokens;
    }

    if (reasoningOutputTokens !== undefined) {
      this.reasoningOutputTokens = reasoningOutputTokens;
    }

    this.totalTokens = numberField(usage, "total_tokens") ?? this.inputTokens + this.outputTokens;
    this.rawUsage = { ...(this.rawUsage ?? {}), ...usage };
  }
}

const readAnthropicCacheCreationTokens = (usage: Record<string, unknown>): number => {
  const legacyCacheCreationTokens = numberField(usage, "cache_creation_input_tokens");

  if (legacyCacheCreationTokens !== undefined) {
    return legacyCacheCreationTokens;
  }

  const cacheCreation = asRecord(usage["cache_creation"]);
  return (numberField(cacheCreation, "ephemeral_5m_input_tokens") ?? 0) +
    (numberField(cacheCreation, "ephemeral_1h_input_tokens") ?? 0);
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
