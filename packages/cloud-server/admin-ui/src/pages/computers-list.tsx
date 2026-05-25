import { Eye, MoreHorizontal, Pause, Play, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorState } from "@/components/error-state";
import { KindBadge } from "@/components/kind-badge";
import { PageHeader } from "@/components/page-header";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { adminApi } from "@/lib/api";
import type { AdminComputer } from "@/lib/types";

const KIND_OPTIONS = ["all", "cloud", "local"] as const;
const STATUS_OPTIONS = [
  "all",
  "creating",
  "starting",
  "online",
  "idle",
  "sleeping",
  "offline",
  "failed",
  "deleted",
] as const;

const readProviderField = (value: unknown, key: string): string => {
  if (typeof value !== "object" || value === null) {
    return "";
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : "";
};

export const ComputersListPage = () => {
  const computers = useAdminQuery(() => adminApi.listComputers().then((data) => data.computers));
  const [filter, setFilter] = React.useState("");
  const [kind, setKind] = React.useState<(typeof KIND_OPTIONS)[number]>("all");
  const [status, setStatus] = React.useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [actionTarget, setActionTarget] = React.useState<AdminComputer | null>(null);
  const [actionKind, setActionKind] = React.useState<"start" | "stop" | "restart" | "delete" | null>(null);
  const [actionBusy, setActionBusy] = React.useState(false);

  const filtered = React.useMemo(() => {
    const term = filter.trim().toLowerCase();
    return (computers.data ?? []).filter((computer) => {
      if (kind !== "all" && computer.kind !== kind) {
        return false;
      }
      if (status !== "all" && computer.status !== status) {
        return false;
      }
      if (term.length === 0) {
        return true;
      }
      return (
        computer.name.toLowerCase().includes(term) ||
        (computer.ownerEmail ?? "").toLowerCase().includes(term) ||
        readProviderField(computer.providerMetadata, "instanceId").toLowerCase().includes(term)
      );
    });
  }, [computers.data, filter, kind, status]);

  const closeAction = () => {
    if (actionBusy) {
      return;
    }
    setActionTarget(null);
    setActionKind(null);
  };

  const runAction = async () => {
    if (actionTarget === null || actionKind === null) {
      return;
    }
    setActionBusy(true);
    try {
      switch (actionKind) {
        case "start":
          await adminApi.startComputer(actionTarget.id);
          toast.success(`${actionTarget.name} starting`);
          break;
        case "stop":
          await adminApi.stopComputer(actionTarget.id);
          toast.success(`${actionTarget.name} stopping`);
          break;
        case "restart":
          await adminApi.restartComputer(actionTarget.id);
          toast.success(`${actionTarget.name} restarting`);
          break;
        case "delete":
          await adminApi.deleteComputer(actionTarget.id);
          toast.success(`${actionTarget.name} deleted`);
          break;
      }
      computers.reload();
      setActionTarget(null);
      setActionKind(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Machines"
        description="All machines registered with the control plane."
        actions={
          <Button variant="outline" size="sm" onClick={computers.reload} disabled={computers.loading} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter by name, owner, or instance id…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="max-w-sm"
        />
        <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KIND_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option === "all" ? "All kinds" : option === "cloud" ? "Cloud" : "Local"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option === "all" ? "All statuses" : option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {computers.data?.length ?? 0}
        </span>
      </div>

      {computers.error !== null ? (
        <ErrorState message={computers.error} onRetry={computers.reload} />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead className="w-32">Heartbeat</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {computers.loading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <TableRow key={index}>
                    {Array.from({ length: 8 }).map((__, cellIndex) => (
                      <TableCell key={cellIndex}>
                        <Skeleton className="h-4" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    No machines match the current filters
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((computer) => {
                  const provider =
                    readProviderField(computer.providerMetadata, "provider") ||
                    (computer.kind === "cloud" ? "aws-ec2" : "local");
                  const instanceId = readProviderField(computer.providerMetadata, "instanceId");

                  return (
                    <TableRow key={computer.id}>
                      <TableCell>
                        <Link to={`/computers/${computer.id}`} className="font-medium hover:underline">
                          {computer.name}
                        </Link>
                        <div className="font-mono text-xs text-muted-foreground">{computer.id}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {computer.ownerEmail !== null && computer.ownerEmail !== undefined ? (
                          <Link to={`/users/${computer.ownerUserId}`} className="hover:underline">
                            {computer.ownerEmail}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">{computer.ownerUserId}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <KindBadge kind={computer.kind} />
                          {computer.tunnelConnected === true && (
                            <Badge variant="success" className="font-medium">
                              Live
                            </Badge>
                          )}
                        </div>
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
                      <TableCell className="text-xs">
                        <div className="font-mono">{provider}</div>
                        {instanceId.length > 0 && <div className="font-mono text-muted-foreground">{instanceId}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Machine actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link to={`/computers/${computer.id}`}>
                                <Eye className="h-4 w-4" /> View
                              </Link>
                            </DropdownMenuItem>
                            {computer.kind === "cloud" && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setActionTarget(computer);
                                    setActionKind("start");
                                  }}
                                >
                                  <Play className="h-4 w-4" /> Start
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setActionTarget(computer);
                                    setActionKind("stop");
                                  }}
                                >
                                  <Pause className="h-4 w-4" /> Stop
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setActionTarget(computer);
                                    setActionKind("restart");
                                  }}
                                >
                                  <RotateCw className="h-4 w-4" /> Restart
                                </DropdownMenuItem>
                              </>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => {
                                setActionTarget(computer);
                                setActionKind("delete");
                              }}
                            >
                              <Trash2 className="h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={actionKind !== null && actionTarget !== null}
        title={
          actionKind === "delete"
            ? "Delete machine?"
            : actionKind === "start"
              ? "Start machine?"
              : actionKind === "stop"
                ? "Stop machine?"
                : "Restart machine?"
        }
        description={
          actionTarget !== null ? (
            actionKind === "delete" ? (
              <>
                <strong>{actionTarget.name}</strong> will be removed from the control plane. Cloud EC2 instances are
                terminated. This cannot be undone.
              </>
            ) : (
              <>
                Run <strong>{actionKind}</strong> on <strong>{actionTarget.name}</strong>?
              </>
            )
          ) : null
        }
        confirmLabel={
          actionKind === "delete"
            ? "Delete"
            : actionKind === "start"
              ? "Start"
              : actionKind === "stop"
                ? "Stop"
                : "Restart"
        }
        destructive={actionKind === "delete"}
        busy={actionBusy}
        onConfirm={runAction}
        onCancel={closeAction}
      />
    </>
  );
};
