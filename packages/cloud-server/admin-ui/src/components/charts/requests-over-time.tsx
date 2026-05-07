import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AdminAiUsageBucket, AiUsageBucketGranularity } from "@/lib/types";

interface RequestsOverTimeProps {
  readonly buckets: ReadonlyArray<AdminAiUsageBucket>;
  readonly granularity: AiUsageBucketGranularity;
  readonly height?: number;
}

interface ChartPoint {
  readonly bucketStart: string;
  readonly label: string;
  readonly succeeded: number;
  readonly failed: number;
  readonly other: number;
}

export const RequestsOverTimeChart: React.FC<RequestsOverTimeProps> = ({
  buckets,
  granularity,
  height = 220,
}) => {
  const data = React.useMemo<ChartPoint[]>(
    () => buckets.map((bucket) => {
      const other = Math.max(0, bucket.requestCount - bucket.successCount - bucket.failedCount);
      return {
        bucketStart: bucket.bucketStart,
        label: formatBucketLabel(bucket.bucketStart, granularity),
        succeeded: bucket.successCount,
        failed: bucket.failedCount,
        other,
      };
    }),
    [buckets, granularity],
  );

  if (data.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
        No requests in this window
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} width={36} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(value, name) => [Number(value ?? 0).toLocaleString(), String(name ?? "")]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="succeeded" name="Succeeded" stackId="requests" fill="hsl(142, 71%, 45%)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="failed" name="Failed" stackId="requests" fill="hsl(0, 72%, 51%)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="other" name="Other" stackId="requests" fill="hsl(240, 5%, 65%)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
};

const formatBucketLabel = (
  iso: string,
  granularity: AiUsageBucketGranularity,
): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  if (granularity === "hour") {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
    });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};
