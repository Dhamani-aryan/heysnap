import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

import type { AuthService } from "./service.js";
import { unauthorized } from "../shared/errors.js";
import type { AppVariables } from "../shared/context.js";
import { toAuthenticatedUser } from "../shared/context.js";

export const AUTH_COOKIE_NAME = "ank_session";

export const requireAuth = (authService: AuthService) =>
  createMiddleware<{ Variables: AppVariables }>(async (context, next) => {
    const token = readBearerToken(context.req.header("authorization")) ?? getCookie(context, AUTH_COOKIE_NAME);

    if (token === undefined || token.length === 0) {
      throw unauthorized();
    }

    const auth = await authService.authenticateToken(token);

    if (auth === null) {
      throw unauthorized("Invalid or expired session");
    }

    context.set("currentUser", toAuthenticatedUser(auth.user));
    context.set("currentSession", auth.session);
    await next();
  });

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
