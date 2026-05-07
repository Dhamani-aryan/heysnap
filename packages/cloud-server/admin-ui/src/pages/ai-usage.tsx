import {
  Activity,
  AlertTriangle,
  Cpu,
  Gauge,
  RefreshCw,
  Sparkles,
  Timer,
  Users as UsersIcon,
} from "lucide-react";
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";

import { AiUsageStatusBadge } from "@/components/ai-usage-status-badge";
import { RequestsOverTimeChart } from "@/components/charts/requests-over-time";
import { TokensOverTimeChart } from "@/components/charts/tokens-over-time";
import { TopBarList, type TopBarItem } from "@/components/charts/top-bar";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { RelativeTime } from "@/components/relative-time";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  AI_USAGE_WINDOWS,
  computeWindowFrom,
  formatDurationMs,
  formatPercent,
  formatTokens,
  getAiUsageWindow,
  type AiUsageWindowKey,
} from "@/lib/ai-usage";
import { adminApi } from "@/lib/api";
import type { AiUsageStatus } from "@/lib/types";

const STATUS_OPTIONS: ReadonlyArray<{ readonly value: "all" | AiUsageStatus; readonly label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "started", label: "In flight" },
  { value: "aborted", label: "Aborted" },
];

export const AiUsagePage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const windowKey = (searchParams.get("window") ?? "30d") as AiUsageWindowKey;
  const window = getAiUsageWindow(windowKey);
  const statusFilter = (searchParams.get("status") ?? "all") as "all" | AiUsageStatus;
  const modelFilter = searchParams.get("model") ?? "";
  const userFilter = searchParams.get("userId") ?? "";
  const computerFilter = searchParams.get("computerId") ?? "";
  const pathFilter = searchParams.get("path") ?? "";

  const fromIso = React.useMemo(() => computeWindowFrom(window).toISOString(), [window]);

  const summary = useAdminQuery(
    () => adminApi.summarizeAiUsage({ from: fromIso }),
    [fromIso],
  );
  const buckets = useAdminQuery(
    () => adminApi.bucketAiUsage({ from: fromIso, bucket: window.bucket }),
    [fromIso, window.bucket],
  );
  const modelBreakdown = useAdminQuery(
    () => adminApi.breakdownAiUsage({ from: fromIso, groupBy: "model", limit: 10 }),
    [fromIso],
  );
  const userBreakdown = useAdminQuery(
    () => adminApi.breakdownAiUsage({ from: fromIso, groupBy: "user", limit: 10 }),
    [fromIso],
  );
  const list = useAdminQuery(
    () =>
      adminApi.listAiUsage({
        from: fromIso,
        limit: 100,
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...(modelFilter.length > 0 ? { model: modelFilter } : {}),
        ...(userFilter.length > 0 ? { userId: userFilter } : {}),
        ...(computerFilter.length > 0 ? { computerId: computerFilter } : {}),
      }),
    [fromIso, statusFilter, modelFilter, userFilter, computerFilter],
  );

  const updateParam = (name: string, value: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value === null || value.length === 0) {
        next.delete(name);
      } else {
        next.set(name, value);
      }
      return next;
    });
  };

  const reloadAll = () => {
    summary.reload();
    buckets.reload();
    modelBreakdown.reload();
    userBreakdown.reload();
    list.reload();
  };

  const filteredUsage = React.useMemo(() => {
    if (list.data === undefined) {
      return [];
    }
    if (pathFilter.trim().length === 0) {
      return list.data.usage;
    }
    const needle = pathFilter.trim().toLowerCase();
    return list.data.usage.filter((row) => row.upstreamPath.toLowerCase().includes(needle));
  }, [list.data, pathFilter]);

  const summaryError = summary.error ?? buckets.error ?? modelBreakdown.error ?? userBreakdown.error;

  const topModelItems: TopBarItem[] = React.useMemo(
    () =>
      (modelBreakdown.data?.groups ?? []).map((row) => ({
        key: row.key,
        label: row.label,
        value: row.totalTokens,
        secondary: `${row.requestCount.toLocaleString()} requests · ${row.successCount}/${row.requestCount} ok`,
      })),
    [modelBreakdown.data?.groups],
  );

  const topUserItems: TopBarItem[] = React.useMemo(
    () =>
      (userBreakdown.data?.groups ?? []).map((row) => ({
        key: row.key,
        label: row.label,
        to: `/users/${row.key}`,
        value: row.totalTokens,
        secondary: `${row.requestCount.toLocaleString()} requests`,
      })),
    [userBreakdown.data?.groups],
  );

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> AI gateway
          </span>
        }
        description="Token usage, model mix, and recent requests through the cloud AI gateway."
        actions={
          <>
            <Select
              value={windowKey}
              onValueChange={(value) => updateParam("window", value === "30d" ? null : value)}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_USAGE_WINDOWS.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={reloadAll} disabled={summary.loading} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </>
        }
      />

      {summaryError !== null && summaryError !== undefined ? (
        <ErrorState message={summaryError} onRetry={reloadAll} />
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {summary.loading || summary.data === undefined ? (
              Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24" />)
            ) : (
              <>
                <StatCard
                  label="Requests"
                  value={summary.data.summary.requestCount.toLocaleString()}
                  hint={`${summary.data.summary.successCount} ok · ${summary.data.summary.failedCount} failed`}
                  icon={<Activity className="h-5 w-5" />}
                />
                <StatCard
                  label="Tokens"
                  value={formatTokens(summary.data.summary.totalTokens)}
                  hint={`${formatTokens(summary.data.summary.inputTokens)} in · ${formatTokens(summary.data.summary.outputTokens)} out · ${formatTokens(summary.data.summary.cachedInputTokens)} cached`}
                  icon={<Sparkles className="h-5 w-5" />}
                />
                <StatCard
                  label="Failure rate"
                  value={formatPercent(summary.data.summary.failedCount, summary.data.summary.requestCount)}
                  hint={`${summary.data.summary.failedCount.toLocaleString()} failed · ${summary.data.summary.abortedCount.toLocaleString()} aborted`}
                  tone={summary.data.summary.failedCount > 0 ? "destructive" : "default"}
                  icon={<AlertTriangle className="h-5 w-5" />}
                />
                <StatCard
                  label="Avg duration"
                  value={formatDurationMs(summary.data.summary.avgDurationMs)}
                  hint={`p50 ${formatDurationMs(summary.data.summary.p50DurationMs)} · p95 ${formatDurationMs(summary.data.summary.p95DurationMs)}`}
                  icon={<Timer className="h-5 w-5" />}
                />
              </>
            )}
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summary.loading || summary.data === undefined ? (
              Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20" />)
            ) : (
              <>
                <StatCard
                  label="Active users"
                  value={summary.data.summary.distinctUsers.toLocaleString()}
                  icon={<UsersIcon className="h-5 w-5" />}
                />
                <StatCard
                  label="Active machines"
                  value={summary.data.summary.distinctComputers.toLocaleString()}
                  icon={<Gauge className="h-5 w-5" />}
                />
                <StatCard
                  label="Models used"
                  value={summary.data.summary.distinctModels.toLocaleString()}
                  icon={<Cpu className="h-5 w-5" />}
                />
              </>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Tokens over time</CardTitle>
                <CardDescription>Stacked input · cached · output · reasoning per {window.bucket}.</CardDescription>
              </CardHeader>
              <CardContent>
                {buckets.loading ? (
                  <Skeleton className="h-60" />
                ) : (
                  <TokensOverTimeChart
                    buckets={buckets.data?.buckets ?? []}
                    granularity={window.bucket}
                  />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Requests over time</CardTitle>
                <CardDescription>Counts segmented by status per {window.bucket}.</CardDescription>
              </CardHeader>
              <CardContent>
                {buckets.loading ? (
                  <Skeleton className="h-60" />
                ) : (
                  <RequestsOverTimeChart
                    buckets={buckets.data?.buckets ?? []}
                    granularity={window.bucket}
                  />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Top models</CardTitle>
                <CardDescription>By total tokens in the selected window.</CardDescription>
              </CardHeader>
              <CardContent>
                {modelBreakdown.loading ? (
                  <Skeleton className="h-32" />
                ) : (
                  <TopBarList
                    items={topModelItems}
                    valueFormatter={formatTokens}
                    emptyLabel="No model data yet"
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top users</CardTitle>
                <CardDescription>Token consumers in the selected window.</CardDescription>
              </CardHeader>
              <CardContent>
                {userBreakdown.loading ? (
                  <Skeleton className="h-32" />
                ) : (
                  <TopBarList
                    items={topUserItems}
                    valueFormatter={formatTokens}
                    emptyLabel="No user activity"
                    renderLink={(item, content) =>
                      item.to !== undefined ? (
                        <Link to={item.to} className="block hover:opacity-90">
                          {content}
                        </Link>
                      ) : (
                        content
                      )
                    }
                  />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="space-y-3">
              <div>
                <CardTitle>Recent requests</CardTitle>
                <CardDescription>Latest 100 calls in the selected window.</CardDescription>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-5">
                <Select
                  value={statusFilter}
                  onValueChange={(value) => updateParam("status", value === "all" ? null : value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Filter by model"
                  value={modelFilter}
                  onChange={(event) => updateParam("model", event.target.value)}
                />
                <Input
                  placeholder="User id"
                  value={userFilter}
                  onChange={(event) => updateParam("userId", event.target.value)}
                />
                <Input
                  placeholder="Computer id"
                  value={computerFilter}
                  onChange={(event) => updateParam("computerId", event.target.value)}
                />
                <Input
                  placeholder="Path contains…"
                  value={pathFilter}
                  onChange={(event) => updateParam("path", event.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Started</TableHead>
                    <TableHead>User · machine</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="w-20 text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.loading ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-5" />
                      </TableCell>
                    </TableRow>
                  ) : filteredUsage.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                        No requests
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsage.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Link to={`/ai-usage/${row.id}`} className="block hover:underline">
                            <RelativeTime value={row.startedAt} />
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">
                          <Link
                            to={`/users/${row.userId}`}
                            className="block truncate font-medium hover:underline"
                          >
                            {row.userEmail ?? row.userId.slice(0, 8)}
                          </Link>
                          <Link
                            to={`/computers/${row.computerId}`}
                            className="block truncate text-xs text-muted-foreground hover:underline"
                          >
                            {row.computerName ?? row.computerId.slice(0, 8)}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.model ?? "—"}</TableCell>
                        <TableCell className="max-w-[280px] truncate font-mono text-xs text-muted-foreground" title={`${row.method} ${row.upstreamPath}`}>
                          <span className="text-foreground/80">{row.method}</span> {row.upstreamPath}
                        </TableCell>
                        <TableCell>
                          <AiUsageStatusBadge status={row.status} httpStatus={row.httpStatus} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          <div>{formatTokens(row.totalTokens)}</div>
                          <div className="text-muted-foreground">
                            {formatTokens(row.inputTokens)} → {formatTokens(row.outputTokens)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {formatDurationMs(row.durationMs)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
};
