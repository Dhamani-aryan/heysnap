import { ArrowLeft, Download, KeyRound, RefreshCw, ShieldOff, Smartphone, Sparkles, Trash2 } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { AiUsagePanel } from "@/components/ai-usage-panel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { ErrorState } from "@/components/error-state";
import { KindBadge } from "@/components/kind-badge";
import { PageHeader } from "@/components/page-header";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { adminApi } from "@/lib/api";
import type { AdminAgentSession } from "@/lib/types";

export const UserDetailPage = () => {
  const params = useParams<{ readonly userId: string }>();
  const navigate = useNavigate();
  const userId = params.userId ?? "";
  const detail = useAdminQuery(() => adminApi.getUserDetail(userId), [userId]);
  const agentSessions = useAdminQuery(
    () => adminApi.listAgentSessions({ userId, limit: 200 }).then((data) => data.sessions),
    [userId],
  );
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [revokeBusy, setRevokeBusy] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [modelAccessBusy, setModelAccessBusy] = React.useState(false);
  const [browserStreamBusy, setBrowserStreamBusy] = React.useState(false);
  const [downloadBusyId, setDownloadBusyId] = React.useState<string | null>(null);
  const user = detail.data?.user;

  const handleDeleteConfirm = async () => {
    setDeleteBusy(true);
    try {
      await adminApi.deleteUser(userId);
      toast.success("User deleted");
      navigate("/users", { replace: true });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Delete failed");
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleRevokeAll = async () => {
    setRevokeBusy(true);
    try {
      const result = await adminApi.revokeAllUserSessions(userId);
      toast.success(`Revoked ${result.revokedCount} session${result.revokedCount === 1 ? "" : "s"}`);
      detail.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Revoke failed");
    } finally {
      setRevokeBusy(false);
    }
  };

  const handleTogglePiModels = async () => {
    if (user === undefined) {
      return;
    }

    setModelAccessBusy(true);
    try {
      await adminApi.setUserModelAccess(userId, !user.allowPiModels);
      toast.success(user.allowPiModels ? "Pi models disabled" : "Pi models enabled");
      detail.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to update model access");
    } finally {
      setModelAccessBusy(false);
    }
  };

  const handleToggleBrowserStream = async () => {
    if (user === undefined) {
      return;
    }

    setBrowserStreamBusy(true);
    try {
      await adminApi.setUserBrowserStreamAccess(userId, !user.allowBrowserStream);
      toast.success(user.allowBrowserStream ? "Browser stream disabled" : "Browser stream enabled");
      detail.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to update browser stream access");
    } finally {
      setBrowserStreamBusy(false);
    }
  };

  const handleRefresh = () => {
    detail.reload();
    agentSessions.reload();
  };

  const handleDownloadAgentSession = async (session: AdminAgentSession) => {
    setDownloadBusyId(session.id);
    try {
      const { blob, filename } = await adminApi.downloadAgentSessionRaw(session.id);
      downloadBlob(blob, filename ?? `${session.harness}-${safeFilenameSegment(session.nativeThreadId)}.jsonl`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Download failed");
    } finally {
      setDownloadBusyId(null);
    }
  };

  if (detail.error !== null) {
    return (
      <>
        <PageHeader
          title="User"
          actions={
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to="/users">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Link>
            </Button>
          }
        />
        <ErrorState message={detail.error} onRetry={detail.reload} />
      </>
    );
  }

  const computers = detail.data?.computers ?? [];
  const authSessions = detail.data?.sessions ?? [];
  const activeAuthSessions = authSessions.filter(
    (session) => session.revokedAt === null && new Date(session.expiresAt).getTime() > Date.now(),
  );
  const syncedSessions = agentSessions.data ?? [];

  return (
    <>
      <PageHeader
        title={
          detail.loading || user === undefined ? (
            <Skeleton className="h-7 w-56" />
          ) : (
            user.username
          )
        }
        description={
          user !== undefined ? (
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{user.email}</span>
              <span className="font-mono">{user.id}</span>
              <CopyButton value={user.id} label="Copy id" />
            </span>
          ) : null
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to="/users">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={detail.loading || agentSessions.loading}
              className="gap-2"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => setResetOpen(true)} className="gap-2">
              <KeyRound className="h-3.5 w-3.5" /> Reset password
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTogglePiModels}
              disabled={user === undefined || modelAccessBusy}
              className="gap-2"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {user?.allowPiModels === true ? "Disable Pi models" : "Enable Pi models"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleBrowserStream}
              disabled={user === undefined || browserStreamBusy}
              className="gap-2"
            >
              <Smartphone className="h-3.5 w-3.5" />
              {user?.allowBrowserStream === true ? "Disable browser stream" : "Enable browser stream"}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)} className="gap-2">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Machines</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold">{computers.length}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Synced sessions</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold">{syncedSessions.length}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Created</CardDescription>
          </CardHeader>
          <CardContent>
            <RelativeTime value={user?.createdAt ?? null} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pi models</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <Badge variant={user?.allowPiModels === true ? "success" : "secondary"}>
              {user?.allowPiModels === true ? "Allowed" : "Off"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTogglePiModels}
              disabled={user === undefined || modelAccessBusy}
              className="gap-2"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {user?.allowPiModels === true ? "Disable" : "Enable"}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Browser stream</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <Badge variant={user?.allowBrowserStream === true ? "success" : "secondary"}>
              {user?.allowBrowserStream === true ? "Allowed" : "Off"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleBrowserStream}
              disabled={user === undefined || browserStreamBusy}
              className="gap-2"
            >
              <Smartphone className="h-3.5 w-3.5" />
              {user?.allowBrowserStream === true ? "Disable" : "Enable"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="computers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="computers">Machines</TabsTrigger>
          <TabsTrigger value="ai-usage">AI usage</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="auth-sessions">Auth sessions</TabsTrigger>
        </TabsList>

        <TabsContent value="computers">
          <Card>
            <CardHeader>
              <CardTitle>Machines</CardTitle>
              <CardDescription>All computers owned by this user.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead className="w-32">Heartbeat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.loading ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-5" />
                      </TableCell>
                    </TableRow>
                  ) : computers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                        No machines for this user
                      </TableCell>
                    </TableRow>
                  ) : (
                    computers.map((computer) => (
                      <TableRow key={computer.id}>
                        <TableCell>
                          <Link to={`/computers/${computer.id}`} className="font-medium hover:underline">
                            {computer.name}
                          </Link>
                          <div className="font-mono text-xs text-muted-foreground">{computer.id}</div>
                        </TableCell>
                        <TableCell>
                          <KindBadge kind={computer.kind} />
                          {computer.tunnelConnected === true && (
                            <Badge variant="success" className="ml-2 font-medium">
                              Live
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={computer.status} />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {computer.machineServerVersion ?? "—"}
                        </TableCell>
                        <TableCell>
                          <RelativeTime value={computer.lastHeartbeatAt} />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai-usage">
          <AiUsagePanel scope={{ kind: "user", userId }} />
        </TabsContent>

        <TabsContent value="sessions">
          <Card>
            <CardHeader>
              <CardTitle>Sessions</CardTitle>
              <CardDescription>Raw Pi and Codex JSONL sessions synced from this user&apos;s machines.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {agentSessions.error !== null ? (
                <div className="p-4">
                  <ErrorState message={agentSessions.error} onRetry={agentSessions.reload} />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Session</TableHead>
                      <TableHead>Harness</TableHead>
                      <TableHead>Machine</TableHead>
                      <TableHead className="w-32">Size</TableHead>
                      <TableHead className="w-36">Synced</TableHead>
                      <TableHead className="w-28 text-right">Download</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agentSessions.loading ? (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Skeleton className="h-5" />
                        </TableCell>
                      </TableRow>
                    ) : syncedSessions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                          No synced sessions yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      syncedSessions.map((session) => (
                        <TableRow key={session.id}>
                          <TableCell>
                            <div className="font-mono text-xs">{session.threadId}</div>
                            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                              {session.nativeThreadId}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={session.harness === "pi" ? "secondary" : "outline"} className="font-medium">
                              {session.harness}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {session.computerName !== null ? (
                              <Link to={`/computers/${session.computerId}`} className="font-medium hover:underline">
                                {session.computerName}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">Unknown</span>
                            )}
                            <div className="font-mono text-xs text-muted-foreground">{session.computerId}</div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {formatBytes(session.latestSizeBytes)}
                          </TableCell>
                          <TableCell>
                            <RelativeTime value={session.lastSyncedAt} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleDownloadAgentSession(session)}
                              disabled={downloadBusyId === session.id || session.latestObjectKey === null}
                              className="gap-2"
                            >
                              <Download className="h-3.5 w-3.5" />
                              {downloadBusyId === session.id ? "..." : "JSONL"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="auth-sessions">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Auth sessions</CardTitle>
                <CardDescription>
                  {activeAuthSessions.length} active · {authSessions.length - activeAuthSessions.length} revoked or expired
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRevokeAll}
                disabled={revokeBusy || activeAuthSessions.length === 0}
                className="gap-2"
              >
                <ShieldOff className="h-3.5 w-3.5" />
                {revokeBusy ? "Revoking…" : "Revoke all"}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Session</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-36">Created</TableHead>
                    <TableHead className="w-36">Expires</TableHead>
                    <TableHead className="w-36">Revoked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.loading ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-5" />
                      </TableCell>
                    </TableRow>
                  ) : authSessions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                        No auth sessions yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    authSessions.map((session) => {
                      const expired = new Date(session.expiresAt).getTime() <= Date.now();
                      const status =
                        session.revokedAt !== null
                          ? { variant: "muted" as const, label: "Revoked" }
                          : expired
                            ? { variant: "muted" as const, label: "Expired" }
                            : { variant: "success" as const, label: "Active" };

                      return (
                        <TableRow key={session.id}>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {session.id}
                          </TableCell>
                          <TableCell>
                            <Badge variant={status.variant} className="font-medium">
                              {status.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <RelativeTime value={session.createdAt} />
                          </TableCell>
                          <TableCell>
                            <RelativeTime value={session.expiresAt} />
                          </TableCell>
                          <TableCell>
                            <RelativeTime value={session.revokedAt} />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete user?"
        description={
          user !== undefined ? (
            <>
              <strong>{user.username}</strong> ({user.email}) and all of their machines will be deleted. Cloud EC2
              instances are terminated. This cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete user"
        destructive
        busy={deleteBusy}
        onConfirm={handleDeleteConfirm}
        onCancel={() => !deleteBusy && setDeleteOpen(false)}
      />

      <ResetPasswordPopover
        userId={userId}
        username={user?.username}
        open={resetOpen}
        onClose={() => setResetOpen(false)}
      />
    </>
  );
};

const ResetPasswordPopover = ({
  userId,
  username,
  open,
  onClose,
}: {
  readonly userId: string;
  readonly username: string | undefined;
  readonly open: boolean;
  readonly onClose: () => void;
}) => {
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setPassword("");
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await adminApi.setUserPassword(userId, password);
      toast.success(`Password reset${username !== undefined ? ` for ${username}` : ""}`);
      onClose();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not reset password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !submitting && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            {username !== undefined ? (
              <>Set a new password for <strong>{username}</strong>.</>
            ) : (
              "Set a new password."
            )}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="user-detail-password">New password</Label>
            <Input
              id="user-detail-password"
              type="text"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
              autoComplete="off"
              disabled={submitting}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Reset password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const formatBytes = (value: number | null): string => {
  if (value === null) {
    return "—";
  }

  if (value < 1024) {
    return `${value.toLocaleString()} B`;
  }

  const units = ["KB", "MB", "GB"];
  let amount = value / 1024;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unitIndex]}`;
};

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const safeFilenameSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/gu, "_").slice(0, 120) || "thread";
