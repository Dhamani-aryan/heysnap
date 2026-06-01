import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

import { createAdminRoutes } from "./admin/routes.js";
import { createAgentSessionMachineRoutes } from "./agent-sessions/routes.js";
import {
  FileAgentSessionObjectStorage,
  S3AgentSessionObjectStorage,
  type AgentSessionObjectStorage,
} from "./agent-sessions/storage.js";
import { createAiGatewayRoutes } from "./ai-gateway/routes.js";
import { AuthService } from "./auth/service.js";
import { createAuthRoutes } from "./auth/routes.js";
import type { CloudServerConfig } from "./config.js";
import { createComputerRoutes } from "./control-plane/computers.js";
import { createDiagnosticsRoutes } from "./diagnostics/routes.js";
import type { CloudStore } from "./db/types.js";
import { createFirecrawlGatewayRoutes } from "./firecrawl-gateway/routes.js";
import { GatewayAccessService, hasAccessScope, type GatewayAccessScope } from "./gateway/access-sessions.js";
import { createMachineRoutes } from "./machines/routes.js";
import { AwsEc2Provisioner } from "./provisioning/aws-ec2-provisioner.js";
import type { ComputerProvisioner } from "./provisioning/types.js";
import { createReleaseRoutes } from "./releases/routes.js";
import { createSarvamGatewayRoutes } from "./sarvam-gateway/routes.js";
import { HttpError } from "./shared/errors.js";
import { errorToLog, logger } from "./shared/logger.js";
import type { AppVariables } from "./shared/context.js";
import type { GatewayHttpResponse, GatewayHttpStreamResponse, TunnelStatusRegistry } from "./gateway/tunnel.js";

export type { TunnelStatusRegistry } from "./gateway/tunnel.js";

const PREVIEW_ACCESS_COOKIE_NAME = "heysnap_preview_access";
const PREVIEW_PUBLIC_BASE_PATH_HEADER = "x-heysnap-preview-public-base-path";
const FILESYSTEM_UPLOAD_CHUNK_LIMIT_BYTES = 4 * 1024 * 1024;

export interface CreateAppOptions {
  readonly store: CloudStore;
  readonly config: CloudServerConfig;
  readonly provisioner?: ComputerProvisioner;
  readonly tunnelRegistry?: TunnelStatusRegistry;
  readonly agentSessionStorage?: AgentSessionObjectStorage;
}

const noopTunnelRegistry: TunnelStatusRegistry = {
  isConnected: () => false,
};

export const createApp = (options: CreateAppOptions): Hono<{ Variables: AppVariables }> => {
  const app = new Hono<{ Variables: AppVariables }>();
  const authService = new AuthService(options.store, options.config);
  const gatewayAccessService = new GatewayAccessService(options.store, options.config);
  const provisioner = options.provisioner ?? new AwsEc2Provisioner();
  const tunnelRegistry = options.tunnelRegistry ?? noopTunnelRegistry;
  const agentSessionStorage = options.agentSessionStorage ?? createAgentSessionObjectStorage(options.config);

  app.use("*", cors({
    origin: (origin) => {
      if (options.config.allowedOrigins.includes("*")) {
        return origin;
      }

      return options.config.allowedOrigins.includes(origin) ? origin : null;
    },
    allowHeaders: ["Authorization", "Content-Type", "Last-Event-ID"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Disposition", "Content-Length", "Content-Range"],
    maxAge: 600,
  }));

  app.get("/health", (context) => context.json({ ok: true }));
  mountAdminDashboard(app);
  app.route("/admin", createAdminRoutes(
    options.store,
    authService,
    options.config,
    provisioner,
    tunnelRegistry,
    agentSessionStorage,
  ));
  app.route("/auth", createAuthRoutes(authService, options.config));
  app.route("/diagnostics", createDiagnosticsRoutes(authService));
  app.route("/computers", createComputerRoutes(
    options.store,
    authService,
    gatewayAccessService,
    provisioner,
    options.config,
    tunnelRegistry,
  ));
  app.get("/gateway/computers/:computerId/filesystem/download", async (context) => {
    return await proxyGatewayFilesystemHttpRequest(
      context,
      gatewayAccessService,
      tunnelRegistry,
      "/filesystem/download",
    );
  });
  app.all("/gateway/computers/:computerId/filesystem/uploads", async (context) => {
    return await proxyGatewayFilesystemUploadRequest(context, gatewayAccessService, tunnelRegistry);
  });
  app.all("/gateway/computers/:computerId/filesystem/uploads/*", async (context) => {
    return await proxyGatewayFilesystemUploadRequest(context, gatewayAccessService, tunnelRegistry);
  });
  app.get("/gateway/computers/:computerId/preview", async (context) => {
    return await proxyGatewayPreviewHttpRequest(context, gatewayAccessService, tunnelRegistry);
  });
  app.get("/gateway/computers/:computerId/preview/*", async (context) => {
    return await proxyGatewayPreviewHttpRequest(context, gatewayAccessService, tunnelRegistry);
  });
  app.all("/gateway/computers/:computerId/capabilities", async (context) => {
    return await proxyGatewayCapabilitiesHttpRequest(context, gatewayAccessService, tunnelRegistry);
  });
  app.all("/gateway/computers/:computerId/capabilities/*", async (context) => {
    return await proxyGatewayCapabilitiesHttpRequest(context, gatewayAccessService, tunnelRegistry);
  });
  app.all("/gateway/computers/:computerId/agent/*", async (context) => {
    return await proxyGatewayAgentHttpRequest(context, gatewayAccessService, tunnelRegistry);
  });
  app.route("/machines/agent-sessions", createAgentSessionMachineRoutes(
    options.store,
    options.config,
    agentSessionStorage,
  ));
  app.route("/machines", createMachineRoutes(options.store, options.config, provisioner));
  app.route("/llm", createAiGatewayRoutes(options.store, options.config));
  app.route("/firecrawl", createFirecrawlGatewayRoutes(options.store, options.config));
  app.route("/sarvam", createSarvamGatewayRoutes(authService, options.config));
  app.route("/releases", createReleaseRoutes(options.store));

  app.notFound((context) => context.json({
    error: {
      code: "NOT_FOUND",
      message: "Not found",
    },
  }, 404));

  app.onError((error, context) => {
    if (error instanceof HttpError) {
      return context.json({
        error: {
          code: error.code,
          message: error.message,
        },
      }, error.status);
    }

    logger.error({
      event: "cloud.http_error",
      err: errorToLog(error),
      method: context.req.method,
      path: context.req.path,
    }, "Unhandled cloud-server error");

    return context.json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    }, 500);
  });

  return app;
};

const createAgentSessionObjectStorage = (
  config: CloudServerConfig,
): AgentSessionObjectStorage | undefined => {
  if (config.agentSessionStorageBucket === undefined) {
    return config.agentSessionStorageDirectory === undefined
      ? undefined
      : new FileAgentSessionObjectStorage(config.agentSessionStorageDirectory);
  }

  return new S3AgentSessionObjectStorage({
    bucket: config.agentSessionStorageBucket,
    region: config.awsRegion,
    kmsKeyId: config.agentSessionStorageKmsKeyId,
  });
};

const proxyGatewayFilesystemHttpRequest = async (
  context: Context<{ Variables: AppVariables }>,
  gatewayAccessService: GatewayAccessService,
  tunnelRegistry: TunnelStatusRegistry,
  targetPathname: "/filesystem/download",
): Promise<Response> => {
  const auth = await authenticateGatewayHttpRequest(context, gatewayAccessService, "filesystem:download");
  if (auth instanceof Response) {
    return auth;
  }
  const { computerId, requestUrl } = auth;

  if (tunnelRegistry.proxyStreamingHttpRequest === undefined) {
    return context.json({ error: { code: "TUNNEL_UNAVAILABLE", message: "Machine tunnel is not connected" } }, 503);
  }

  const proxied = await tunnelRegistry.proxyStreamingHttpRequest(computerId, {
    path: buildFilesystemProxyTargetPath(requestUrl, targetPathname),
    trafficClass: "filesystem:download",
  });

  if (proxied === null) {
    return context.json({ error: { code: "TUNNEL_UNAVAILABLE", message: "Machine tunnel is not connected" } }, 503);
  }

  return toGatewayDownloadStreamResponse(proxied);
};

const proxyGatewayFilesystemUploadRequest = async (
  context: Context<{ Variables: AppVariables }>,
  gatewayAccessService: GatewayAccessService,
  tunnelRegistry: TunnelStatusRegistry,
): Promise<Response> => {
  const auth = await authenticateGatewayHttpRequest(context, gatewayAccessService, "filesystem:upload");
  if (auth instanceof Response) {
    return auth;
  }
  const { computerId, requestUrl } = auth;

  if (tunnelRegistry.proxyHttpRequest === undefined) {
    return context.json({ error: { code: "TUNNEL_UNAVAILABLE", message: "Machine tunnel is not connected" } }, 503);
  }

  const isChunkUpload = context.req.method === "PATCH" && requestUrl.pathname.includes("/files/");
  const contentLength = readContentLength(context);

  if (isChunkUpload && contentLength !== undefined && contentLength > FILESYSTEM_UPLOAD_CHUNK_LIMIT_BYTES) {
    return context.json({ error: { code: "UPLOAD_CHUNK_TOO_LARGE", message: "Upload chunks cannot exceed 4 MiB" } }, 413);
  }

  const body = await readProxyRequestBody(context);

  if (isChunkUpload && body !== undefined && body.byteLength > FILESYSTEM_UPLOAD_CHUNK_LIMIT_BYTES) {
    return context.json({ error: { code: "UPLOAD_CHUNK_TOO_LARGE", message: "Upload chunks cannot exceed 4 MiB" } }, 413);
  }

  const proxied = await tunnelRegistry.proxyHttpRequest(computerId, {
    path: buildFilesystemUploadProxyTargetPath(computerId, requestUrl),
    method: context.req.method,
    headers: getForwardedUploadHeaders(context),
    body,
    trafficClass: "filesystem:upload",
  });

  if (proxied === null) {
    return context.json({ error: { code: "TUNNEL_UNAVAILABLE", message: "Machine tunnel is not connected" } }, 503);
  }

  return toGatewayUploadResponse(proxied);
};

const proxyGatewayPreviewHttpRequest = async (
  context: Context<{ Variables: AppVariables }>,
  gatewayAccessService: GatewayAccessService,
  tunnelRegistry: TunnelStatusRegistry,
): Promise<Response> => {
  const auth = await authenticateGatewayHttpRequest(context, gatewayAccessService, "preview:http", { allowPreviewCookie: true });
  if (auth instanceof Response) {
    return auth;
  }
  const { computerId, requestUrl, queryToken, token } = auth;

  if (tunnelRegistry.proxyHttpRequest === undefined) {
    return context.json({ error: { code: "TUNNEL_UNAVAILABLE", message: "Machine tunnel is not connected" } }, 503);
  }

  const proxied = await tunnelRegistry.proxyHttpRequest(computerId, {
    path: buildPreviewProxyTargetPath(computerId, requestUrl),
    headers: {
      [PREVIEW_PUBLIC_BASE_PATH_HEADER]: buildPreviewGatewayBasePath(computerId),
    },
    trafficClass: "preview:http",
  });

  if (proxied === null) {
    return context.json({ error: { code: "TUNNEL_UNAVAILABLE", message: "Machine tunnel is not connected" } }, 503);
  }

  return toGatewayPreviewResponse(proxied, queryToken !== undefined && token === queryToken ? {
    cookie: buildPreviewAccessCookie({
      computerId,
      token: queryToken,
      secure: isSecureRequest(context, requestUrl),
    }),
  } : undefined);
};

const proxyGatewayAgentHttpRequest = async (
  context: Context<{ Variables: AppVariables }>,
  gatewayAccessService: GatewayAccessService,
  tunnelRegistry: TunnelStatusRegistry,
): Promise<Response> => {
  const auth = await authenticateGatewayHttpRequest(context, gatewayAccessService, "agent:http");
  if (auth instanceof Response) {
    return auth;
  }
  const { computerId, requestUrl } = auth;

  if (tunnelRegistry.proxyStreamingHttpRequest === undefined) {
    return context.json({ error: { code: "TUNNEL_UNAVAILABLE", message: "Machine tunnel is not connected" } }, 503);
  }

  const proxied = await tunnelRegistry.proxyStreamingHttpRequest(computerId, {
    path: buildAgentProxyTargetPath(computerId, requestUrl),
    method: context.req.method,
    headers: getForwardedAgentHeaders(context),
    body: await readProxyRequestBody(context),
    trafficClass: "agent:http",
  });

  if (proxied === null) {
    return context.json({ error: { code: "TUNNEL_UNAVAILABLE", message: "Machine tunnel is not connected" } }, 503);
  }

  return toGatewayAgentResponse(proxied);
};

const proxyGatewayCapabilitiesHttpRequest = async (
  context: Context<{ Variables: AppVariables }>,
  gatewayAccessService: GatewayAccessService,
  tunnelRegistry: TunnelStatusRegistry,
): Promise<Response> => {
  const auth = await authenticateGatewayHttpRequest(context, gatewayAccessService, "capabilities:http");
  if (auth instanceof Response) {
    return auth;
  }
  const { computerId, requestUrl } = auth;

  if (tunnelRegistry.proxyHttpRequest === undefined) {
    return context.json({ error: { code: "TUNNEL_UNAVAILABLE", message: "Machine tunnel is not connected" } }, 503);
  }

  const proxied = await tunnelRegistry.proxyHttpRequest(computerId, {
    path: buildCapabilitiesProxyTargetPath(computerId, requestUrl),
    method: context.req.method,
    headers: getForwardedCapabilitiesHeaders(context),
    body: await readProxyRequestBody(context),
    trafficClass: "capabilities:http",
  });

  if (proxied === null) {
    return context.json({ error: { code: "TUNNEL_UNAVAILABLE", message: "Machine tunnel is not connected" } }, 503);
  }

  return toGatewayCapabilitiesResponse(proxied);
};

const authenticateGatewayHttpRequest = async (
  context: Context<{ Variables: AppVariables }>,
  gatewayAccessService: GatewayAccessService,
  requiredScope: GatewayAccessScope,
  options: { readonly allowPreviewCookie?: boolean } = {},
): Promise<Response | {
  readonly computerId: string;
  readonly requestUrl: URL;
  readonly token: string;
  readonly queryToken?: string;
}> => {
  const computerId = context.req.param("computerId");
  const requestUrl = new URL(context.req.url);

  if (computerId === undefined || computerId.length === 0) {
    return context.json({ error: { code: "NOT_FOUND", message: "Computer not found" } }, 404);
  }

  const queryToken = requestUrl.searchParams.get("accessToken")
    ?? requestUrl.searchParams.get("token")
    ?? undefined;
  const token = readBearerToken(context.req.header("authorization"))
    ?? queryToken
    ?? (options.allowPreviewCookie === true ? readCookie(context.req.header("cookie"), PREVIEW_ACCESS_COOKIE_NAME) : undefined)
    ?? undefined;

  if (token === undefined || token.length === 0) {
    return context.json({ error: { code: "UNAUTHORIZED", message: "Gateway access token is required" } }, 401);
  }

  const accessSession = await gatewayAccessService.authenticateAccessToken({ token, computerId });

  if (accessSession === null) {
    return context.json({ error: { code: "UNAUTHORIZED", message: "Invalid gateway access token" } }, 401);
  }

  if (!hasAccessScope(accessSession, requiredScope)) {
    return context.json({ error: { code: "FORBIDDEN", message: "Gateway access token does not allow this route" } }, 403);
  }

  return { computerId, requestUrl, token, queryToken };
};

const buildFilesystemProxyTargetPath = (
  requestUrl: URL,
  targetPathname: "/filesystem/download",
): string => {
  const query = new URLSearchParams(requestUrl.searchParams);
  query.delete("accessToken");
  query.delete("token");
  const queryString = query.toString();

  return `${targetPathname}${queryString.length > 0 ? `?${queryString}` : ""}`;
};

const buildFilesystemUploadProxyTargetPath = (computerId: string, requestUrl: URL): string => {
  const prefix = `/gateway/computers/${encodeURIComponent(computerId)}/filesystem/uploads`;
  const suffix = requestUrl.pathname.startsWith(prefix)
    ? requestUrl.pathname.slice(prefix.length)
    : "";
  const query = new URLSearchParams(requestUrl.searchParams);
  query.delete("accessToken");
  query.delete("token");
  const queryString = query.toString();

  return `/filesystem/uploads${suffix}${queryString.length > 0 ? `?${queryString}` : ""}`;
};

const buildPreviewProxyTargetPath = (computerId: string, requestUrl: URL): string => {
  const prefix = buildPreviewGatewayBasePath(computerId);
  const suffix = requestUrl.pathname.startsWith(prefix)
    ? requestUrl.pathname.slice(prefix.length)
    : "";
  const query = new URLSearchParams(requestUrl.searchParams);
  query.delete("accessToken");
  query.delete("token");
  const queryString = query.toString();

  return `/preview${suffix}${queryString.length > 0 ? `?${queryString}` : ""}`;
};

const buildPreviewGatewayBasePath = (computerId: string): string =>
  `/gateway/computers/${encodeURIComponent(computerId)}/preview`;

const buildAgentProxyTargetPath = (computerId: string, requestUrl: URL): string => {
  const prefix = `/gateway/computers/${encodeURIComponent(computerId)}/agent`;
  const suffix = requestUrl.pathname.startsWith(prefix)
    ? requestUrl.pathname.slice(prefix.length)
    : "";
  const query = new URLSearchParams(requestUrl.searchParams);
  query.delete("accessToken");
  query.delete("token");
  const queryString = query.toString();

  return `/agent${suffix}${queryString.length > 0 ? `?${queryString}` : ""}`;
};

const buildCapabilitiesProxyTargetPath = (computerId: string, requestUrl: URL): string => {
  const prefix = `/gateway/computers/${encodeURIComponent(computerId)}/capabilities`;
  const suffix = requestUrl.pathname.startsWith(prefix)
    ? requestUrl.pathname.slice(prefix.length)
    : "";
  const query = new URLSearchParams(requestUrl.searchParams);
  query.delete("accessToken");
  query.delete("token");
  const queryString = query.toString();

  return `/capabilities${suffix}${queryString.length > 0 ? `?${queryString}` : ""}`;
};

const getForwardedAgentHeaders = (context: Context<{ Variables: AppVariables }>): Record<string, string> => {
  const headers: Record<string, string> = {};
  const contentType = context.req.header("content-type");
  const lastEventId = context.req.header("last-event-id");

  if (contentType !== undefined) {
    headers["content-type"] = contentType;
  }

  if (lastEventId !== undefined) {
    headers["last-event-id"] = lastEventId;
  }

  return headers;
};

const getForwardedCapabilitiesHeaders = (context: Context<{ Variables: AppVariables }>): Record<string, string> => {
  const headers: Record<string, string> = {};
  const contentType = context.req.header("content-type");

  if (contentType !== undefined) {
    headers["content-type"] = contentType;
  }

  return headers;
};

const getForwardedUploadHeaders = (context: Context<{ Variables: AppVariables }>): Record<string, string> => {
  const headers: Record<string, string> = {};
  const contentType = context.req.header("content-type");

  if (contentType !== undefined) {
    headers["content-type"] = contentType;
  }

  return headers;
};

const readProxyRequestBody = async (
  context: Context<{ Variables: AppVariables }>,
): Promise<Buffer | undefined> => {
  if (context.req.method === "GET" || context.req.method === "HEAD") {
    return undefined;
  }

  return Buffer.from(await context.req.arrayBuffer());
};

const readContentLength = (context: Context<{ Variables: AppVariables }>): number | undefined => {
  const rawValue = context.req.header("content-length");

  if (rawValue === undefined) {
    return undefined;
  }

  const parsed = Number(rawValue);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const toGatewayDownloadStreamResponse = (proxied: GatewayHttpStreamResponse): Response => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(proxied.headers)) {
    if (isForwardedDownloadHeader(name)) {
      headers.set(name, value);
    }
  }

  return new Response(proxied.body as unknown as ConstructorParameters<typeof Response>[0], {
    status: proxied.statusCode,
    headers,
  });
};

const toGatewayPreviewResponse = (
  proxied: GatewayHttpResponse,
  options: { readonly cookie?: string } = {},
): Response => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(proxied.headers)) {
    if (isForwardedPreviewHeader(name)) {
      headers.set(name, value);
    }
  }

  headers.set("content-length", String(proxied.body.byteLength));

  if (options.cookie !== undefined) {
    headers.append("set-cookie", options.cookie);
  }

  return new Response(new Uint8Array(proxied.body), {
    status: proxied.statusCode,
    headers,
  });
};

const toGatewayAgentResponse = (proxied: GatewayHttpStreamResponse): Response => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(proxied.headers)) {
    if (isForwardedAgentHeader(name)) {
      headers.set(name, value);
    }
  }

  return new Response(proxied.body as unknown as ConstructorParameters<typeof Response>[0], {
    status: proxied.statusCode,
    headers,
  });
};

const toGatewayCapabilitiesResponse = (proxied: GatewayHttpResponse): Response => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(proxied.headers)) {
    if (isForwardedCapabilitiesHeader(name)) {
      headers.set(name, value);
    }
  }

  return new Response(new Uint8Array(proxied.body), {
    status: proxied.statusCode,
    headers,
  });
};

const toGatewayUploadResponse = (proxied: GatewayHttpResponse): Response => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(proxied.headers)) {
    if (isForwardedUploadHeader(name)) {
      headers.set(name, value);
    }
  }

  return new Response(new Uint8Array(proxied.body), {
    status: proxied.statusCode,
    headers,
  });
};

const isForwardedDownloadHeader = (name: string): boolean => {
  const normalized = name.toLowerCase();
  return normalized === "content-type" ||
    normalized === "content-disposition" ||
    normalized === "cache-control" ||
    normalized === "content-length";
};

const isForwardedPreviewHeader = (name: string): boolean => {
  const normalized = name.toLowerCase();
  return normalized === "content-type" ||
    normalized === "content-disposition" ||
    normalized === "cache-control";
};

const isForwardedAgentHeader = (name: string): boolean => {
  const normalized = name.toLowerCase();
  return [
    "cache-control",
    "content-type",
    "x-accel-buffering",
  ].includes(normalized);
};

const isForwardedCapabilitiesHeader = (name: string): boolean => {
  const normalized = name.toLowerCase();
  return normalized === "content-type" ||
    normalized === "cache-control";
};

const isForwardedUploadHeader = (name: string): boolean => {
  const normalized = name.toLowerCase();
  return normalized === "content-type" ||
    normalized === "cache-control" ||
    normalized === "content-length";
};

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

const readCookie = (cookieHeader: string | undefined, name: string): string | undefined => {
  if (cookieHeader === undefined) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    if (rawName !== name || rawValueParts.length === 0) {
      continue;
    }

    const rawValue = rawValueParts.join("=");
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return undefined;
};

const buildPreviewAccessCookie = (input: {
  readonly computerId: string;
  readonly token: string;
  readonly secure: boolean;
}): string => {
  const sameSite = input.secure ? "None" : "Lax";
  const attributes = [
    `${PREVIEW_ACCESS_COOKIE_NAME}=${encodeURIComponent(input.token)}`,
    `Path=${buildPreviewGatewayBasePath(input.computerId)}`,
    "HttpOnly",
    "Max-Age=3600",
    `SameSite=${sameSite}`,
  ];

  if (input.secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
};

const isSecureRequest = (context: Context<{ Variables: AppVariables }>, requestUrl: URL): boolean => {
  const forwardedProto = context.req.header("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return requestUrl.protocol === "https:" || forwardedProto === "https";
};

const ADMIN_DIST_RELATIVE_FROM_SOURCE = "../admin-ui/dist";

const resolveAdminDistRoot = (): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, ADMIN_DIST_RELATIVE_FROM_SOURCE);
};

const renderAdminPlaceholder = (): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>HeySnap Admin</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 4rem auto; max-width: 32rem; color: #f4f4f5; background: #18181b; padding: 0 1.5rem; line-height: 1.6; }
      code { background: #27272a; padding: 0 .35rem; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>HeySnap admin dashboard is not built</h1>
    <p>The admin UI bundle was not found. Run:</p>
    <p><code>pnpm --filter @ank1015-app/cloud-server-admin-ui build</code></p>
  </body>
</html>`;

const mountAdminDashboard = (app: Hono<{ Variables: AppVariables }>): void => {
  const distRoot = resolveAdminDistRoot();
  const indexPath = resolve(distRoot, "index.html");

  app.get("/admin-dashboard", (context) => context.redirect("/admin-dashboard/", 302));

  if (!existsSync(indexPath)) {
    app.get("/admin-dashboard/*", (context) => context.html(renderAdminPlaceholder()));
    return;
  }

  app.use(
    "/admin-dashboard/*",
    serveStatic({
      root: distRoot,
      rewriteRequestPath: (path) => {
        const stripped = path.replace(/^\/admin-dashboard/, "");
        return stripped.length === 0 ? "/" : stripped;
      },
    }),
  );

  const indexHtml = readFileSync(indexPath, "utf8");
  app.get("/admin-dashboard/*", (context) => context.html(indexHtml));
};
