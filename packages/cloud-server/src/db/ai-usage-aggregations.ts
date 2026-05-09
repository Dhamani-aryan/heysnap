import { calculateAiUsageCost } from "../ai-usage/pricing.js";
import type {
  AiUsageBreakdownRow,
  AiUsageBucket,
  AiUsageBucketGranularity,
  AiUsageGroupBy,
  AiUsageRequestRecord,
  AiUsageSummary,
} from "./types.js";

interface BucketAccumulator {
  bucketStart: Date;
  requestCount: number;
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  successCount: number;
  failedCount: number;
}

interface GroupAccumulator {
  key: string;
  requestCount: number;
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  successCount: number;
  failedCount: number;
}

export const buildEmptyAiUsageSummary = (): AiUsageSummary => ({
  requestCount: 0,
  estimatedCostUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
  successCount: 0,
  failedCount: 0,
  abortedCount: 0,
  startedCount: 0,
  avgDurationMs: null,
  p50DurationMs: null,
  p95DurationMs: null,
  distinctUsers: 0,
  distinctComputers: 0,
  distinctModels: 0,
});

export const summarizeAiUsageRows = (
  rows: ReadonlyArray<AiUsageRequestRecord>,
): AiUsageSummary => {
  if (rows.length === 0) {
    return buildEmptyAiUsageSummary();
  }

  let estimatedCostUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let reasoningOutputTokens = 0;
  let totalTokens = 0;
  let successCount = 0;
  let failedCount = 0;
  let abortedCount = 0;
  let startedCount = 0;
  const successDurations: number[] = [];
  const userIds = new Set<string>();
  const computerIds = new Set<string>();
  const models = new Set<string>();

  for (const row of rows) {
    estimatedCostUsd += calculateAiUsageCost(row)?.totalUsd ?? 0;
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    cachedInputTokens += row.cachedInputTokens;
    reasoningOutputTokens += row.reasoningOutputTokens;
    totalTokens += row.totalTokens;

    switch (row.status) {
      case "succeeded":
        successCount += 1;
        if (row.durationMs !== null) {
          successDurations.push(row.durationMs);
        }
        break;
      case "failed":
        failedCount += 1;
        break;
      case "aborted":
        abortedCount += 1;
        break;
      case "started":
        startedCount += 1;
        break;
      default:
        break;
    }

    userIds.add(row.userId);
    computerIds.add(row.computerId);
    if (row.model !== null && row.model.length > 0) {
      models.add(row.model);
    }
  }

  return {
    requestCount: rows.length,
    estimatedCostUsd: roundUsd(estimatedCostUsd),
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningOutputTokens,
    totalTokens,
    successCount,
    failedCount,
    abortedCount,
    startedCount,
    avgDurationMs: averageOrNull(successDurations),
    p50DurationMs: percentileOrNull(successDurations, 0.5),
    p95DurationMs: percentileOrNull(successDurations, 0.95),
    distinctUsers: userIds.size,
    distinctComputers: computerIds.size,
    distinctModels: models.size,
  };
};

export const bucketAiUsageRows = (
  rows: ReadonlyArray<AiUsageRequestRecord>,
  granularity: AiUsageBucketGranularity,
): AiUsageBucket[] => {
  const accumulators = new Map<number, BucketAccumulator>();

  for (const row of rows) {
    const bucketStart = truncateToGranularity(row.startedAt, granularity);
    const key = bucketStart.getTime();
    let bucket = accumulators.get(key);
    if (bucket === undefined) {
      bucket = {
        bucketStart,
        requestCount: 0,
        estimatedCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        successCount: 0,
        failedCount: 0,
      };
      accumulators.set(key, bucket);
    }
    bucket.requestCount += 1;
    bucket.estimatedCostUsd += calculateAiUsageCost(row)?.totalUsd ?? 0;
    bucket.inputTokens += row.inputTokens;
    bucket.outputTokens += row.outputTokens;
    bucket.cachedInputTokens += row.cachedInputTokens;
    bucket.reasoningOutputTokens += row.reasoningOutputTokens;
    bucket.totalTokens += row.totalTokens;
    if (row.status === "succeeded") {
      bucket.successCount += 1;
    } else if (row.status === "failed") {
      bucket.failedCount += 1;
    }
  }

  return Array.from(accumulators.values())
    .map((bucket) => ({ ...bucket, estimatedCostUsd: roundUsd(bucket.estimatedCostUsd) }))
    .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime());
};

export const groupAiUsageRows = (
  rows: ReadonlyArray<AiUsageRequestRecord>,
  groupBy: AiUsageGroupBy,
  limit?: number,
): AiUsageBreakdownRow[] => {
  const accumulators = new Map<string, GroupAccumulator>();

  for (const row of rows) {
    const key = readGroupKey(row, groupBy);
    let accumulator = accumulators.get(key);
    if (accumulator === undefined) {
      accumulator = {
        key,
        requestCount: 0,
        estimatedCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        successCount: 0,
        failedCount: 0,
      };
      accumulators.set(key, accumulator);
    }
    accumulator.requestCount += 1;
    accumulator.estimatedCostUsd += calculateAiUsageCost(row)?.totalUsd ?? 0;
    accumulator.inputTokens += row.inputTokens;
    accumulator.outputTokens += row.outputTokens;
    accumulator.cachedInputTokens += row.cachedInputTokens;
    accumulator.reasoningOutputTokens += row.reasoningOutputTokens;
    accumulator.totalTokens += row.totalTokens;
    if (row.status === "succeeded") {
      accumulator.successCount += 1;
    } else if (row.status === "failed") {
      accumulator.failedCount += 1;
    }
  }

  const sorted = Array.from(accumulators.values())
    .map((row) => ({
      ...row,
      estimatedCostUsd: roundUsd(row.estimatedCostUsd),
    }))
    .sort((a, b) => {
      if (b.estimatedCostUsd !== a.estimatedCostUsd) {
        return b.estimatedCostUsd - a.estimatedCostUsd;
      }
      if (b.totalTokens !== a.totalTokens) {
        return b.totalTokens - a.totalTokens;
      }
      return b.requestCount - a.requestCount;
    });

  return limit !== undefined && limit > 0 ? sorted.slice(0, limit) : sorted;
};

const readGroupKey = (
  row: AiUsageRequestRecord,
  groupBy: AiUsageGroupBy,
): string => {
  switch (groupBy) {
    case "model":
      return row.model ?? "unknown";
    case "status":
      return row.status;
    case "user":
      return row.userId;
    case "computer":
      return row.computerId;
    default:
      return "unknown";
  }
};

const truncateToGranularity = (
  value: Date,
  granularity: AiUsageBucketGranularity,
): Date => {
  const result = new Date(value.getTime());
  result.setUTCMilliseconds(0);
  result.setUTCSeconds(0);
  result.setUTCMinutes(0);
  if (granularity === "day") {
    result.setUTCHours(0);
  }
  return result;
};

const averageOrNull = (values: ReadonlyArray<number>): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round(sum / values.length);
};

const percentileOrNull = (
  values: ReadonlyArray<number>,
  percentile: number,
): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.floor(percentile * sorted.length));
  return sorted[rank] ?? null;
};

const roundUsd = (value: number): number => Number(value.toFixed(10));
