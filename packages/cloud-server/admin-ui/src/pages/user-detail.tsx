import { ArrowLeft, KeyRound, RefreshCw, ShieldOff, Trash2 } from "lucide-react";
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

export const UserDetailPage = () => {
  const params = useParams<{ readonly userId: string }>();
  const navigate = useNavigate();
  const userId = params.userId ?? "";
  const detail = useAdminQuery(() => adminApi.getUserDetail(userId), [userId]);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [revokeBusy, setRevokeBusy] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);

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

  const user = detail.data?.user;
  const computers = detail.data?.computers ?? [];
  const sessions = detail.data?.sessions ?? [];
  const activeSessions = sessions.filter(
    (session) => session.revokedAt === null && new Date(session.expiresAt).getTime() > Date.now(),
  );

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
            <Button variant="outline" size="sm" onClick={detail.reload} disabled={detail.loading} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => setResetOpen(true)} className="gap-2">
              <KeyRound className="h-3.5 w-3.5" /> Reset password
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)} className="gap-2">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <CardDescription>Active sessions</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold">{activeSessions.length}</span>
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
      </div>

      <Tabs defaultValue="computers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="computers">Machines</TabsTrigger>
          <TabsTrigger value="ai-usage">AI usage</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
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
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Sessions</CardTitle>
                <CardDescription>
                  {activeSessions.length} active · {sessions.length - activeSessions.length} revoked or expired
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRevokeAll}
                disabled={revokeBusy || activeSessions.length === 0}
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
                  ) : sessions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                        No sessions yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    sessions.map((session) => {
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
