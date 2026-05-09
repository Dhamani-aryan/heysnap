import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

import { createAdminRoutes } from "./admin/routes.js";
import { createAiGatewayRoutes } from "./ai-gateway/routes.js";
import { AuthService } from "./auth/service.js";
import { createAuthRoutes } from "./auth/routes.js";
import type { CloudServerConfig } from "./config.js";
import { createComputerRoutes } from "./control-plane/computers.js";
import type { CloudStore } from "./db/types.js";
import { GatewayAccessService } from "./gateway/access-sessions.js";
import { createMachineRoutes } from "./machines/routes.js";
import { AwsEc2Provisioner } from "./provisioning/aws-ec2-provisioner.js";
import type { ComputerProvisioner } from "./provisioning/types.js";
import { createReleaseRoutes } from "./releases/routes.js";
import { HttpError } from "./shared/errors.js";
import type { AppVariables } from "./shared/context.js";
import type { GatewayHttpResponse, GatewayHttpStreamResponse, TunnelStatusRegistry } from "./gateway/tunnel.js";

export type { TunnelStatusRegistry } from "./gateway/tunnel.js";

export interface CreateAppOptions {
  readonly store: CloudStore;
  readonly config: CloudServerConfig;
  readonly provisioner?: ComputerProvisioner;
  readonly tunnelRegistry?: TunnelStatusRegistry;
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

  app.use("*", cors({
    origin: (origin) => {
      if (options.config.allowedOrigins.includes("*")) {
        return origin;
      }

      return options.config.allowedOrigins.includes(origin) ? origin : null;
    },
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  }));

  app.get("/health", (context) => context.json({ ok: true }));
  mountAdminDashboard(app);
  app.route("/admin", createAdminRoutes(options.store, authService, options.config, provisioner, tunnelRegistry));
  app.route("/auth", createAuthRoutes(authService, options.config));
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
  app.get("/gateway/computers/:computerId/filesystem/preview", async (context) => {
    return await proxyGatewayFilesystemHttpRequest(
      context,
      gatewayAccessService,
      tunnelRegistry,
      "/filesystem/preview",
    );
  });
  app.all("/gateway/computers/:computerId/agent/*", async (context) => {
    return await proxyGatewayAgentHttpRequest(context, gatewayAccessService, tunnelRegistry);
  });
  app.route("/machines", createMachineRoutes(options.store, options.config));
  app.route("/llm", createAiGatewayRoutes(options.store, options.config));
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

    console.error(error);

    return context.json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    }, 500);
  });

  return app;
};

const proxyGatewayFilesystemHttpRequest = async (
  context: Context<{ Variables: AppVariables }>,
  gatewayAccessService: GatewayAccessService,
  tunnelRegistry: TunnelStatusRegistry,
  targetPathname: "/filesystem/download" | "/filesystem/preview",
): Promise<Response> => {
  const computerId = context.req.param("computerId");
  const requestUrl = new URL(context.req.url);

  if (computerId === undefined || computerId.length === 0) {
    return context.json({ error: { code: "NOT_FOUND", message: "Computer not found" } }, 404);
  }

  const token = readBearerToken(context.req.header("authorization"))
    ?? requestUrl.searchParams.get("accessToken")
    ?? requestUrl.searchParams.get("token")
    ?? undefined;

  if (token === undefined || token.length === 0) {
    return context.json({ error: { code: "UNAUTHORIZED", message: "Gateway access token is required" } }, 401);
  }

  const accessSession = await gatewayAccessService.authenticateAccessToken({ token, computerId });

  if (accessSession === null) {
    return context.json({ error: { code: "UNAUTHORIZED", message: "Invalid gateway access token" } }, 401);
  }

  if (tunnelRegistry.proxyHttpRequest === undefined) {
    return context.json({ error: { code: "TUNNEL_UNAVAILABLE", message: "Machine tunnel is not connected" } }, 503);
  }

  const proxied = await tunnelRegistry.proxyHttpRequest(computerId, {
    path: buildFilesystemProxyTargetPath(requestUrl, targetPathname),
  });

  if (proxied === null) {
    return context.json({ error: { code: "TUNNEL_UNAVAILABLE", message: "Machine tunnel is not connected" } }, 503);
  }

  return toGatewayDownloadResponse(proxied);
};

const proxyGatewayAgentHttpRequest = async (
  context: Context<{ Variables: AppVariables }>,
  gatewayAccessService: GatewayAccessService,
  tunnelRegistry: TunnelStatusRegistry,
): Promise<Response> => {
  const computerId = context.req.param("computerId");
  const requestUrl = new URL(context.req.url);

  if (computerId === undefined || computerId.length === 0) {
    return context.json({ error: { code: "NOT_FOUND", message: "Computer not found" } }, 404);
  }

  const token = readBearerToken(context.req.header("authorization"))
    ?? requestUrl.searchParams.get("accessToken")
    ?? requestUrl.searchParams.get("token")
    ?? undefined;

  if (token === undefined || token.length === 0) {
    return context.json({ error: { code: "UNAUTHORIZED", message: "Gateway access token is required" } }, 401);
  }

  const accessSession = await gatewayAccessService.authenticateAccessToken({ token, computerId });

  if (accessSession === null) {
    return context.json({ error: { code: "UNAUTHORIZED", message: "Invalid gateway access token" } }, 401);
  }

  if (tunnelRegistry.proxyStreamingHttpRequest === undefined) {
    return context.json({ error: { code: "TUNNEL_UNAVAILABLE", message: "Machine tunnel is not connected" } }, 503);
  }

  const proxied = await tunnelRegistry.proxyStreamingHttpRequest(computerId, {
    path: buildAgentProxyTargetPath(computerId, requestUrl),
    method: context.req.method,
    headers: getForwardedAgentHeaders(context),
    body: await readProxyRequestBody(context),
  });

  if (proxied === null) {
    return context.json({ error: { code: "TUNNEL_UNAVAILABLE", message: "Machine tunnel is not connected" } }, 503);
  }

  return toGatewayAgentResponse(proxied);
};

const buildFilesystemProxyTargetPath = (
  requestUrl: URL,
  targetPathname: "/filesystem/download" | "/filesystem/preview",
): string => {
  const query = new URLSearchParams(requestUrl.searchParams);
  query.delete("accessToken");
  query.delete("token");
  const queryString = query.toString();

  return `${targetPathname}${queryString.length > 0 ? `?${queryString}` : ""}`;
};

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

const readProxyRequestBody = async (
  context: Context<{ Variables: AppVariables }>,
): Promise<Buffer | undefined> => {
  if (context.req.method === "GET" || context.req.method === "HEAD") {
    return undefined;
  }

  return Buffer.from(await context.req.arrayBuffer());
};

const toGatewayDownloadResponse = (proxied: GatewayHttpResponse): Response => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(proxied.headers)) {
    if (isForwardedDownloadHeader(name)) {
      headers.set(name, value);
    }
  }

  headers.set("content-length", String(proxied.body.byteLength));

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

const isForwardedDownloadHeader = (name: string): boolean => {
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
