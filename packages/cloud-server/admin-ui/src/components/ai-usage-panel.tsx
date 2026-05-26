import { Activity, DollarSign, RefreshCw, Sparkles, Timer } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";

import { AiUsageStatusBadge } from "@/components/ai-usage-status-badge";
import { TokensOverTimeChart } from "@/components/charts/tokens-over-time";
import { TopBarList, type TopBarItem } from "@/components/charts/top-bar";
import { ErrorState } from "@/components/error-state";
import { RelativeTime } from "@/components/relative-time";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  formatCurrency,
  formatDurationMs,
  formatTokens,
  getAiUsageWindow,
  type AiUsageWindowKey,
} from "@/lib/ai-usage";
import { adminApi } from "@/lib/api";
import type { AdminAiUsageOverview } from "@/lib/types";

type Scope =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "computer"; readonly computerId: string };

interface AiUsagePanelProps {
  readonly scope: Scope;
  readonly defaultWindow?: AiUsageWindowKey;
}

export const AiUsagePanel: React.FC<AiUsagePanelProps> = ({ scope, defaultWindow = "30d" }) => {
  const [windowKey, setWindowKey] = React.useState<AiUsageWindowKey>(defaultWindow);
  const window = getAiUsageWindow(windowKey);
  const fromIso = React.useMemo(() => computeWindowFrom(window).toISOString(), [window]);

  const overview = useAdminQuery<AdminAiUsageOverview>(
    () =>
      scope.kind === "user"
        ? adminApi.getUserAiUsage(scope.userId, { from: fromIso, bucket: window.bucket })
        : adminApi.getComputerAiUsage(scope.computerId, { from: fromIso, bucket: window.bucket }),
    [scope.kind, scope.kind === "user" ? scope.userId : scope.computerId, fromIso, window.bucket],
  );

  const list = useAdminQuery(
    () =>
      adminApi.listAiUsage({
        from: fromIso,
        limit: 50,
        ...(scope.kind === "user" ? { userId: scope.userId } : { computerId: scope.computerId }),
      }),
    [scope.kind, scope.kind === "user" ? scope.userId : scope.computerId, fromIso],
  );

  const reload = () => {
    overview.reload();
    list.reload();
  };

  if (overview.error !== null) {
    return <ErrorState message={overview.error} onRetry={reload} />;
  }

  const summary = overview.data?.summary;
  const buckets = overview.data?.buckets ?? [];
  const modelGroups = overview.data?.breakdown.models ?? [];
  const secondaryGroups =
    scope.kind === "user"
      ? overview.data?.breakdown.computers ?? []
      : overview.data?.breakdown.users ?? [];

  const modelItems: TopBarItem[] = modelGroups.map((row) => ({
    key: row.key,
    label: row.label,
    value: row.estimatedCostUsd,
    secondary: `${formatTokens(row.totalTokens)} tokens · ${row.requestCount.toLocaleString()} requests`,
  }));

  const secondaryItems: TopBarItem[] = secondaryGroups.map((row) => ({
    key: row.key,
    label: row.label,
    to: scope.kind === "user" ? `/computers/${row.key}` : `/users/${row.key}`,
    value: row.estimatedCostUsd,
    secondary: `${formatTokens(row.totalTokens)} tokens · ${row.requestCount.toLocaleString()} requests`,
  }));

  const secondaryTitle = scope.kind === "user" ? "Top machines" : "Top users";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Select value={windowKey} onValueChange={(value) => setWindowKey(value as AiUsageWindowKey)}>
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
        <Button variant="outline" size="sm" onClick={reload} disabled={overview.loading} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {overview.loading || summary === undefined ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24" />)
        ) : (
          <>
            <StatCard
              label="Requests"
              value={summary.requestCount.toLocaleString()}
              hint={`${summary.successCount} ok · ${summary.failedCount} failed · ${summary.startedCount} in progress`}
              icon={<Activity className="h-5 w-5" />}
            />
            <StatCard
              label="Estimated cost"
              value={formatCurrency(summary.estimatedCostUsd)}
              hint={`${formatTokens(summary.totalTokens)} tokens`}
              icon={<DollarSign className="h-5 w-5" />}
            />
            <StatCard
              label="Tokens"
              value={formatTokens(summary.totalTokens)}
              hint={`${formatTokens(summary.inputTokens)} in · ${formatTokens(summary.outputTokens)} out`}
              icon={<Sparkles className="h-5 w-5" />}
            />
            <StatCard
              label="Avg duration"
              value={formatDurationMs(summary.avgDurationMs)}
              hint={`p50 ${formatDurationMs(summary.p50DurationMs)} · p95 ${formatDurationMs(summary.p95DurationMs)}`}
              icon={<Timer className="h-5 w-5" />}
            />
          </>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Tokens over time</CardTitle>
          <CardDescription>Stacked by token category per {window.bucket}.</CardDescription>
        </CardHeader>
        <CardContent>
          {overview.loading ? (
            <Skeleton className="h-60" />
          ) : (
            <TokensOverTimeChart buckets={buckets} granularity={window.bucket} />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top models</CardTitle>
            <CardDescription>By estimated cost.</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.loading ? (
              <Skeleton className="h-32" />
            ) : (
              <TopBarList
                items={modelItems}
                valueFormatter={formatCurrency}
                emptyLabel="No model data"
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{secondaryTitle}</CardTitle>
            <CardDescription>By estimated cost.</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.loading ? (
              <Skeleton className="h-32" />
            ) : (
              <TopBarList
                items={secondaryItems}
                valueFormatter={formatCurrency}
                emptyLabel="No data"
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
        <CardHeader>
          <CardTitle>Recent requests</CardTitle>
          <CardDescription>Latest 50 requests in the selected window.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Started</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                {scope.kind === "user" ? (
                  <TableHead>Machine</TableHead>
                ) : (
                  <TableHead>User</TableHead>
                )}
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="w-20 text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.loading ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-5" />
                  </TableCell>
                </TableRow>
              ) : (list.data?.usage ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    No AI requests in this window
                  </TableCell>
                </TableRow>
              ) : (
                (list.data?.usage ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link to={`/ai-usage/${row.id}`} className="block hover:underline">
                        <RelativeTime value={row.startedAt} />
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.provider}</TableCell>
                    <TableCell className="font-mono text-xs">{row.model ?? "—"}</TableCell>
                    {scope.kind === "user" ? (
                      <TableCell className="text-sm">
                        <Link to={`/computers/${row.computerId}`} className="hover:underline">
                          {row.computerName ?? row.computerId.slice(0, 8)}
                        </Link>
                      </TableCell>
                    ) : (
                      <TableCell className="text-sm">
                        <Link to={`/users/${row.userId}`} className="hover:underline">
                          {row.userEmail ?? row.userId.slice(0, 8)}
                        </Link>
                      </TableCell>
                    )}
                    <TableCell>
                      <AiUsageStatusBadge status={row.status} httpStatus={row.httpStatus} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatCurrency(row.estimatedCostUsd)}
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
    </div>
  );
};
