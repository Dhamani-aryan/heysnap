import { Activity, AlertTriangle, Cloud, Cpu, DollarSign, Laptop, RefreshCw, Server, Sparkles, Users as UsersIcon } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";

import { TopBarList, type TopBarItem } from "@/components/charts/top-bar";
import { ErrorState } from "@/components/error-state";
import { KindBadge } from "@/components/kind-badge";
import { PageHeader } from "@/components/page-header";
import { RelativeTime } from "@/components/relative-time";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatCurrency, formatTokens } from "@/lib/ai-usage";
import { adminApi } from "@/lib/api";

export const OverviewPage = () => {
  const overview = useAdminQuery(() => adminApi.getOverview());
  const fromIso = React.useMemo(
    () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    [],
  );
  const aiSummary = useAdminQuery(
    () => adminApi.summarizeAiUsage({ from: fromIso }),
    [fromIso],
  );
  const aiTopModels = useAdminQuery(
    () => adminApi.breakdownAiUsage({ from: fromIso, groupBy: "model", limit: 5 }),
    [fromIso],
  );

  const aiTopModelItems: TopBarItem[] = React.useMemo(
    () =>
      (aiTopModels.data?.groups ?? []).map((row) => ({
        key: row.key,
        label: row.label,
        value: row.estimatedCostUsd,
        secondary: `${formatTokens(row.totalTokens)} tokens · ${row.requestCount.toLocaleString()} requests`,
      })),
    [aiTopModels.data?.groups],
  );

  return (
    <>
      <PageHeader
        title="Overview"
        description="Live snapshot of users, machines, and active connections."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              overview.reload();
              aiSummary.reload();
              aiTopModels.reload();
            }}
            disabled={overview.loading}
            className="gap-2"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      {overview.error !== null ? (
        <ErrorState message={overview.error} onRetry={overview.reload} />
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {overview.loading || overview.data === undefined ? (
              Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24" />)
            ) : (
              <>
                <StatCard label="Users" value={overview.data.stats.users} icon={<UsersIcon className="h-5 w-5" />} />
                <StatCard
                  label="Machines"
                  value={overview.data.stats.computers}
                  hint={`${overview.data.stats.cloudComputers} cloud · ${overview.data.stats.localComputers} local`}
                  icon={<Server className="h-5 w-5" />}
                />
                <StatCard
                  label="Active"
                  value={overview.data.stats.activeComputers}
                  hint={`${overview.data.stats.onlineComputers} online · ${overview.data.stats.idleComputers} idle`}
                  tone="success"
                  icon={<Activity className="h-5 w-5" />}
                />
                <StatCard
                  label="Failed"
                  value={overview.data.stats.failedComputers}
                  tone={overview.data.stats.failedComputers > 0 ? "destructive" : "default"}
                  icon={<AlertTriangle className="h-5 w-5" />}
                />
              </>
            )}
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {aiSummary.loading || aiSummary.data === undefined ? (
              Array.from({ length: 2 }).map((_, index) => (
                <Skeleton key={index} className="h-24 sm:col-span-1 lg:col-span-2" />
              ))
            ) : (
              <>
                <StatCard
                  label="AI requests (24h)"
                  value={aiSummary.data.summary.requestCount.toLocaleString()}
                  hint={`${aiSummary.data.summary.successCount} ok · ${aiSummary.data.summary.failedCount} failed · ${aiSummary.data.summary.distinctUsers} users`}
                  icon={<Sparkles className="h-5 w-5" />}
                />
                <StatCard
                  label="AI cost (24h)"
                  value={formatCurrency(aiSummary.data.summary.estimatedCostUsd)}
                  hint={`${formatTokens(aiSummary.data.summary.totalTokens)} tokens`}
                  icon={<DollarSign className="h-5 w-5" />}
                />
                <Card className="sm:col-span-2 lg:col-span-2">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <div>
                      <CardTitle className="text-sm">Top models (24h)</CardTitle>
                      <CardDescription>Estimated spend by model.</CardDescription>
                    </div>
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/ai-usage">View AI usage</Link>
                    </Button>
                  </CardHeader>
                  <CardContent className="pt-2">
                    {aiTopModels.loading ? (
                      <Skeleton className="h-16" />
                    ) : (
                      <TopBarList
                        items={aiTopModelItems}
                        valueFormatter={formatCurrency}
                        emptyLabel="No AI usage yet"
                      />
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>Recent users</CardTitle>
                  <CardDescription>Newest signups by created date.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/users">View all</Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {overview.loading ? (
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-6" />
                    <Skeleton className="h-6" />
                    <Skeleton className="h-6" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead className="w-24">Machines</TableHead>
                        <TableHead className="w-32">Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(overview.data?.users ?? []).slice(0, 6).map((user) => (
                        <TableRow key={user.id}>
                          <TableCell>
                            <Link to={`/users/${user.id}`} className="font-medium hover:underline">
                              {user.email}
                            </Link>
                            <div className="font-mono text-xs text-muted-foreground">{user.id.slice(0, 8)}</div>
                          </TableCell>
                          <TableCell>{user.computerCount ?? user.computers?.length ?? 0}</TableCell>
                          <TableCell>
                            <RelativeTime value={user.createdAt} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {(overview.data?.users ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                            No users yet
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>Recent machines</CardTitle>
                  <CardDescription>Latest cloud and local computers.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/computers">View all</Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {overview.loading ? (
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-6" />
                    <Skeleton className="h-6" />
                    <Skeleton className="h-6" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-32">Heartbeat</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(overview.data?.computers ?? []).slice(0, 6).map((computer) => (
                        <TableRow key={computer.id}>
                          <TableCell>
                            <Link to={`/computers/${computer.id}`} className="font-medium hover:underline">
                              {computer.name}
                            </Link>
                            <div className="flex items-center gap-2 pt-0.5 text-xs text-muted-foreground">
                              <KindBadge kind={computer.kind} />
                              {computer.tunnelConnected === true && (
                                <Badge variant="success" className="font-medium">
                                  Live
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {computer.ownerEmail ?? computer.ownerUserId.slice(0, 8)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={computer.status} />
                          </TableCell>
                          <TableCell>
                            <RelativeTime value={computer.lastHeartbeatAt} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {(overview.data?.computers ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                            No machines yet
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-4 w-4" /> Latest releases
              </CardTitle>
              <CardDescription>Manifests served to desktop and machine-server clients.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {overview.loading ? (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-6" />
                  <Skeleton className="h-6" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Target</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Platform</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead className="w-32">Released</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(overview.data?.releases ?? []).slice(0, 6).map((release) => (
                      <TableRow key={release.id}>
                        <TableCell>
                          <Badge variant="outline" className="gap-1 font-medium">
                            {release.target === "desktop" ? <Laptop className="h-3 w-3" /> : <Cloud className="h-3 w-3" />}
                            {release.target}
                          </Badge>
                        </TableCell>
                        <TableCell className="capitalize">{release.channel}</TableCell>
                        <TableCell className="font-mono text-xs">{release.platform}</TableCell>
                        <TableCell className="font-mono">{release.version}</TableCell>
                        <TableCell>
                          <RelativeTime value={release.releasedAt} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {(overview.data?.releases ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                          No release manifests
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
};
