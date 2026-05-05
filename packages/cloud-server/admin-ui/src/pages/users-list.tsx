import { Eye, KeyRound, MoreHorizontal, RefreshCw, Trash2, UserPlus } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useAdminQuery } from "@/hooks/use-admin-query";
import { adminApi, ApiError } from "@/lib/api";
import type { AdminUserSummary } from "@/lib/types";

export const UsersListPage = () => {
  const users = useAdminQuery(() => adminApi.listUsers().then((data) => data.users));
  const [createOpen, setCreateOpen] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [actionUser, setActionUser] = React.useState<AdminUserSummary | null>(null);
  const [actionKind, setActionKind] = React.useState<"delete" | "password" | null>(null);
  const [actionBusy, setActionBusy] = React.useState(false);

  const filtered = React.useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (term.length === 0) {
      return users.data ?? [];
    }
    return (users.data ?? []).filter((user) => user.email.toLowerCase().includes(term));
  }, [users.data, filter]);

  const closeAction = () => {
    if (actionBusy) {
      return;
    }
    setActionUser(null);
    setActionKind(null);
  };

  const handleDeleteConfirm = async () => {
    if (actionUser === null) {
      return;
    }
    setActionBusy(true);
    try {
      await adminApi.deleteUser(actionUser.id);
      toast.success(`Deleted ${actionUser.email}`);
      users.reload();
      setActionUser(null);
      setActionKind(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Delete failed");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Users"
        description="Create accounts, reset passwords, and remove users along with all their cloud machines."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={users.reload} disabled={users.loading} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-2">
              <UserPlus className="h-3.5 w-3.5" /> Create user
            </Button>
          </>
        }
      />

      <div className="flex items-center gap-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by email…"
          className="max-w-xs"
        />
        <span className="text-xs text-muted-foreground">{filtered.length} of {users.data?.length ?? 0}</span>
      </div>

      {users.error !== null ? (
        <ErrorState message={users.error} onRetry={users.reload} />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead className="w-40">User ID</TableHead>
                <TableHead className="w-24">Machines</TableHead>
                <TableHead className="w-36">Created</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.loading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <TableRow key={index}>
                    {Array.from({ length: 5 }).map((__, cellIndex) => (
                      <TableCell key={cellIndex}>
                        <Skeleton className="h-4" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <Link to={`/users/${user.id}`} className="font-medium hover:underline">
                        {user.email}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{user.id}</TableCell>
                    <TableCell>{user.computerCount ?? user.computers?.length ?? 0}</TableCell>
                    <TableCell>
                      <RelativeTime value={user.createdAt} />
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="User actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to={`/users/${user.id}`}>
                              <Eye className="h-4 w-4" /> View
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setActionUser(user);
                              setActionKind("password");
                            }}
                          >
                            <KeyRound className="h-4 w-4" /> Reset password
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              setActionUser(user);
                              setActionKind("delete");
                            }}
                          >
                            <Trash2 className="h-4 w-4" /> Delete user
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          users.reload();
        }}
      />

      <ConfirmDialog
        open={actionKind === "delete" && actionUser !== null}
        title="Delete user?"
        description={
          actionUser !== null ? (
            <>
              <strong>{actionUser.email}</strong> and all of their machines will be deleted. Cloud EC2 instances are
              terminated. This cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete user"
        destructive
        busy={actionBusy}
        onConfirm={handleDeleteConfirm}
        onCancel={closeAction}
      />

      <ResetPasswordDialog
        user={actionKind === "password" ? actionUser : null}
        onClose={closeAction}
      />
    </>
  );
};

const CreateUserDialog = ({
  open,
  onOpenChange,
  onCreated,
}: {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly onCreated: () => void;
}) => {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setEmail("");
      setPassword("");
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const result = await adminApi.createUser({ email: email.trim(), password });
      toast.success(`Created ${result.user.email}`);
      onCreated();
      onOpenChange(false);
    } catch (cause) {
      const message =
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "Could not create user";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>The new user can immediately sign in with this password.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
              required
              disabled={submitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-user-password">Password</Label>
            <Input
              id="new-user-password"
              type="text"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              required
              minLength={6}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">Minimum 6 characters.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const ResetPasswordDialog = ({
  user,
  onClose,
}: {
  readonly user: AdminUserSummary | null;
  readonly onClose: () => void;
}) => {
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (user === null) {
      setPassword("");
      setSubmitting(false);
    }
  }, [user]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (user === null) {
      return;
    }
    setSubmitting(true);
    try {
      await adminApi.setUserPassword(user.id, password);
      toast.success(`Password reset for ${user.email}`);
      onClose();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not reset password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={user !== null} onOpenChange={(next) => !next && !submitting && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            {user !== null && <>Set a new password for <strong>{user.email}</strong>.</>}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              type="text"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              required
              minLength={6}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">The user keeps their existing sessions until you revoke them.</p>
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
