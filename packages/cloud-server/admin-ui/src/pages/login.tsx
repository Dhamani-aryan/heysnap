import { Cpu, KeyRound } from "lucide-react";
import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminApi, ApiError } from "@/lib/api";
import { setStoredAdminToken } from "@/lib/auth";

interface LocationStateFrom {
  readonly from?: { readonly pathname?: string };
}

export const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [token, setToken] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmed = token.trim();

    if (trimmed.length === 0) {
      setError("Enter the admin token to sign in.");
      return;
    }

    setSubmitting(true);

    try {
      await adminApi.authCheck(trimmed);
      setStoredAdminToken(trimmed);
      const from = (location.state as LocationStateFrom | null)?.from?.pathname ?? "/";
      navigate(from, { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setError("That admin token is not valid.");
      } else if (cause instanceof Error) {
        setError(cause.message);
      } else {
        setError("Something went wrong. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Cpu className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-none">HeySnap Admin</h1>
            <p className="text-xs text-muted-foreground">Hosted control plane</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Enter the cloud-server admin token to manage users, machines, and releases.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="grid gap-2">
                <Label htmlFor="admin-token">Admin token</Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="admin-token"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="cs_admin_…"
                    className="pl-9 font-mono text-sm"
                    disabled={submitting}
                    autoFocus
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Token is stored locally in your browser. Use the value of <code>CLOUD_SERVER_ADMIN_TOKEN</code>.
                </p>
              </div>

              {error !== null && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Verifying…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
