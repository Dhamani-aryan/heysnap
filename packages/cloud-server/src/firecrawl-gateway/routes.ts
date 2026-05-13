import { Hono } from "hono";

import type { CloudServerConfig } from "../config.js";
import type { CloudStore } from "../db/types.js";
import { authenticateMachineBearer, authenticateMachineToken } from "../machines/auth.js";
import { badGateway, serviceUnavailable } from "../shared/errors.js";

const GATEWAY_PREFIX = "/firecrawl";
const DEFAULT_FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
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

export const createFirecrawlGatewayRoutes = (
  store: CloudStore,
  config: CloudServerConfig,
): Hono => {
  const app = new Hono();

  app.all("/", async (context) => proxyFirecrawlRequest(context.req.raw, store, config));
  app.all("/*", async (context) => proxyFirecrawlRequest(context.req.raw, store, config));

  return app;
};

const proxyFirecrawlRequest = async (
  request: Request,
  store: CloudStore,
  config: CloudServerConfig,
): Promise<Response> => {
  const firecrawlApiKey = config.firecrawlApiKey;

  if (firecrawlApiKey === undefined) {
    throw serviceUnavailable("FIRECRAWL_GATEWAY_NOT_CONFIGURED", "Firecrawl gateway is not configured");
  }

  const machine = request.headers.has("api-key")
    ? await authenticateMachineToken(store, config, request.headers.get("api-key") ?? undefined)
    : await authenticateMachineBearer(store, config, request.headers.get("authorization") ?? undefined);
  await store.touchMachineIdentity({ identityId: machine.id, lastUsedAt: new Date() });

  try {
    const upstreamResponse = await fetch(buildFirecrawlUpstreamUrl(
      config.firecrawlBaseUrl ?? DEFAULT_FIRECRAWL_BASE_URL,
      new URL(request.url),
    ), {
      method: request.method,
      headers: buildFirecrawlUpstreamRequestHeaders(request.headers, firecrawlApiKey, request.body),
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      ...(["GET", "HEAD"].includes(request.method) ? {} : { duplex: "half" as const }),
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: buildDownstreamResponseHeaders(upstreamResponse.headers),
    });
  } catch {
    throw badGateway("FIRECRAWL_GATEWAY_UPSTREAM_ERROR", "Firecrawl gateway upstream request failed");
  }
};

const buildFirecrawlUpstreamUrl = (configuredUrl: string, requestUrl: URL): string => {
  const upstreamUrl = new URL(configuredUrl);
  const suffixPath = buildFirecrawlUpstreamPath(requestUrl);
  const normalizedSuffix = suffixPath.replace(/^\/+/, "");
  const configuredPath = upstreamUrl.pathname.replace(/\/+$/, "");
  const normalizedConfiguredPath = configuredPath.replace(/^\/+/, "");

  if (
    normalizedSuffix.length > 0 &&
    normalizedConfiguredPath.length > 0 &&
    (normalizedSuffix === normalizedConfiguredPath || normalizedSuffix.startsWith(`${normalizedConfiguredPath}/`))
  ) {
    upstreamUrl.pathname = `/${normalizedSuffix}`;
  } else if (normalizedSuffix.length > 0 && !configuredPath.endsWith(`/${normalizedSuffix}`)) {
    upstreamUrl.pathname = `${configuredPath}/${normalizedSuffix}`.replace(/\/{2,}/g, "/");
  }

  for (const [key, value] of requestUrl.searchParams.entries()) {
    upstreamUrl.searchParams.set(key, value);
  }

  return upstreamUrl.toString();
};

const buildFirecrawlUpstreamPath = (requestUrl: URL): string => {
  const suffix = requestUrl.pathname.startsWith(GATEWAY_PREFIX)
    ? requestUrl.pathname.slice(GATEWAY_PREFIX.length)
    : requestUrl.pathname;

  return suffix.length === 0 ? "/" : suffix;
};

const buildFirecrawlUpstreamRequestHeaders = (
  source: Headers,
  firecrawlApiKey: string,
  body: ReadableStream<Uint8Array> | null,
): Headers => {
  const headers = new Headers(source);

  for (const name of Array.from(headers.keys())) {
    const lowerName = name.toLowerCase();

    if (
      HOP_BY_HOP_HEADERS.has(lowerName) ||
      SECRET_HEADER_NAMES.has(lowerName) ||
      lowerName === "host" ||
      lowerName === "content-length"
    ) {
      headers.delete(name);
    }
  }

  headers.set("authorization", `Bearer ${firecrawlApiKey}`);

  if (body === null) {
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
