import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";

import { adminApi, ApiError } from "@/lib/api";
import { clearStoredAdminToken, getStoredAdminToken } from "@/lib/auth";

type AuthState = "checking" | "ok" | "unauthorized";

export const RequireAuth = ({ children }: { readonly children: React.ReactNode }) => {
  const [state, setState] = React.useState<AuthState>("checking");
  const location = useLocation();

  React.useEffect(() => {
    let cancelled = false;
    const token = getStoredAdminToken();

    if (token === null || token.length === 0) {
      setState("unauthorized");
      return;
    }

    (async () => {
      try {
        await adminApi.authCheck(token);
        if (!cancelled) {
          setState("ok");
        }
      } catch (error) {
        if (!cancelled) {
          if (error instanceof ApiError && error.status === 401) {
            clearStoredAdminToken();
          }
          setState("unauthorized");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <span className="text-sm">Checking admin session…</span>
      </div>
    );
  }

  if (state === "unauthorized") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
};
