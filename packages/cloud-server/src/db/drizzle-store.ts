import { and, desc, eq, gte, isNull, lt, lte, type SQL } from "drizzle-orm";

import type { DbClient } from "./client.js";
import {
  aiUsagePayloads,
  aiUsageRequests,
  computerAccessSessions,
  computers,
  feedbackReports,
  machineIdentities,
  releaseManifests,
  sessions,
  users,
} from "./schema/index.js";
import type {
  AiUsageBreakdownRow,
  AiUsageBucket,
  AiUsageBucketGranularity,
  AiUsageGroupBy,
  AiUsagePayloadRecord,
  AiUsageRequestRecord,
  AiUsageStatus,
  AiUsageSummary,
  CloudStore,
  ComputerAccessSessionRecord,
  ComputerRecord,
  FeedbackReportRecord,
  FeedbackReportStatus,
  MachineIdentityRecord,
  ReleaseManifestRecord,
  ReleaseTarget,
  SessionRecord,
  UserRecord,
} from "./types.js";
import {
  bucketAiUsageRows,
  buildEmptyAiUsageSummary,
  groupAiUsageRows,
  summarizeAiUsageRows,
} from "./ai-usage-aggregations.js";

export class DrizzleCloudStore implements CloudStore {
  constructor(private readonly db: DbClient) {}

  async createUser(input: {
    readonly email: string;
    readonly username: string;
    readonly passwordHash: string;
  }): Promise<UserRecord> {
    const [user] = await this.db.insert(users).values(input).returning();
    return user;
  }

  async listUsers(): Promise<UserRecord[]> {
    return this.db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return user ?? null;
  }

  async getUserByUsername(username: string): Promise<UserRecord | null> {
    const [user] = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    return user ?? null;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    return user ?? null;
  }

  async updateUserPassword(input: {
    readonly userId: string;
    readonly passwordHash: string;
  }): Promise<UserRecord | null> {
    const updatedAt = new Date();
    const [user] = await this.db
      .update(users)
      .set({ passwordHash: input.passwordHash, updatedAt })
      .where(eq(users.id, input.userId))
      .returning();
    return user ?? null;
  }

  async deleteUserById(userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(users)
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    return deleted.length > 0;
  }

  async createSession(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<SessionRecord> {
    const [session] = await this.db.insert(sessions).values(input).returning();
    return session;
  }

  async getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const [session] = await this.db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
    return session ?? null;
  }

  async revokeSession(sessionId: string, revokedAt: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt, updatedAt: revokedAt })
      .where(eq(sessions.id, sessionId));
  }

  async listSessionsForUser(userId: string): Promise<SessionRecord[]> {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt));
  }

  async revokeAllSessionsForUser(userId: string, revokedAt: Date): Promise<number> {
    const updated = await this.db
      .update(sessions)
      .set({ revokedAt, updatedAt: revokedAt })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return updated.length;
  }

  async listComputersForUser(userId: string): Promise<ComputerRecord[]> {
    return this.db
      .select()
      .from(computers)
      .where(eq(computers.ownerUserId, userId));
  }

  async listComputers(): Promise<ComputerRecord[]> {
    return this.db.select().from(computers).orderBy(desc(computers.createdAt));
  }

  async createComputer(input: {
    readonly ownerUserId: string;
    readonly name: string;
    readonly kind: "cloud" | "local";
    readonly status: ComputerRecord["status"];
    readonly providerMetadata: unknown;
    readonly capabilities: unknown;
    readonly machineHealth?: unknown;
  }): Promise<ComputerRecord> {
    const [computer] = await this.db.insert(computers).values({
      ...input,
      machineHealth: input.machineHealth ?? {},
    }).returning();
    return computer;
  }

  async getComputerForUser(input: {
    readonly userId: string;
    readonly computerId: string;
  }): Promise<ComputerRecord | null> {
    const [computer] = await this.db
      .select()
      .from(computers)
      .where(and(eq(computers.id, input.computerId), eq(computers.ownerUserId, input.userId)))
      .limit(1);
    return computer ?? null;
  }

  async updateComputerForUser(input: {
    readonly userId: string;
    readonly computerId: string;
    readonly name?: string;
    readonly status?: ComputerRecord["status"];
    readonly providerMetadata?: unknown;
    readonly capabilities?: unknown;
    readonly machineHealth?: unknown;
    readonly machineServerVersion?: string | null;
    readonly lastHeartbeatAt?: Date | null;
  }): Promise<ComputerRecord | null> {
    const updatedAt = new Date();
    const [computer] = await this.db
      .update(computers)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.providerMetadata !== undefined ? { providerMetadata: input.providerMetadata } : {}),
        ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
        ...(input.machineHealth !== undefined ? { machineHealth: input.machineHealth } : {}),
        ...(input.machineServerVersion !== undefined ? { machineServerVersion: input.machineServerVersion } : {}),
        ...(input.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: input.lastHeartbeatAt } : {}),
        updatedAt,
      })
      .where(and(eq(computers.id, input.computerId), eq(computers.ownerUserId, input.userId)))
      .returning();
    return computer ?? null;
  }

  async getComputerById(computerId: string): Promise<ComputerRecord | null> {
    const [computer] = await this.db
      .select()
      .from(computers)
      .where(eq(computers.id, computerId))
      .limit(1);
    return computer ?? null;
  }

  async updateComputerById(input: {
    readonly computerId: string;
    readonly status?: ComputerRecord["status"];
    readonly providerMetadata?: unknown;
    readonly capabilities?: unknown;
    readonly machineHealth?: unknown;
    readonly machineServerVersion?: string | null;
    readonly lastHeartbeatAt?: Date | null;
  }): Promise<ComputerRecord | null> {
    const updatedAt = new Date();
    const [computer] = await this.db
      .update(computers)
      .set({
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.providerMetadata !== undefined ? { providerMetadata: input.providerMetadata } : {}),
        ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
        ...(input.machineHealth !== undefined ? { machineHealth: input.machineHealth } : {}),
        ...(input.machineServerVersion !== undefined ? { machineServerVersion: input.machineServerVersion } : {}),
        ...(input.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: input.lastHeartbeatAt } : {}),
        updatedAt,
      })
      .where(eq(computers.id, input.computerId))
      .returning();
    return computer ?? null;
  }

  async deleteComputerForUser(input: {
    readonly userId: string;
    readonly computerId: string;
  }): Promise<boolean> {
    const deleted = await this.db
      .delete(computers)
      .where(and(eq(computers.id, input.computerId), eq(computers.ownerUserId, input.userId)))
      .returning({ id: computers.id });
    return deleted.length > 0;
  }

  async deleteComputerById(computerId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(computers)
      .where(eq(computers.id, computerId))
      .returning({ id: computers.id });
    return deleted.length > 0;
  }

  async renameComputerById(input: {
    readonly computerId: string;
    readonly name: string;
  }): Promise<ComputerRecord | null> {
    const updatedAt = new Date();
    const [computer] = await this.db
      .update(computers)
      .set({ name: input.name, updatedAt })
      .where(eq(computers.id, input.computerId))
      .returning();
    return computer ?? null;
  }

  async createMachineIdentity(input: {
    readonly computerId: string;
    readonly bootstrapTokenHash: string;
  }): Promise<MachineIdentityRecord> {
    const [identity] = await this.db.insert(machineIdentities).values(input).returning();
    return identity;
  }

  async getMachineIdentityByBootstrapTokenHash(bootstrapTokenHash: string): Promise<MachineIdentityRecord | null> {
    const [identity] = await this.db
      .select()
      .from(machineIdentities)
      .where(eq(machineIdentities.bootstrapTokenHash, bootstrapTokenHash))
      .limit(1);
    return identity ?? null;
  }

  async getMachineIdentityByTokenHash(tokenHash: string): Promise<MachineIdentityRecord | null> {
    const [identity] = await this.db
      .select()
      .from(machineIdentities)
      .where(eq(machineIdentities.tokenHash, tokenHash))
      .limit(1);
    return identity ?? null;
  }

  async activateMachineIdentity(input: {
    readonly identityId: string;
    readonly tokenHash: string;
    readonly activatedAt: Date;
  }): Promise<MachineIdentityRecord | null> {
    const [identity] = await this.db
      .update(machineIdentities)
      .set({
        bootstrapTokenHash: null,
        tokenHash: input.tokenHash,
        lastUsedAt: input.activatedAt,
      })
      .where(eq(machineIdentities.id, input.identityId))
      .returning();
    return identity ?? null;
  }

  async touchMachineIdentity(input: {
    readonly identityId: string;
    readonly lastUsedAt: Date;
  }): Promise<void> {
    await this.db
      .update(machineIdentities)
      .set({ lastUsedAt: input.lastUsedAt })
      .where(eq(machineIdentities.id, input.identityId));
  }

  async listMachineIdentitiesForComputer(computerId: string): Promise<MachineIdentityRecord[]> {
    return this.db
      .select()
      .from(machineIdentities)
      .where(eq(machineIdentities.computerId, computerId))
      .orderBy(desc(machineIdentities.createdAt));
  }

  async revokeMachineIdentity(input: {
    readonly identityId: string;
    readonly revokedAt: Date;
  }): Promise<MachineIdentityRecord | null> {
    const [identity] = await this.db
      .update(machineIdentities)
      .set({ revokedAt: input.revokedAt })
      .where(eq(machineIdentities.id, input.identityId))
      .returning();
    return identity ?? null;
  }

  async createComputerAccessSession(input: {
    readonly userId: string;
    readonly computerId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<ComputerAccessSessionRecord> {
    const [accessSession] = await this.db.insert(computerAccessSessions).values(input).returning();
    return accessSession;
  }

  async getComputerAccessSessionByTokenHash(tokenHash: string): Promise<ComputerAccessSessionRecord | null> {
    const [accessSession] = await this.db
      .select()
      .from(computerAccessSessions)
      .where(eq(computerAccessSessions.tokenHash, tokenHash))
      .limit(1);
    return accessSession ?? null;
  }

  async listAccessSessionsForComputer(input: {
    readonly computerId: string;
    readonly limit?: number;
  }): Promise<ComputerAccessSessionRecord[]> {
    const query = this.db
      .select()
      .from(computerAccessSessions)
      .where(eq(computerAccessSessions.computerId, input.computerId))
      .orderBy(desc(computerAccessSessions.createdAt));
    return input.limit !== undefined ? query.limit(input.limit) : query;
  }

  async getReleaseManifest(input: {
    readonly target: ReleaseTarget;
    readonly channel: string;
    readonly platform: string;
  }): Promise<ReleaseManifestRecord | null> {
    const [manifest] = await this.db
      .select()
      .from(releaseManifests)
      .where(and(
        eq(releaseManifests.target, input.target),
        eq(releaseManifests.channel, input.channel),
        eq(releaseManifests.platform, input.platform),
      ))
      .limit(1);
    return manifest ?? null;
  }

  async listReleaseManifests(): Promise<ReleaseManifestRecord[]> {
    return this.db.select().from(releaseManifests).orderBy(desc(releaseManifests.releasedAt));
  }

  async upsertReleaseManifest(input: {
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
  }): Promise<ReleaseManifestRecord> {
    const updatedAt = new Date();
    const [manifest] = await this.db
      .insert(releaseManifests)
      .values({
        target: input.target,
        channel: input.channel,
        platform: input.platform,
        version: input.version,
        downloadUrl: input.downloadUrl ?? null,
        signatureUrl: input.signatureUrl ?? null,
        dockerImage: input.dockerImage ?? null,
        notes: input.notes ?? null,
        metadata: input.metadata,
        releasedAt: input.releasedAt,
      })
      .onConflictDoUpdate({
        target: [releaseManifests.target, releaseManifests.channel, releaseManifests.platform],
        set: {
          version: input.version,
          downloadUrl: input.downloadUrl ?? null,
          signatureUrl: input.signatureUrl ?? null,
          dockerImage: input.dockerImage ?? null,
          notes: input.notes ?? null,
          metadata: input.metadata,
          releasedAt: input.releasedAt,
          updatedAt,
        },
      })
      .returning();
    return manifest;
  }

  async deleteReleaseManifest(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(releaseManifests)
      .where(eq(releaseManifests.id, id))
      .returning({ id: releaseManifests.id });
    return deleted.length > 0;
  }

  async createFeedbackReport(input: {
    readonly userId: string;
    readonly computerId: string;
    readonly accessSessionId?: string | null;
    readonly comment: string;
    readonly threadId?: string | null;
    readonly cwd?: string | null;
    readonly clientContext?: unknown;
  }): Promise<FeedbackReportRecord> {
    const [report] = await this.db.insert(feedbackReports).values({
      userId: input.userId,
      computerId: input.computerId,
      accessSessionId: input.accessSessionId ?? null,
      comment: input.comment,
      threadId: input.threadId ?? null,
      cwd: input.cwd ?? null,
      clientContext: input.clientContext ?? {},
    }).returning();
    return report;
  }

  async getFeedbackReportById(id: string): Promise<FeedbackReportRecord | null> {
    const [report] = await this.db.select().from(feedbackReports).where(eq(feedbackReports.id, id)).limit(1);
    return report ?? null;
  }

  async markFeedbackReportCommentOnly(input: {
    readonly feedbackId: string;
    readonly errorMessage?: string | null;
    readonly machineContext?: unknown;
  }): Promise<FeedbackReportRecord | null> {
    const [report] = await this.db
      .update(feedbackReports)
      .set({
        status: "comment_only",
        errorMessage: input.errorMessage ?? null,
        ...(input.machineContext !== undefined ? { machineContext: input.machineContext } : {}),
        completedAt: new Date(),
      })
      .where(eq(feedbackReports.id, input.feedbackId))
      .returning();
    return report ?? null;
  }

  async completeFeedbackReportArchive(input: {
    readonly feedbackId: string;
    readonly machineIdentityId: string;
    readonly archiveStorageKey: string;
    readonly archiveSha256: string;
    readonly archiveBytes: number;
    readonly fileCount: number;
    readonly machineContext?: unknown;
  }): Promise<FeedbackReportRecord | null> {
    const [report] = await this.db
      .update(feedbackReports)
      .set({
        status: "complete",
        machineIdentityId: input.machineIdentityId,
        archiveStorageKey: input.archiveStorageKey,
        archiveSha256: input.archiveSha256,
        archiveBytes: input.archiveBytes,
        fileCount: input.fileCount,
        errorMessage: null,
        machineContext: input.machineContext ?? {},
        completedAt: new Date(),
      })
      .where(eq(feedbackReports.id, input.feedbackId))
      .returning();
    return report ?? null;
  }

  async listFeedbackReports(input: {
    readonly userId?: string;
    readonly computerId?: string;
    readonly status?: FeedbackReportStatus;
    readonly before?: Date;
    readonly limit?: number;
  } = {}): Promise<FeedbackReportRecord[]> {
    const query = this.db
      .select()
      .from(feedbackReports)
      .where(buildFeedbackReportWhere(input))
      .orderBy(desc(feedbackReports.createdAt));
    return input.limit !== undefined ? query.limit(input.limit) : query;
  }

  async createAiUsageRequest(input: {
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
  }): Promise<AiUsageRequestRecord> {
    const [usage] = await this.db.insert(aiUsageRequests).values({
      userId: input.userId,
      computerId: input.computerId,
      machineIdentityId: input.machineIdentityId,
      provider: input.provider,
      model: input.model ?? null,
      method: input.method,
      upstreamPath: input.upstreamPath,
      status: input.status,
      httpStatus: input.httpStatus ?? null,
      metadata: input.metadata ?? {},
      startedAt: input.startedAt ?? new Date(),
    }).returning();
    return usage;
  }

  async updateAiUsageRequest(input: {
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
  }): Promise<AiUsageRequestRecord | null> {
    const [usage] = await this.db
      .update(aiUsageRequests)
      .set({
        status: input.status,
        ...(input.httpStatus !== undefined ? { httpStatus: input.httpStatus } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.inputTokens !== undefined ? { inputTokens: input.inputTokens } : {}),
        ...(input.outputTokens !== undefined ? { outputTokens: input.outputTokens } : {}),
        ...(input.cachedInputTokens !== undefined ? { cachedInputTokens: input.cachedInputTokens } : {}),
        ...(input.reasoningOutputTokens !== undefined
          ? { reasoningOutputTokens: input.reasoningOutputTokens }
          : {}),
        ...(input.totalTokens !== undefined ? { totalTokens: input.totalTokens } : {}),
        ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
        ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
        ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      })
      .where(eq(aiUsageRequests.id, input.id))
      .returning();
    return usage ?? null;
  }

  async createAiUsagePayload(input: {
    readonly usageRequestId: string;
    readonly requestHeaders: unknown;
    readonly requestBody: string | null;
    readonly requestBodyTruncated: boolean;
    readonly responseHeaders: unknown;
    readonly responseBody: string | null;
    readonly responseBodyTruncated: boolean;
  }): Promise<AiUsagePayloadRecord> {
    const [payload] = await this.db.insert(aiUsagePayloads).values(input).returning();
    return payload;
  }

  async getAiUsageRequestById(id: string): Promise<AiUsageRequestRecord | null> {
    const [usage] = await this.db.select().from(aiUsageRequests).where(eq(aiUsageRequests.id, id)).limit(1);
    return usage ?? null;
  }

  async getAiUsagePayloadByRequestId(usageRequestId: string): Promise<AiUsagePayloadRecord | null> {
    const [payload] = await this.db
      .select()
      .from(aiUsagePayloads)
      .where(eq(aiUsagePayloads.usageRequestId, usageRequestId))
      .limit(1);
    return payload ?? null;
  }

  async listAiUsageRequests(input: {
    readonly userId?: string;
    readonly computerId?: string;
    readonly provider?: string;
    readonly status?: AiUsageStatus;
    readonly model?: string;
    readonly from?: Date;
    readonly before?: Date;
    readonly limit?: number;
  } = {}): Promise<AiUsageRequestRecord[]> {
    const query = this.db
      .select()
      .from(aiUsageRequests)
      .where(buildAiUsageWhere(input))
      .orderBy(desc(aiUsageRequests.startedAt));
    return input.limit !== undefined ? query.limit(input.limit) : query;
  }

  async summarizeAiUsageRequests(input: {
    readonly userId?: string;
    readonly computerId?: string;
    readonly provider?: string;
    readonly model?: string;
    readonly status?: AiUsageStatus;
    readonly from?: Date;
    readonly to?: Date;
  } = {}): Promise<AiUsageSummary> {
    const rows = await this.db
      .select()
      .from(aiUsageRequests)
      .where(buildAiUsageWhere(input));
    if (rows.length === 0) {
      return buildEmptyAiUsageSummary();
    }
    return summarizeAiUsageRows(rows);
  }

  async bucketAiUsageRequests(input: {
    readonly userId?: string;
    readonly computerId?: string;
    readonly provider?: string;
    readonly model?: string;
    readonly status?: AiUsageStatus;
    readonly from?: Date;
    readonly to?: Date;
    readonly bucket: AiUsageBucketGranularity;
  }): Promise<AiUsageBucket[]> {
    const rows = await this.db
      .select()
      .from(aiUsageRequests)
      .where(buildAiUsageWhere(input));
    return bucketAiUsageRows(rows, input.bucket);
  }

  async groupAiUsageRequests(input: {
    readonly groupBy: AiUsageGroupBy;
    readonly userId?: string;
    readonly computerId?: string;
    readonly provider?: string;
    readonly model?: string;
    readonly status?: AiUsageStatus;
    readonly from?: Date;
    readonly to?: Date;
    readonly limit?: number;
  }): Promise<AiUsageBreakdownRow[]> {
    const rows = await this.db
      .select()
      .from(aiUsageRequests)
      .where(buildAiUsageWhere(input));
    return groupAiUsageRows(rows, input.groupBy, input.limit);
  }
}

const buildFeedbackReportWhere = (input: {
  readonly userId?: string;
  readonly computerId?: string;
  readonly status?: FeedbackReportStatus;
  readonly before?: Date;
}): SQL | undefined => {
  const conditions: SQL[] = [];

  if (input.userId !== undefined) {
    conditions.push(eq(feedbackReports.userId, input.userId));
  }

  if (input.computerId !== undefined) {
    conditions.push(eq(feedbackReports.computerId, input.computerId));
  }

  if (input.status !== undefined) {
    conditions.push(eq(feedbackReports.status, input.status));
  }

  if (input.before !== undefined) {
    conditions.push(lt(feedbackReports.createdAt, input.before));
  }

  return conditions.length === 0 ? undefined : and(...conditions);
};

const buildAiUsageWhere = (input: {
  readonly userId?: string;
  readonly computerId?: string;
  readonly provider?: string;
  readonly status?: AiUsageStatus;
  readonly model?: string;
  readonly before?: Date;
  readonly from?: Date;
  readonly to?: Date;
}): SQL | undefined => {
  const conditions: SQL[] = [];

  if (input.userId !== undefined) {
    conditions.push(eq(aiUsageRequests.userId, input.userId));
  }

  if (input.computerId !== undefined) {
    conditions.push(eq(aiUsageRequests.computerId, input.computerId));
  }

  if (input.provider !== undefined) {
    conditions.push(eq(aiUsageRequests.provider, input.provider));
  }

  if (input.status !== undefined) {
    conditions.push(eq(aiUsageRequests.status, input.status));
  }

  if (input.model !== undefined) {
    conditions.push(eq(aiUsageRequests.model, input.model));
  }

  if (input.before !== undefined) {
    conditions.push(lt(aiUsageRequests.startedAt, input.before));
  }

  if (input.from !== undefined) {
    conditions.push(gte(aiUsageRequests.startedAt, input.from));
  }

  if (input.to !== undefined) {
    conditions.push(lte(aiUsageRequests.startedAt, input.to));
  }

  return conditions.length === 0 ? undefined : and(...conditions);
};
