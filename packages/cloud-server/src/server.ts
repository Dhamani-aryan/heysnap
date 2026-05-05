import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createAdminRoutes } from "./admin/routes.js";
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
import type { TunnelStatusRegistry } from "./gateway/tunnel.js";

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
  ));
  app.route("/machines", createMachineRoutes(options.store, options.config));
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
