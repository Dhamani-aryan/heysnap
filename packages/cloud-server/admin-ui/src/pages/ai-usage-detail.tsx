import { ArrowLeft, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import * as React from "react";
import { Link, useParams } from "react-router-dom";

import { AiUsageStatusBadge } from "@/components/ai-usage-status-badge";
import { CopyButton } from "@/components/copy-button";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { RelativeTime } from "@/components/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { formatCurrency, formatDurationMs, formatTokens } from "@/lib/ai-usage";
import { adminApi } from "@/lib/api";
import type { AdminAiUsageCostBreakdown, AdminAiUsagePayload } from "@/lib/types";

export const AiUsageDetailPage = () => {
  const params = useParams<{ readonly usageId: string }>();
  const usageId = params.usageId ?? "";
  const detail = useAdminQuery(() => adminApi.getAiUsageDetail(usageId), [usageId]);

  if (detail.error !== null) {
    return (
      <>
        <PageHeader
          title="AI usage"
          actions={
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to="/ai-usage">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Link>
            </Button>
          }
        />
        <ErrorState message={detail.error} onRetry={detail.reload} />
      </>
    );
  }

  const usage = detail.data?.usage;
  const payload = usage?.payload ?? null;
  const upstreamUsage = readMetadataRecord(usage?.metadata, "upstreamUsage");

  return (
    <>
      <PageHeader
        title={
          detail.loading || usage === undefined ? (
            <Skeleton className="h-7 w-72" />
          ) : (
            <span className="flex items-center gap-3">
              <span className="font-mono text-base">{usage.model ?? "(model unknown)"}</span>
              <AiUsageStatusBadge status={usage.status} httpStatus={usage.httpStatus} />
            </span>
          )
        }
        description={
          usage !== undefined ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">{usage.id}</span>
              <CopyButton value={usage.id} label="Copy id" />
              <span>·</span>
              <span className="font-mono">{usage.method} {usage.upstreamPath}</span>
            </span>
          ) : null
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to="/ai-usage">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={detail.reload} disabled={detail.loading} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
            <CardDescription>Identity and timing details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="User" value={
              usage === undefined ? null : (
                <Link to={`/users/${usage.userId}`} className="hover:underline">
                  {usage.userEmail ?? usage.userId}
                </Link>
              )
            } />
            <DetailRow label="Machine" value={
              usage === undefined ? null : (
                <Link to={`/computers/${usage.computerId}`} className="hover:underline">
                  {usage.computerName ?? usage.computerId}
                </Link>
              )
            } />
            <DetailRow label="Provider" value={
              usage === undefined ? null : (
                <Badge variant="outline" className="font-mono">{usage.provider}</Badge>
              )
            } />
            <DetailRow label="Identity" value={
              usage === undefined ? null : (
                <span className="font-mono text-xs text-muted-foreground">{usage.machineIdentityId}</span>
              )
            } />
            <DetailRow label="Started" value={usage === undefined ? null : <RelativeTime value={usage.startedAt} />} />
            <DetailRow label="Completed" value={usage === undefined ? null : <RelativeTime value={usage.completedAt} />} />
            <DetailRow
              label="Duration"
              value={usage === undefined ? null : (
                <span className="font-mono">{formatDurationMs(usage.durationMs)}</span>
              )}
            />
            {usage?.errorMessage !== null && usage?.errorMessage !== undefined && (
              <DetailRow
                label="Error"
                value={<span className="text-destructive">{usage.errorMessage}</span>}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tokens</CardTitle>
            <CardDescription>Reported by upstream usage events.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Total" value={
              usage === undefined ? null : (
                <span className="font-mono text-base">{formatTokens(usage.totalTokens)}</span>
              )
            } />
            <DetailRow label="Input" value={usage === undefined ? null : <span className="font-mono">{formatTokens(usage.inputTokens)}</span>} />
            <DetailRow label="Cached input" value={usage === undefined ? null : <span className="font-mono">{formatTokens(usage.cachedInputTokens)}</span>} />
            <DetailRow label="Output" value={usage === undefined ? null : <span className="font-mono">{formatTokens(usage.outputTokens)}</span>} />
            <DetailRow label="Reasoning" value={usage === undefined ? null : <span className="font-mono">{formatTokens(usage.reasoningOutputTokens)}</span>} />
          </CardContent>
        </Card>

        <CostCard cost={usage?.costBreakdown ?? null} loading={usage === undefined} />
      </div>

      {upstreamUsage !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Upstream usage</CardTitle>
            <CardDescription>Raw usage object returned by Azure.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
              {JSON.stringify(upstreamUsage, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Metadata</CardTitle>
          <CardDescription>Raw metadata recorded with the request.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {usage === undefined ? "Loading…" : JSON.stringify(usage.metadata, null, 2)}
          </pre>
        </CardContent>
      </Card>

      {payload !== null && (
        <PayloadSection payload={payload} />
      )}
      {detail.loading === false && payload === null && (
        <Card>
          <CardHeader>
            <CardTitle>Captured payload</CardTitle>
            <CardDescription>
              Bodies are not captured for this request. Set{" "}
              <code className="font-mono">AI_GATEWAY_CAPTURE_BODIES=true</code> to enable.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </>
  );
};

const DetailRow = ({ label, value }: { readonly label: string; readonly value: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-3">
    <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
    <div className="text-right text-sm">{value ?? <Skeleton className="h-4 w-24" />}</div>
  </div>
);

const CostCard = ({
  cost,
  loading,
}: {
  readonly cost: AdminAiUsageCostBreakdown | null;
  readonly loading: boolean;
}) => (
  <Card>
    <CardHeader>
      <CardTitle>Cost</CardTitle>
      <CardDescription>Estimated from stored token usage.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3 text-sm">
      <DetailRow
        label="Total"
        value={loading ? null : <span className="font-mono text-base">{formatCurrency(cost?.totalUsd)}</span>}
      />
      {cost !== null && (
        <>
          <DetailRow label="Rate mode" value={<span className="font-mono text-xs">{cost.rateMode}</span>} />
          <div className="space-y-2 border-t pt-3">
            {cost.lineItems.map((item) => (
              <div key={item.key} className="grid grid-cols-[1fr_auto] gap-3 text-xs">
                <div>
                  <div>{item.label}</div>
                  <div className="text-muted-foreground">
                    {formatTokens(item.tokens)} @ {formatCurrency(item.rateUsdPerMillion)} / 1M
                  </div>
                </div>
                <div className="font-mono">{formatCurrency(item.costUsd)}</div>
              </div>
            ))}
          </div>
          {cost.notes.length > 0 && (
            <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
              {cost.notes.map((note) => <div key={note}>{note}</div>)}
            </div>
          )}
        </>
      )}
    </CardContent>
  </Card>
);

const readMetadataRecord = (metadata: unknown, key: string): Record<string, unknown> | null => {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const PayloadSection = ({ payload }: { readonly payload: AdminAiUsagePayload }) => (
  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
    <PayloadCard
      title="Request"
      headers={payload.requestHeaders}
      body={payload.requestBody}
      truncated={payload.requestBodyTruncated}
    />
    <PayloadCard
      title="Response"
      headers={payload.responseHeaders}
      body={payload.responseBody}
      truncated={payload.responseBodyTruncated}
    />
  </div>
);

const PayloadCard = ({
  title,
  headers,
  body,
  truncated,
}: {
  readonly title: string;
  readonly headers: unknown;
  readonly body: string | null;
  readonly truncated: boolean;
}) => {
  const [headersOpen, setHeadersOpen] = React.useState(false);
  const [bodyOpen, setBodyOpen] = React.useState(true);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Captured payload. Secrets in headers are redacted server-side.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <button
          type="button"
          onClick={() => setHeadersOpen((open) => !open)}
          className="flex w-full items-center justify-between rounded-md border border-border/60 bg-card/40 px-3 py-2 text-left text-sm font-medium hover:bg-accent/30"
        >
          <span className="flex items-center gap-2">
            {headersOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Headers
          </span>
          <Badge variant="outline" className="font-mono text-xs">
            {Object.keys((headers as Record<string, unknown>) ?? {}).length}
          </Badge>
        </button>
        {headersOpen && (
          <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {JSON.stringify(headers, null, 2)}
          </pre>
        )}

        <button
          type="button"
          onClick={() => setBodyOpen((open) => !open)}
          className="flex w-full items-center justify-between rounded-md border border-border/60 bg-card/40 px-3 py-2 text-left text-sm font-medium hover:bg-accent/30"
        >
          <span className="flex items-center gap-2">
            {bodyOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Body
          </span>
          {truncated && (
            <Badge variant="warning" className="font-medium">
              Truncated
            </Badge>
          )}
        </button>
        {bodyOpen && (
          <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {body === null || body.length === 0 ? "(empty body)" : prettyJson(body)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
};

const prettyJson = (input: string): string => {
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
};
