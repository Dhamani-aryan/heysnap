export type ComputerKind = "cloud" | "local";
export type ComputerStatus =
  | "creating"
  | "starting"
  | "online"
  | "idle"
  | "sleeping"
  | "offline"
  | "failed"
  | "deleted";

export interface AdminUser {
  readonly id: string;
  readonly email: string;
  readonly username: string;
  readonly allowPiModels: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminUserSummary extends AdminUser {
  readonly computerCount?: number;
  readonly computers?: AdminComputer[];
}

export interface AdminComputer {
  readonly id: string;
  readonly ownerUserId: string;
  readonly ownerEmail?: string | null;
  readonly name: string;
  readonly kind: ComputerKind;
  readonly status: ComputerStatus;
  readonly providerMetadata: unknown;
  readonly capabilities: unknown;
  readonly machineServerVersion: string | null;
  readonly lastHeartbeatAt: string | null;
  readonly tunnelConnected?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminSession {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminMachineIdentity {
  readonly id: string;
  readonly computerId: string;
  readonly hasBootstrapToken: boolean;
  readonly hasMachineToken: boolean;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface AdminAccessSession {
  readonly id: string;
  readonly userId: string;
  readonly computerId: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export type ReleaseTarget = "machine-server";

export interface AdminRelease {
  readonly id: string;
  readonly target: ReleaseTarget;
  readonly channel: string;
  readonly platform: string;
  readonly version: string;
  readonly downloadUrl: string | null;
  readonly signatureUrl: string | null;
  readonly dockerImage: string | null;
  readonly notes: string | null;
  readonly metadata: unknown;
  readonly releasedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminStats {
  readonly users: number;
  readonly computers: number;
  readonly cloudComputers: number;
  readonly localComputers: number;
  readonly activeComputers: number;
  readonly onlineComputers: number;
  readonly idleComputers: number;
  readonly failedComputers: number;
}

export interface AdminOverview {
  readonly stats: AdminStats;
  readonly users: AdminUserSummary[];
  readonly computers: AdminComputer[];
  readonly releases: AdminRelease[];
}

export interface AdminUserDetail {
  readonly user: AdminUser;
  readonly computers: AdminComputer[];
  readonly sessions: AdminSession[];
}

export interface AdminComputerDetail {
  readonly computer: AdminComputer;
  readonly identities: AdminMachineIdentity[];
  readonly accessSessions: AdminAccessSession[];
}

export type AgentSessionHarness = "codex" | "pi";

export interface AdminAgentSession {
  readonly id: string;
  readonly userId: string;
  readonly username: string | null;
  readonly userEmail: string | null;
  readonly computerId: string;
  readonly computerName: string | null;
  readonly machineIdentityId: string;
  readonly harness: AgentSessionHarness | string;
  readonly nativeThreadId: string;
  readonly threadId: string;
  readonly sourcePath: string | null;
  readonly relativePath: string;
  readonly latestVersionId: string | null;
  readonly latestSha256: string | null;
  readonly latestObjectKey: string | null;
  readonly latestSizeBytes: number | null;
  readonly latestMtime: string | null;
  readonly sourceCreatedAt: string | null;
  readonly sourceUpdatedAt: string | null;
  readonly firstSyncedAt: string;
  readonly lastSyncedAt: string;
  readonly metadata: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminAgentSessionVersion {
  readonly id: string;
  readonly agentSessionThreadId: string;
  readonly userId: string;
  readonly computerId: string;
  readonly machineIdentityId: string;
  readonly harness: AgentSessionHarness | string;
  readonly nativeThreadId: string;
  readonly threadId: string;
  readonly sha256: string;
  readonly objectBucket: string;
  readonly objectKey: string;
  readonly sizeBytes: number;
  readonly sourceMtime: string;
  readonly sourcePath: string | null;
  readonly relativePath: string;
  readonly sourceCreatedAt: string | null;
  readonly sourceUpdatedAt: string | null;
  readonly metadata: unknown;
  readonly uploadedAt: string;
  readonly createdAt: string;
}

export type AiUsageStatus = "started" | "succeeded" | "failed" | "aborted";
export type AiUsageBucketGranularity = "hour" | "day";
export type AiUsageGroupBy = "provider" | "model" | "status" | "user" | "computer";

export interface AdminAiUsageRequest {
  readonly id: string;
  readonly userId: string;
  readonly userEmail: string | null;
  readonly computerId: string;
  readonly computerName: string | null;
  readonly machineIdentityId: string;
  readonly provider: string;
  readonly model: string | null;
  readonly method: string;
  readonly upstreamPath: string;
  readonly status: AiUsageStatus | string;
  readonly httpStatus: number | null;
  readonly estimatedCostUsd: number | null;
  readonly costBreakdown: AdminAiUsageCostBreakdown | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly errorMessage: string | null;
  readonly metadata: unknown;
}

export interface AdminAiUsageCostLineItem {
  readonly key: string;
  readonly label: string;
  readonly tokens: number;
  readonly rateUsdPerMillion: number;
  readonly costUsd: number;
}

export interface AdminAiUsageCostBreakdown {
  readonly currency: "USD" | string;
  readonly model: string;
  readonly totalUsd: number;
  readonly rateMode: string;
  readonly lineItems: readonly AdminAiUsageCostLineItem[];
  readonly notes: readonly string[];
}

export interface AdminAiUsageSummary {
  readonly requestCount: number;
  readonly estimatedCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
  readonly successCount: number;
  readonly failedCount: number;
  readonly abortedCount: number;
  readonly startedCount: number;
  readonly avgDurationMs: number | null;
  readonly p50DurationMs: number | null;
  readonly p95DurationMs: number | null;
  readonly distinctUsers: number;
  readonly distinctComputers: number;
  readonly distinctModels: number;
}

export interface AdminAiUsageBucket {
  readonly bucketStart: string;
  readonly requestCount: number;
  readonly estimatedCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
  readonly successCount: number;
  readonly failedCount: number;
}

export interface AdminAiUsageBreakdownRow {
  readonly key: string;
  readonly label: string;
  readonly requestCount: number;
  readonly estimatedCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
  readonly successCount: number;
  readonly failedCount: number;
}

export interface AdminAiUsagePayload {
  readonly id: string;
  readonly usageRequestId: string;
  readonly requestHeaders: unknown;
  readonly requestBody: string | null;
  readonly requestBodyTruncated: boolean;
  readonly responseHeaders: unknown;
  readonly responseBody: string | null;
  readonly responseBodyTruncated: boolean;
  readonly createdAt: string;
}

export interface AdminAiUsageDetail {
  readonly usage: AdminAiUsageRequest & {
    readonly payload: AdminAiUsagePayload | null;
  };
}

export interface AdminAiUsageOverview {
  readonly summary: AdminAiUsageSummary;
  readonly buckets: AdminAiUsageBucket[];
  readonly breakdown: {
    readonly models: AdminAiUsageBreakdownRow[];
    readonly computers?: AdminAiUsageBreakdownRow[];
    readonly users?: AdminAiUsageBreakdownRow[];
  };
}
