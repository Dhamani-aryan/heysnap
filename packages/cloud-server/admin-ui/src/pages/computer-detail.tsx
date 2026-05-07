import { ArrowLeft, Pause, Pencil, Play, RefreshCw, RotateCw, ShieldOff, Trash2 } from "lucide-react";
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
import type { AdminMachineIdentity } from "@/lib/types";

type LifecycleAction = "start" | "stop" | "restart" | "delete";

export const ComputerDetailPage = () => {
  const params = useParams<{ readonly computerId: string }>();
  const navigate = useNavigate();
  const computerId = params.computerId ?? "";
  const detail = useAdminQuery(() => adminApi.getComputerDetail(computerId), [computerId]);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<LifecycleAction | null>(null);
  const [actionBusy, setActionBusy] = React.useState(false);
  const [identityToRevoke, setIdentityToRevoke] = React.useState<AdminMachineIdentity | null>(null);
  const [identityBusy, setIdentityBusy] = React.useState(false);

  const computer = detail.data?.computer;

  const closeAction = () => {
    if (actionBusy) {
      return;
    }
    setPendingAction(null);
  };

  const runAction = async () => {
    if (pendingAction === null) {
      return;
    }
    setActionBusy(true);
    try {
      switch (pendingAction) {
        case "start":
          await adminApi.startComputer(computerId);
          toast.success("Starting machine");
          break;
        case "stop":
          await adminApi.stopComputer(computerId);
          toast.success("Stopping machine");
          break;
        case "restart":
          await adminApi.restartComputer(computerId);
          toast.success("Restarting machine");
          break;
        case "delete":
          await adminApi.deleteComputer(computerId);
          toast.success("Machine deleted");
          navigate("/computers", { replace: true });
          return;
      }
      detail.reload();
      setPendingAction(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setActionBusy(false);
    }
  };

  const handleRevokeIdentity = async () => {
    if (identityToRevoke === null) {
      return;
    }
    setIdentityBusy(true);
    try {
      await adminApi.revokeMachineIdentity(computerId, identityToRevoke.id);
      toast.success("Identity revoked");
      setIdentityToRevoke(null);
      detail.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Revoke failed");
    } finally {
      setIdentityBusy(false);
    }
  };

  if (detail.error !== null) {
    return (
      <>
        <PageHeader
          title="Machine"
          actions={
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to="/computers">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Link>
            </Button>
          }
        />
        <ErrorState message={detail.error} onRetry={detail.reload} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={
          detail.loading || computer === undefined ? (
            <Skeleton className="h-7 w-56" />
          ) : (
            <span className="flex items-center gap-3">
              {computer.name}
              <StatusBadge status={computer.status} />
              {computer.tunnelConnected === true && (
                <Badge variant="success" className="font-medium">
                  Live tunnel
                </Badge>
              )}
            </span>
          )
        }
        description={
          computer !== undefined ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <KindBadge kind={computer.kind} />
              <span className="font-mono">{computer.id}</span>
              <CopyButton value={computer.id} label="Copy id" />
              {computer.ownerEmail !== null && computer.ownerEmail !== undefined && (
                <Link to={`/users/${computer.ownerUserId}`} className="hover:underline">
                  {computer.ownerEmail}
                </Link>
              )}
            </span>
          ) : null
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to="/computers">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={detail.reload} disabled={detail.loading} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)} className="gap-2">
              <Pencil className="h-3.5 w-3.5" /> Rename
            </Button>
            {computer?.kind === "cloud" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPendingAction("start")}
                  disabled={detail.loading}
                  className="gap-2"
                >
                  <Play className="h-3.5 w-3.5" /> Start
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPendingAction("stop")}
                  disabled={detail.loading}
                  className="gap-2"
                >
                  <Pause className="h-3.5 w-3.5" /> Stop
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPendingAction("restart")}
                  disabled={detail.loading}
                  className="gap-2"
                >
                  <RotateCw className="h-3.5 w-3.5" /> Restart
                </Button>
              </>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setPendingAction("delete")}
              disabled={detail.loading}
              className="gap-2"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </>
        }
      />

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="ai-usage">AI usage</TabsTrigger>
          <TabsTrigger value="identities">Identities</TabsTrigger>
          <TabsTrigger value="access">Access sessions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
                <CardDescription>Latest known machine state.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <DetailRow label="Status" value={computer === undefined ? null : <StatusBadge status={computer.status} />} />
                <DetailRow
                  label="Kind"
                  value={computer === undefined ? null : <KindBadge kind={computer.kind} />}
                />
                <DetailRow
                  label="Live tunnel"
                  value={
                    computer === undefined
                      ? null
                      : computer.tunnelConnected
                        ? <Badge variant="success">Connected</Badge>
                        : <Badge variant="muted">Not connected</Badge>
                  }
                />
                <DetailRow
                  label="Machine server"
                  value={
                    computer === undefined ? null : (
                      <span className="font-mono text-xs">{computer.machineServerVersion ?? "—"}</span>
                    )
                  }
                />
                <DetailRow
                  label="Last heartbeat"
                  value={computer === undefined ? null : <RelativeTime value={computer.lastHeartbeatAt} />}
                />
                <DetailRow
                  label="Created"
                  value={computer === undefined ? null : <RelativeTime value={computer.createdAt} />}
                />
                <DetailRow
                  label="Updated"
                  value={computer === undefined ? null : <RelativeTime value={computer.updatedAt} />}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Provider metadata</CardTitle>
                <CardDescription>Raw JSON from the provisioner.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                  {computer === undefined
                    ? "Loading…"
                    : JSON.stringify(computer.providerMetadata, null, 2)}
                </pre>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Capabilities</CardTitle>
              <CardDescription>Self-reported capabilities from the machine server.</CardDescription>
            </CardHeader>
            <CardContent>
              {computer === undefined ? (
                <Skeleton className="h-5 w-32" />
              ) : Array.isArray(computer.capabilities) && computer.capabilities.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {(computer.capabilities as unknown[]).map((capability, index) => (
                    <Badge key={index} variant="outline" className="font-mono">
                      {String(capability)}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">No capabilities reported</span>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai-usage">
          <AiUsagePanel scope={{ kind: "computer", computerId }} />
        </TabsContent>

        <TabsContent value="identities">
          <Card>
            <CardHeader>
              <CardTitle>Machine identities</CardTitle>
              <CardDescription>
                Bootstrap and long-lived tokens issued for this machine.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Identity</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead className="w-32">Last used</TableHead>
                    <TableHead className="w-32">Created</TableHead>
                    <TableHead className="w-32">Status</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.loading ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-5" />
                      </TableCell>
                    </TableRow>
                  ) : (detail.data?.identities ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                        No machine identities
                      </TableCell>
                    </TableRow>
                  ) : (
                    detail.data?.identities.map((identity) => {
                      const status =
                        identity.revokedAt !== null
                          ? { variant: "muted" as const, label: "Revoked" }
                          : identity.hasMachineToken
                            ? { variant: "success" as const, label: "Active" }
                            : identity.hasBootstrapToken
                              ? { variant: "warning" as const, label: "Pending" }
                              : { variant: "muted" as const, label: "Empty" };

                      return (
                        <TableRow key={identity.id}>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {identity.id}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="flex flex-col gap-1">
                              {identity.hasBootstrapToken && (
                                <Badge variant="outline" className="w-fit font-mono">
                                  bootstrap
                                </Badge>
                              )}
                              {identity.hasMachineToken && (
                                <Badge variant="outline" className="w-fit font-mono">
                                  machine
                                </Badge>
                              )}
                              {!identity.hasBootstrapToken && !identity.hasMachineToken && (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <RelativeTime value={identity.lastUsedAt} />
                          </TableCell>
                          <TableCell>
                            <RelativeTime value={identity.createdAt} />
                          </TableCell>
                          <TableCell>
                            <Badge variant={status.variant} className="font-medium">
                              {status.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5 text-destructive hover:text-destructive"
                              disabled={identity.revokedAt !== null}
                              onClick={() => setIdentityToRevoke(identity)}
                            >
                              <ShieldOff className="h-3.5 w-3.5" /> Revoke
                            </Button>
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

        <TabsContent value="access">
          <Card>
            <CardHeader>
              <CardTitle>Access sessions</CardTitle>
              <CardDescription>Recent gateway access tokens issued to users.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Session</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead className="w-32">Created</TableHead>
                    <TableHead className="w-32">Expires</TableHead>
                    <TableHead className="w-32">Revoked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.loading ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-5" />
                      </TableCell>
                    </TableRow>
                  ) : (detail.data?.accessSessions ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                        No access sessions
                      </TableCell>
                    </TableRow>
                  ) : (
                    detail.data?.accessSessions.map((session) => (
                      <TableRow key={session.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">{session.id}</TableCell>
                        <TableCell className="text-sm">
                          <Link to={`/users/${session.userId}`} className="font-mono text-xs hover:underline">
                            {session.userId}
                          </Link>
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
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={pendingAction !== null}
        title={
          pendingAction === "delete"
            ? "Delete machine?"
            : pendingAction === "start"
              ? "Start machine?"
              : pendingAction === "stop"
                ? "Stop machine?"
                : "Restart machine?"
        }
        description={
          pendingAction === "delete" ? (
            <>This terminates the EC2 instance (if any) and removes the record. Cannot be undone.</>
          ) : (
            <>Run this lifecycle action through the provisioner.</>
          )
        }
        confirmLabel={
          pendingAction === "delete"
            ? "Delete"
            : pendingAction === "start"
              ? "Start"
              : pendingAction === "stop"
                ? "Stop"
                : "Restart"
        }
        destructive={pendingAction === "delete"}
        busy={actionBusy}
        onConfirm={runAction}
        onCancel={closeAction}
      />

      <ConfirmDialog
        open={identityToRevoke !== null}
        title="Revoke machine identity?"
        description="The machine will lose access until it re-registers. Tunnel connections using this identity will be torn down on the next request."
        confirmLabel="Revoke identity"
        destructive
        busy={identityBusy}
        onConfirm={handleRevokeIdentity}
        onCancel={() => !identityBusy && setIdentityToRevoke(null)}
      />

      <RenameDialog
        open={renameOpen}
        currentName={computer?.name ?? ""}
        onClose={() => setRenameOpen(false)}
        onRenamed={() => {
          setRenameOpen(false);
          detail.reload();
        }}
        computerId={computerId}
      />
    </>
  );
};

const DetailRow = ({ label, value }: { readonly label: string; readonly value: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
    <div className="text-sm">{value}</div>
  </div>
);

const RenameDialog = ({
  open,
  currentName,
  computerId,
  onClose,
  onRenamed,
}: {
  readonly open: boolean;
  readonly currentName: string;
  readonly computerId: string;
  readonly onClose: () => void;
  readonly onRenamed: () => void;
}) => {
  const [name, setName] = React.useState(currentName);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(currentName);
      setSubmitting(false);
    }
  }, [open, currentName]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return;
    }
    setSubmitting(true);
    try {
      await adminApi.renameComputer(computerId, trimmed);
      toast.success("Renamed");
      onRenamed();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Rename failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !submitting && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename machine</DialogTitle>
          <DialogDescription>Update the human-readable label for this machine.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="machine-name">Name</Label>
            <Input
              id="machine-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              maxLength={120}
              required
              disabled={submitting}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
