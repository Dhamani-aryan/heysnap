export type ComputerKind = "cloud" | "local";
export type ReleaseTarget = "desktop" | "machine-server";
export type ComputerStatus =
  | "creating"
  | "starting"
  | "online"
  | "idle"
  | "sleeping"
  | "offline"
  | "failed"
  | "deleted";

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ComputerRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly kind: ComputerKind;
  readonly status: ComputerStatus;
  readonly providerMetadata: unknown;
  readonly capabilities: unknown;
  readonly machineHealth: unknown;
  readonly machineServerVersion: string | null;
  readonly lastHeartbeatAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MachineIdentityRecord {
  readonly id: string;
  readonly computerId: string;
  readonly bootstrapTokenHash: string | null;
  readonly tokenHash: string | null;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface ComputerAccessSessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly computerId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface ReleaseManifestRecord {
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
  readonly releasedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type AiUsageStatus = "started" | "succeeded" | "failed" | "aborted";

export interface AiUsageRequestRecord {
  readonly id: string;
  readonly userId: string;
  readonly computerId: string;
  readonly machineIdentityId: string;
  readonly provider: string;
  readonly model: string | null;
  readonly method: string;
  readonly upstreamPath: string;
  readonly status: string;
  readonly httpStatus: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly durationMs: number | null;
  readonly errorMessage: string | null;
  readonly metadata: unknown;
}

export interface AiUsagePayloadRecord {
  readonly id: string;
  readonly usageRequestId: string;
  readonly requestHeaders: unknown;
  readonly requestBody: string | null;
  readonly requestBodyTruncated: boolean;
  readonly responseHeaders: unknown;
  readonly responseBody: string | null;
  readonly responseBodyTruncated: boolean;
  readonly createdAt: Date;
}

export interface AiUsageSummary {
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

export type AiUsageBucketGranularity = "hour" | "day";

export interface AiUsageBucket {
  readonly bucketStart: Date;
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

export type AiUsageGroupBy = "model" | "status" | "user" | "computer";

export interface AiUsageBreakdownRow {
  readonly key: string;
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

export interface CloudStore {
  createUser(input: {
    readonly email: string;
    readonly passwordHash: string;
  }): Promise<UserRecord>;
  listUsers(): Promise<UserRecord[]>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserById(userId: string): Promise<UserRecord | null>;
  updateUserPassword(input: {
    readonly userId: string;
    readonly passwordHash: string;
  }): Promise<UserRecord | null>;
  deleteUserById(userId: string): Promise<boolean>;

  createSession(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<SessionRecord>;
  getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  revokeSession(sessionId: string, revokedAt: Date): Promise<void>;
  listSessionsForUser(userId: string): Promise<SessionRecord[]>;
  revokeAllSessionsForUser(userId: string, revokedAt: Date): Promise<number>;

  listComputersForUser(userId: string): Promise<ComputerRecord[]>;
  listComputers(): Promise<ComputerRecord[]>;
  createComputer(input: {
    readonly ownerUserId: string;
    readonly name: string;
    readonly kind: ComputerKind;
    readonly status: ComputerStatus;
    readonly providerMetadata: unknown;
    readonly capabilities: unknown;
    readonly machineHealth?: unknown;
  }): Promise<ComputerRecord>;
  getComputerForUser(input: {
    readonly userId: string;
    readonly computerId: string;
  }): Promise<ComputerRecord | null>;
  updateComputerForUser(input: {
    readonly userId: string;
    readonly computerId: string;
    readonly name?: string;
    readonly status?: ComputerStatus;
    readonly providerMetadata?: unknown;
    readonly capabilities?: unknown;
    readonly machineHealth?: unknown;
    readonly machineServerVersion?: string | null;
    readonly lastHeartbeatAt?: Date | null;
  }): Promise<ComputerRecord | null>;
  getComputerById(computerId: string): Promise<ComputerRecord | null>;
  updateComputerById(input: {
    readonly computerId: string;
    readonly status?: ComputerStatus;
    readonly providerMetadata?: unknown;
    readonly capabilities?: unknown;
    readonly machineHealth?: unknown;
    readonly machineServerVersion?: string | null;
    readonly lastHeartbeatAt?: Date | null;
  }): Promise<ComputerRecord | null>;
  deleteComputerForUser(input: {
    readonly userId: string;
    readonly computerId: string;
  }): Promise<boolean>;
  deleteComputerById(computerId: string): Promise<boolean>;
  renameComputerById(input: {
    readonly computerId: string;
    readonly name: string;
  }): Promise<ComputerRecord | null>;

  createMachineIdentity(input: {
    readonly computerId: string;
    readonly bootstrapTokenHash: string;
  }): Promise<MachineIdentityRecord>;
  getMachineIdentityByBootstrapTokenHash(bootstrapTokenHash: string): Promise<MachineIdentityRecord | null>;
  getMachineIdentityByTokenHash(tokenHash: string): Promise<MachineIdentityRecord | null>;
  activateMachineIdentity(input: {
    readonly identityId: string;
    readonly tokenHash: string;
    readonly activatedAt: Date;
  }): Promise<MachineIdentityRecord | null>;
  touchMachineIdentity(input: {
    readonly identityId: string;
    readonly lastUsedAt: Date;
  }): Promise<void>;
  listMachineIdentitiesForComputer(computerId: string): Promise<MachineIdentityRecord[]>;
  revokeMachineIdentity(input: {
    readonly identityId: string;
    readonly revokedAt: Date;
  }): Promise<MachineIdentityRecord | null>;

  createComputerAccessSession(input: {
    readonly userId: string;
    readonly computerId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<ComputerAccessSessionRecord>;
  getComputerAccessSessionByTokenHash(tokenHash: string): Promise<ComputerAccessSessionRecord | null>;
  listAccessSessionsForComputer(input: {
    readonly computerId: string;
    readonly limit?: number;
  }): Promise<ComputerAccessSessionRecord[]>;

  getReleaseManifest(input: {
    readonly target: ReleaseTarget;
    readonly channel: string;
    readonly platform: string;
  }): Promise<ReleaseManifestRecord | null>;
  listReleaseManifests(): Promise<ReleaseManifestRecord[]>;
  upsertReleaseManifest(input: {
    readonly target: ReleaseTarget;
    readonly channel: string;
    readonly platform: string;
    readonly version: string;
    readonly downloadUrl?: string | null;
    readonly signatureUrl?: string | null;
    readonly dockerImage?: string | null;
    readonly notes?: string | null;
    readonly metadata: unknown;
    readonly releasedAt: Date;
  }): Promise<ReleaseManifestRecord>;
  deleteReleaseManifest(id: string): Promise<boolean>;

  createAiUsageRequest(input: {
    readonly userId: string;
    readonly computerId: string;
    readonly machineIdentityId: string;
    readonly provider: string;
    readonly model?: string | null;
    readonly method: string;
    readonly upstreamPath: string;
    readonly status: AiUsageStatus;
    readonly httpStatus?: number | null;
    readonly metadata?: unknown;
    readonly startedAt?: Date;
  }): Promise<AiUsageRequestRecord>;
  updateAiUsageRequest(input: {
    readonly id: string;
    readonly status: AiUsageStatus;
    readonly httpStatus?: number | null;
    readonly model?: string | null;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cachedInputTokens?: number;
    readonly reasoningOutputTokens?: number;
    readonly totalTokens?: number;
    readonly completedAt?: Date | null;
    readonly durationMs?: number | null;
    readonly errorMessage?: string | null;
    readonly metadata?: unknown;
  }): Promise<AiUsageRequestRecord | null>;
  createAiUsagePayload(input: {
    readonly usageRequestId: string;
    readonly requestHeaders: unknown;
    readonly requestBody: string | null;
    readonly requestBodyTruncated: boolean;
    readonly responseHeaders: unknown;
    readonly responseBody: string | null;
    readonly responseBodyTruncated: boolean;
  }): Promise<AiUsagePayloadRecord>;
  getAiUsageRequestById(id: string): Promise<AiUsageRequestRecord | null>;
  getAiUsagePayloadByRequestId(usageRequestId: string): Promise<AiUsagePayloadRecord | null>;
  listAiUsageRequests(input?: {
    readonly userId?: string;
    readonly computerId?: string;
    readonly status?: AiUsageStatus;
    readonly model?: string;
    readonly from?: Date;
    readonly before?: Date;
    readonly limit?: number;
  }): Promise<AiUsageRequestRecord[]>;
  summarizeAiUsageRequests(input?: {
    readonly userId?: string;
    readonly computerId?: string;
    readonly model?: string;
    readonly status?: AiUsageStatus;
    readonly from?: Date;
    readonly to?: Date;
  }): Promise<AiUsageSummary>;
  bucketAiUsageRequests(input: {
    readonly userId?: string;
    readonly computerId?: string;
    readonly model?: string;
    readonly status?: AiUsageStatus;
    readonly from?: Date;
    readonly to?: Date;
    readonly bucket: AiUsageBucketGranularity;
  }): Promise<AiUsageBucket[]>;
  groupAiUsageRequests(input: {
    readonly groupBy: AiUsageGroupBy;
    readonly userId?: string;
    readonly computerId?: string;
    readonly model?: string;
    readonly status?: AiUsageStatus;
    readonly from?: Date;
    readonly to?: Date;
    readonly limit?: number;
  }): Promise<AiUsageBreakdownRow[]>;
}
