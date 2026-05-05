import { timingSafeEqual } from "node:crypto";

import { Hono } from "hono";

import type { AuthService } from "../auth/service.js";
import type { CloudServerConfig } from "../config.js";
import type { AppVariables } from "../shared/context.js";
import { unauthorized } from "../shared/errors.js";
import { serializeUser } from "../shared/serialization.js";
import { readJsonBody, stringField } from "../shared/validation.js";

export const createAdminRoutes = (
  authService: AuthService,
  config: CloudServerConfig,
): Hono<{ Variables: AppVariables }> => {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("*", async (context, next) => {
    const token = readBearerToken(context.req.header("authorization"));

    if (token === null || !safeTokenEquals(token, config.adminToken)) {
      throw unauthorized("Admin access required");
    }

    await next();
  });

  app.post("/users", async (context) => {
    const body = await readJsonBody(context.req.raw);
    const user = await authService.createUser({
      email: stringField(body, "email", { required: true, maxLength: 320 }) ?? "",
      password: stringField(body, "password", { required: true, maxLength: 1024 }) ?? "",
    });

    return context.json({
      user: serializeUser({
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }),
    }, 201);
  });

  return app;
};

const readBearerToken = (authorizationHeader: string | undefined): string | null => {
  if (authorizationHeader === undefined) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(/\s+/, 2);

  if (scheme?.toLowerCase() !== "bearer" || token === undefined || token.length === 0) {
    return null;
  }

  return token;
};

const safeTokenEquals = (actual: string, expected: string): boolean => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
};
