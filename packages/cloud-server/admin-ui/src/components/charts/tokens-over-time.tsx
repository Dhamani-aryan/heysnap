import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AdminAiUsageBucket, AiUsageBucketGranularity } from "@/lib/types";

interface TokensOverTimeProps {
  readonly buckets: ReadonlyArray<AdminAiUsageBucket>;
  readonly granularity: AiUsageBucketGranularity;
  readonly height?: number;
}

interface ChartPoint {
  readonly bucketStart: string;
  readonly label: string;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
}

const SERIES: ReadonlyArray<{
  readonly key: keyof Omit<ChartPoint, "bucketStart" | "label">;
  readonly name: string;
  readonly color: string;
}> = [
  { key: "inputTokens", name: "Input", color: "hsl(217, 91%, 60%)" },
  { key: "cachedInputTokens", name: "Cached input", color: "hsl(189, 94%, 43%)" },
  { key: "outputTokens", name: "Output", color: "hsl(142, 71%, 45%)" },
  { key: "reasoningOutputTokens", name: "Reasoning", color: "hsl(38, 92%, 55%)" },
];

export const TokensOverTimeChart: React.FC<TokensOverTimeProps> = ({ buckets, granularity, height = 240 }) => {
  const data = React.useMemo<ChartPoint[]>(
    () => buckets.map((bucket) => ({
      bucketStart: bucket.bucketStart,
      label: formatBucketLabel(bucket.bucketStart, granularity),
      inputTokens: bucket.inputTokens,
      cachedInputTokens: bucket.cachedInputTokens,
      outputTokens: bucket.outputTokens,
      reasoningOutputTokens: bucket.reasoningOutputTokens,
    })),
    [buckets, granularity],
  );

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        No tokens recorded in this window
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
        <defs>
          {SERIES.map((series) => (
            <linearGradient key={series.key} id={`tokens-${series.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series.color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={series.color} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} width={48} />
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
        {SERIES.map((series) => (
          <Area
            key={series.key}
            type="monotone"
            dataKey={series.key}
            name={series.name}
            stackId="tokens"
            stroke={series.color}
            fill={`url(#tokens-${series.key})`}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
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
