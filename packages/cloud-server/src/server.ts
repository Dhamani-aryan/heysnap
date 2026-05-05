import { Hono } from "hono";
import { cors } from "hono/cors";

import { createAdminRoutes } from "./admin/routes.js";
import { renderAdminDashboard } from "./admin/dashboard.js";
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

export interface CreateAppOptions {
  readonly store: CloudStore;
  readonly config: CloudServerConfig;
  readonly provisioner?: ComputerProvisioner;
}

export const createApp = (options: CreateAppOptions): Hono<{ Variables: AppVariables }> => {
  const app = new Hono<{ Variables: AppVariables }>();
  const authService = new AuthService(options.store, options.config);
  const gatewayAccessService = new GatewayAccessService(options.store, options.config);
  const provisioner = options.provisioner ?? new AwsEc2Provisioner();

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
  app.get("/admin-dashboard", (context) => context.html(renderAdminDashboard()));
  app.route("/admin", createAdminRoutes(options.store, authService, options.config, provisioner));
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
