import { deleteCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";

import type { CloudServerConfig } from "../config.js";
import type { AppVariables } from "../shared/context.js";
import { serializeUser } from "../shared/serialization.js";
import { readJsonBody, stringField } from "../shared/validation.js";
import { AUTH_COOKIE_NAME, requireAuth } from "./middleware.js";
import type { AuthService } from "./service.js";

export const createAuthRoutes = (
  authService: AuthService,
  config: CloudServerConfig,
): Hono<{ Variables: AppVariables }> => {
  const app = new Hono<{ Variables: AppVariables }>();

  app.post("/login", async (context) => {
    const input = await readAuthInput(context.req.raw);
    const result = await authService.login(input);
    setSessionCookie(context, result.token, result.session.expiresAt, config);

    return context.json({
      user: serializeUser({
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        allowPiModels: result.user.allowPiModels,
        allowBrowserStream: result.user.allowBrowserStream,
        createdAt: result.user.createdAt,
        updatedAt: result.user.updatedAt,
      }),
      session: {
        token: result.token,
        expiresAt: result.session.expiresAt.toISOString(),
      },
    });
  });

  app.post("/logout", requireAuth(authService), async (context) => {
    await authService.revokeSession(context.get("currentSession").id);
    deleteCookie(context, AUTH_COOKIE_NAME, { path: "/" });

    return context.json({ ok: true });
  });

  app.get("/me", requireAuth(authService), (context) => {
    return context.json({ user: serializeUser(context.get("currentUser")) });
  });

  return app;
};

const readAuthInput = async (request: Request): Promise<{ readonly email: string; readonly password: string }> => {
  const body = await readJsonBody(request);

  return {
    email: stringField(body, "email", { required: true, maxLength: 320 }) ?? "",
    password: stringField(body, "password", { required: true, maxLength: 1024 }) ?? "",
  };
};

const setSessionCookie = (
  context: Parameters<typeof setCookie>[0],
  token: string,
  expiresAt: Date,
  config: CloudServerConfig,
): void => {
  setCookie(context, AUTH_COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: config.sessionTtlSeconds,
    expires: expiresAt,
  });
};
