import type { AiUsageBucketGranularity } from "./types";

export type AiUsageWindowKey = "24h" | "7d" | "30d" | "90d";

export interface AiUsageWindow {
  readonly key: AiUsageWindowKey;
  readonly label: string;
  readonly hours: number;
  readonly bucket: AiUsageBucketGranularity;
}

export const AI_USAGE_WINDOWS: ReadonlyArray<AiUsageWindow> = [
  { key: "24h", label: "Last 24h", hours: 24, bucket: "hour" },
  { key: "7d", label: "Last 7 days", hours: 24 * 7, bucket: "day" },
  { key: "30d", label: "Last 30 days", hours: 24 * 30, bucket: "day" },
  { key: "90d", label: "Last 90 days", hours: 24 * 90, bucket: "day" },
];

export const getAiUsageWindow = (key: string | null | undefined): AiUsageWindow => {
  return (
    AI_USAGE_WINDOWS.find((window) => window.key === key) ??
    AI_USAGE_WINDOWS[2]!
  );
};

export const computeWindowFrom = (window: AiUsageWindow, now: Date = new Date()): Date => {
  return new Date(now.getTime() - window.hours * 60 * 60 * 1000);
};

export const formatTokens = (value: number): string => {
  if (value < 1000) {
    return value.toLocaleString();
  }
  if (value < 1_000_000) {
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  }
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
};

export const formatDurationMs = (value: number | null): string => {
  if (value === null) {
    return "—";
  }
  if (value < 1000) {
    return `${value} ms`;
  }
  if (value < 60_000) {
    return `${(value / 1000).toFixed(1)} s`;
  }
  return `${(value / 60_000).toFixed(1)} min`;
};

export const formatPercent = (numerator: number, denominator: number): string => {
  if (denominator === 0) {
    return "0%";
  }
  const ratio = (numerator / denominator) * 100;
  if (ratio < 1 && ratio > 0) {
    return `${ratio.toFixed(2)}%`;
  }
  return `${ratio.toFixed(1)}%`;
};
