import { randomUUID } from "node:crypto";

import type {
  AiUsageBreakdownRow,
  AiUsageBucket,
  AiUsageBucketGranularity,
  AiUsageGroupBy,
  AiUsagePayloadRecord,
  AiUsageRequestRecord,
  AiUsageStatus,
  AiUsageSummary,
  AgentSessionHarness,
  AgentSessionThreadRecord,
  AgentSessionVersionRecord,
  CloudStore,
  ComputerAccessSessionRecord,
  ComputerKind,
  ComputerRecord,
  ComputerStatus,
  MachineIdentityRecord,
  ReleaseManifestRecord,
  ReleaseTarget,
  SessionRecord,
  UserRecord,
} from "../src/db/types.js";
import {
  bucketAiUsageRows,
  groupAiUsageRows,
  summarizeAiUsageRows,
} from "../src/db/ai-usage-aggregations.js";

export class InMemoryCloudStore implements CloudStore {
  readonly users = new Map<string, UserRecord>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly computers = new Map<string, ComputerRecord>();
  readonly machineIdentities = new Map<string, MachineIdentityRecord>();
  readonly computerAccessSessions = new Map<string, ComputerAccessSessionRecord>();
  readonly releaseManifests = new Map<string, ReleaseManifestRecord>();
  readonly aiUsageRequests = new Map<string, AiUsageRequestRecord>();
  readonly aiUsagePayloads = new Map<string, AiUsagePayloadRecord>();
  readonly agentSessionThreads = new Map<string, AgentSessionThreadRecord>();
  readonly agentSessionVersions = new Map<string, AgentSessionVersionRecord>();

  async createUser(input: {
    readonly email: string;
    readonly username: string;
    readonly passwordHash: string;
  }): Promise<UserRecord> {
    const now = new Date();
    const user = {
      id: randomUUID(),
      email: input.email,
      username: input.username,
      passwordHash: input.passwordHash,
      allowPiModels: false,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    return user;
  }

  async listUsers(): Promise<UserRecord[]> {
    return Array.from(this.users.values()).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    return Array.from(this.users.values()).find((user) => user.email === email) ?? null;
  }

  async getUserByUsername(username: string): Promise<UserRecord | null> {
    return Array.from(this.users.values()).find((user) => user.username === username) ?? null;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async updateUserPassword(input: {
    readonly userId: string;
    readonly passwordHash: string;
  }): Promise<UserRecord | null> {
    const user = this.users.get(input.userId);

    if (user === undefined) {
      return null;
    }

    const updated = { ...user, passwordHash: input.passwordHash, updatedAt: new Date() };
    this.users.set(input.userId, updated);
    return updated;
  }

  async updateUserModelAccess(input: {
    readonly userId: string;
    readonly allowPiModels: boolean;
  }): Promise<UserRecord | null> {
    const user = this.users.get(input.userId);

    if (user === undefined) {
      return null;
    }

    const updated = { ...user, allowPiModels: input.allowPiModels, updatedAt: new Date() };
    this.users.set(input.userId, updated);
    return updated;
  }

  async deleteUserById(userId: string): Promise<boolean> {
    if (!this.users.has(userId)) {
      return false;
    }

    this.users.delete(userId);
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        this.sessions.delete(session.id);
      }
    }
    for (const computer of this.computers.values()) {
      if (computer.ownerUserId === userId) {
        this.computers.delete(computer.id);
        for (const identity of this.machineIdentities.values()) {
          if (identity.computerId === computer.id) {
            this.machineIdentities.delete(identity.id);
          }
        }
        for (const accessSession of this.computerAccessSessions.values()) {
          if (accessSession.computerId === computer.id) {
            this.computerAccessSessions.delete(accessSession.id);
          }
        }
        this.deleteAgentSessionsForComputer(computer.id);
      }
    }
    return true;
  }

  async createSession(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<SessionRecord> {
    const now = new Date();
    const session = {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return Array.from(this.sessions.values()).find((session) => session.tokenHash === tokenHash) ?? null;
  }

  async revokeSession(sessionId: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (session === undefined) {
      return;
    }

    this.sessions.set(sessionId, { ...session, revokedAt, updatedAt: revokedAt });
  }

  async listSessionsForUser(userId: string): Promise<SessionRecord[]> {
    return Array.from(this.sessions.values())
      .filter((session) => session.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async revokeAllSessionsForUser(userId: string, revokedAt: Date): Promise<number> {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.revokedAt === null) {
        this.sessions.set(session.id, { ...session, revokedAt, updatedAt: revokedAt });
        count += 1;
      }
    }
    return count;
  }

  async listComputersForUser(userId: string): Promise<ComputerRecord[]> {
    return Array.from(this.computers.values()).filter((computer) => computer.ownerUserId === userId);
  }

  async listComputers(): Promise<ComputerRecord[]> {
    return Array.from(this.computers.values()).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async createComputer(input: {
    readonly ownerUserId: string;
    readonly name: string;
    readonly kind: ComputerKind;
    readonly status: ComputerStatus;
    readonly providerMetadata: unknown;
    readonly capabilities: unknown;
    readonly machineHealth?: unknown;
  }): Promise<ComputerRecord> {
    const now = new Date();
    const computer = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      name: input.name,
      kind: input.kind,
      status: input.status,
      providerMetadata: input.providerMetadata,
      capabilities: input.capabilities,
      machineHealth: input.machineHealth ?? {},
      machineServerVersion: null,
      lastHeartbeatAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.computers.set(computer.id, computer);
    return computer;
  }

  async getComputerForUser(input: {
    readonly userId: string;
    readonly computerId: string;
  }): Promise<ComputerRecord | null> {
    const computer = this.computers.get(input.computerId);
    return computer?.ownerUserId === input.userId ? computer : null;
  }

  async updateComputerForUser(input: {
    readonly userId: string;
    readonly computerId: string;
    readonly name?: string;
    readonly status?: ComputerStatus;
    readonly providerMetadata?: unknown;
    readonly capabilities?: unknown;
    readonly machineHealth?: unknown;
    readonly machineServerVersion?: string | null;
    readonly lastHeartbeatAt?: Date | null;
  }): Promise<ComputerRecord | null> {
    const computer = await this.getComputerForUser(input);

    if (computer === null) {
      return null;
    }

    const updated = {
      ...computer,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.providerMetadata !== undefined ? { providerMetadata: input.providerMetadata } : {}),
      ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
      ...(input.machineHealth !== undefined ? { machineHealth: input.machineHealth } : {}),
      ...(input.machineServerVersion !== undefined ? { machineServerVersion: input.machineServerVersion } : {}),
      ...(input.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: input.lastHeartbeatAt } : {}),
      updatedAt: new Date(),
    };
    this.computers.set(updated.id, updated);
    return updated;
  }

  async getComputerById(computerId: string): Promise<ComputerRecord | null> {
    return this.computers.get(computerId) ?? null;
  }

  async updateComputerById(input: {
    readonly computerId: string;
    readonly status?: ComputerStatus;
    readonly providerMetadata?: unknown;
    readonly capabilities?: unknown;
    readonly machineHealth?: unknown;
    readonly machineServerVersion?: string | null;
    readonly lastHeartbeatAt?: Date | null;
  }): Promise<ComputerRecord | null> {
    const computer = this.computers.get(input.computerId);

    if (computer === undefined) {
      return null;
    }

    const updated = {
      ...computer,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.providerMetadata !== undefined ? { providerMetadata: input.providerMetadata } : {}),
      ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
      ...(input.machineHealth !== undefined ? { machineHealth: input.machineHealth } : {}),
      ...(input.machineServerVersion !== undefined ? { machineServerVersion: input.machineServerVersion } : {}),
      ...(input.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: input.lastHeartbeatAt } : {}),
      updatedAt: new Date(),
    };
    this.computers.set(updated.id, updated);
    return updated;
  }

  async deleteComputerForUser(input: {
    readonly userId: string;
    readonly computerId: string;
  }): Promise<boolean> {
    const computer = await this.getComputerForUser(input);

    if (computer === null) {
      return false;
    }

    this.computers.delete(input.computerId);
    this.deleteAgentSessionsForComputer(input.computerId);
    return true;
  }

  async deleteComputerById(computerId: string): Promise<boolean> {
    const deleted = this.computers.delete(computerId);
    if (deleted) {
      this.deleteAgentSessionsForComputer(computerId);
    }
    return deleted;
  }

  async renameComputerById(input: {
    readonly computerId: string;
    readonly name: string;
  }): Promise<ComputerRecord | null> {
    const computer = this.computers.get(input.computerId);

    if (computer === undefined) {
      return null;
    }

    const updated = { ...computer, name: input.name, updatedAt: new Date() };
    this.computers.set(input.computerId, updated);
    return updated;
  }

  async createMachineIdentity(input: {
    readonly computerId: string;
    readonly bootstrapTokenHash: string;
  }): Promise<MachineIdentityRecord> {
    const identity = {
      id: randomUUID(),
      computerId: input.computerId,
      bootstrapTokenHash: input.bootstrapTokenHash,
      tokenHash: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.machineIdentities.set(identity.id, identity);
    return identity;
  }

  async getMachineIdentityByBootstrapTokenHash(bootstrapTokenHash: string): Promise<MachineIdentityRecord | null> {
    return Array.from(this.machineIdentities.values())
      .find((identity) => identity.bootstrapTokenHash === bootstrapTokenHash) ?? null;
  }

  async getMachineIdentityByTokenHash(tokenHash: string): Promise<MachineIdentityRecord | null> {
    return Array.from(this.machineIdentities.values())
      .find((identity) => identity.tokenHash === tokenHash) ?? null;
  }

  async activateMachineIdentity(input: {
    readonly identityId: string;
    readonly tokenHash: string;
    readonly activatedAt: Date;
  }): Promise<MachineIdentityRecord | null> {
    const identity = this.machineIdentities.get(input.identityId);

    if (identity === undefined) {
      return null;
    }

    const updated = {
      ...identity,
      bootstrapTokenHash: null,
      tokenHash: input.tokenHash,
      lastUsedAt: input.activatedAt,
    };
    this.machineIdentities.set(input.identityId, updated);
    return updated;
  }

  async touchMachineIdentity(input: {
    readonly identityId: string;
    readonly lastUsedAt: Date;
  }): Promise<void> {
    const identity = this.machineIdentities.get(input.identityId);

    if (identity !== undefined) {
      this.machineIdentities.set(input.identityId, { ...identity, lastUsedAt: input.lastUsedAt });
    }
  }

  async listMachineIdentitiesForComputer(computerId: string): Promise<MachineIdentityRecord[]> {
    return Array.from(this.machineIdentities.values())
      .filter((identity) => identity.computerId === computerId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async revokeMachineIdentity(input: {
    readonly identityId: string;
    readonly revokedAt: Date;
  }): Promise<MachineIdentityRecord | null> {
    const identity = this.machineIdentities.get(input.identityId);

    if (identity === undefined) {
      return null;
    }

    const updated = { ...identity, revokedAt: input.revokedAt };
    this.machineIdentities.set(input.identityId, updated);
    return updated;
  }

  async createComputerAccessSession(input: {
    readonly userId: string;
    readonly computerId: string;
    readonly tokenHash: string;
    readonly scopes: unknown;
    readonly expiresAt: Date;
  }): Promise<ComputerAccessSessionRecord> {
    const accessSession = {
      id: randomUUID(),
      userId: input.userId,
      computerId: input.computerId,
      tokenHash: input.tokenHash,
      scopes: input.scopes,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.computerAccessSessions.set(accessSession.id, accessSession);
    return accessSession;
  }

  async getComputerAccessSessionByTokenHash(tokenHash: string): Promise<ComputerAccessSessionRecord | null> {
    return Array.from(this.computerAccessSessions.values())
      .find((accessSession) => accessSession.tokenHash === tokenHash) ?? null;
  }

  async listAccessSessionsForComputer(input: {
    readonly computerId: string;
    readonly limit?: number;
  }): Promise<ComputerAccessSessionRecord[]> {
    const sorted = Array.from(this.computerAccessSessions.values())
      .filter((accessSession) => accessSession.computerId === input.computerId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    return input.limit !== undefined ? sorted.slice(0, input.limit) : sorted;
  }

  async getReleaseManifest(input: {
    readonly target: ReleaseTarget;
    readonly channel: string;
    readonly platform: string;
  }): Promise<ReleaseManifestRecord | null> {
    return this.releaseManifests.get(releaseKey(input)) ?? null;
  }

  async listReleaseManifests(): Promise<ReleaseManifestRecord[]> {
    return Array.from(this.releaseManifests.values())
      .sort((left, right) => right.releasedAt.getTime() - left.releasedAt.getTime());
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
    const key = releaseKey(input);
    const existing = this.releaseManifests.get(key);
    const now = new Date();
    const manifest = {
      id: existing?.id ?? randomUUID(),
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
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.releaseManifests.set(key, manifest);
    return manifest;
  }

  async deleteReleaseManifest(id: string): Promise<boolean> {
    for (const [key, manifest] of this.releaseManifests.entries()) {
      if (manifest.id === id) {
        this.releaseManifests.delete(key);
        return true;
      }
    }
    return false;
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
    const usage = {
      id: randomUUID(),
      userId: input.userId,
      computerId: input.computerId,
      machineIdentityId: input.machineIdentityId,
      provider: input.provider,
      model: input.model ?? null,
      method: input.method,
      upstreamPath: input.upstreamPath,
      status: input.status,
      httpStatus: input.httpStatus ?? null,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      startedAt: input.startedAt ?? new Date(),
      completedAt: null,
      durationMs: null,
      errorMessage: null,
      metadata: input.metadata ?? {},
    };
    this.aiUsageRequests.set(usage.id, usage);
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
    const usage = this.aiUsageRequests.get(input.id);

    if (usage === undefined) {
      return null;
    }

    const updated = {
      ...usage,
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
    };
    this.aiUsageRequests.set(input.id, updated);
    return updated;
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
    const payload = {
      id: randomUUID(),
      usageRequestId: input.usageRequestId,
      requestHeaders: input.requestHeaders,
      requestBody: input.requestBody,
      requestBodyTruncated: input.requestBodyTruncated,
      responseHeaders: input.responseHeaders,
      responseBody: input.responseBody,
      responseBodyTruncated: input.responseBodyTruncated,
      createdAt: new Date(),
    };
    this.aiUsagePayloads.set(payload.id, payload);
    return payload;
  }

  async getAiUsageRequestById(id: string): Promise<AiUsageRequestRecord | null> {
    return this.aiUsageRequests.get(id) ?? null;
  }

  async getAiUsagePayloadByRequestId(usageRequestId: string): Promise<AiUsagePayloadRecord | null> {
    return Array.from(this.aiUsagePayloads.values())
      .find((payload) => payload.usageRequestId === usageRequestId) ?? null;
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
    const rows = this.filterAiUsageRows(input)
      .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
    return input.limit !== undefined ? rows.slice(0, input.limit) : rows;
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
    return summarizeAiUsageRows(this.filterAiUsageRows(input));
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
    return bucketAiUsageRows(this.filterAiUsageRows(input), input.bucket);
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
    return groupAiUsageRows(this.filterAiUsageRows(input), input.groupBy, input.limit);
  }

  async getAgentSessionVersionByContent(input: {
    readonly computerId: string;
    readonly harness: AgentSessionHarness;
    readonly nativeThreadId: string;
    readonly sha256: string;
  }): Promise<AgentSessionVersionRecord | null> {
    return Array.from(this.agentSessionVersions.values()).find((version) =>
      version.computerId === input.computerId &&
      version.harness === input.harness &&
      version.nativeThreadId === input.nativeThreadId &&
      version.sha256 === input.sha256
    ) ?? null;
  }

  async upsertAgentSessionUpload(input: {
    readonly userId: string;
    readonly computerId: string;
    readonly machineIdentityId: string;
    readonly harness: AgentSessionHarness;
    readonly nativeThreadId: string;
    readonly threadId: string;
    readonly sha256: string;
    readonly objectBucket: string;
    readonly objectKey: string;
    readonly sizeBytes: number;
    readonly sourceMtime: Date;
    readonly sourcePath?: string | null;
    readonly relativePath: string;
    readonly sourceCreatedAt?: Date | null;
    readonly sourceUpdatedAt?: Date | null;
    readonly metadata?: unknown;
  }): Promise<{
    readonly thread: AgentSessionThreadRecord;
    readonly version: AgentSessionVersionRecord;
    readonly created: boolean;
  }> {
    const now = new Date();
    const threadKey = agentSessionThreadKey(input);
    const existingThread = Array.from(this.agentSessionThreads.values())
      .find((thread) => agentSessionThreadKey(thread) === threadKey);
    const sourcePath = input.sourcePath ?? null;
    const sourceCreatedAt = input.sourceCreatedAt ?? null;
    const sourceUpdatedAt = input.sourceUpdatedAt ?? input.sourceMtime;
    const metadata = input.metadata ?? {};
    let thread: AgentSessionThreadRecord = {
      id: existingThread?.id ?? randomUUID(),
      userId: input.userId,
      computerId: input.computerId,
      machineIdentityId: input.machineIdentityId,
      harness: input.harness,
      nativeThreadId: input.nativeThreadId,
      threadId: input.threadId,
      sourcePath,
      relativePath: input.relativePath,
      latestVersionId: existingThread?.latestVersionId ?? null,
      latestSha256: existingThread?.latestSha256 ?? null,
      latestObjectKey: existingThread?.latestObjectKey ?? null,
      latestSizeBytes: existingThread?.latestSizeBytes ?? null,
      latestMtime: existingThread?.latestMtime ?? null,
      sourceCreatedAt,
      sourceUpdatedAt,
      firstSyncedAt: existingThread?.firstSyncedAt ?? now,
      lastSyncedAt: now,
      metadata,
      createdAt: existingThread?.createdAt ?? now,
      updatedAt: now,
    };

    this.agentSessionThreads.set(thread.id, thread);

    const existingVersion = await this.getAgentSessionVersionByContent({
      computerId: input.computerId,
      harness: input.harness,
      nativeThreadId: input.nativeThreadId,
      sha256: input.sha256,
    });
    const created = existingVersion === null;
    const version: AgentSessionVersionRecord = existingVersion ?? {
      id: randomUUID(),
      agentSessionThreadId: thread.id,
      userId: input.userId,
      computerId: input.computerId,
      machineIdentityId: input.machineIdentityId,
      harness: input.harness,
      nativeThreadId: input.nativeThreadId,
      threadId: input.threadId,
      sha256: input.sha256,
      objectBucket: input.objectBucket,
      objectKey: input.objectKey,
      sizeBytes: input.sizeBytes,
      sourceMtime: input.sourceMtime,
      sourcePath,
      relativePath: input.relativePath,
      sourceCreatedAt,
      sourceUpdatedAt,
      metadata,
      uploadedAt: now,
      createdAt: now,
    };

    if (created) {
      this.agentSessionVersions.set(version.id, version);
    }

    if (thread.latestMtime === null || input.sourceMtime.getTime() >= thread.latestMtime.getTime()) {
      thread = {
        ...thread,
        latestVersionId: version.id,
        latestSha256: version.sha256,
        latestObjectKey: version.objectKey,
        latestSizeBytes: version.sizeBytes,
        latestMtime: version.sourceMtime,
        updatedAt: now,
      };
      this.agentSessionThreads.set(thread.id, thread);
    }

    return { thread, version, created };
  }

  async listAgentSessionThreads(input: {
    readonly userId?: string;
    readonly computerId?: string;
    readonly harness?: AgentSessionHarness;
    readonly limit?: number;
  } = {}): Promise<AgentSessionThreadRecord[]> {
    const rows = Array.from(this.agentSessionThreads.values())
      .filter((thread) => input.userId === undefined || thread.userId === input.userId)
      .filter((thread) => input.computerId === undefined || thread.computerId === input.computerId)
      .filter((thread) => input.harness === undefined || thread.harness === input.harness)
      .sort((left, right) => right.lastSyncedAt.getTime() - left.lastSyncedAt.getTime());
    return input.limit !== undefined ? rows.slice(0, input.limit) : rows;
  }

  async getAgentSessionThreadById(id: string): Promise<AgentSessionThreadRecord | null> {
    return this.agentSessionThreads.get(id) ?? null;
  }

  async listAgentSessionVersions(agentSessionThreadId: string): Promise<AgentSessionVersionRecord[]> {
    return Array.from(this.agentSessionVersions.values())
      .filter((version) => version.agentSessionThreadId === agentSessionThreadId)
      .sort((left, right) => right.uploadedAt.getTime() - left.uploadedAt.getTime());
  }

  private filterAiUsageRows(input: {
    readonly userId?: string;
    readonly computerId?: string;
    readonly provider?: string;
    readonly status?: AiUsageStatus;
    readonly model?: string;
    readonly from?: Date;
    readonly to?: Date;
    readonly before?: Date;
  }): AiUsageRequestRecord[] {
    return Array.from(this.aiUsageRequests.values())
      .filter((usage) => input.userId === undefined || usage.userId === input.userId)
      .filter((usage) => input.computerId === undefined || usage.computerId === input.computerId)
      .filter((usage) => input.provider === undefined || usage.provider === input.provider)
      .filter((usage) => input.status === undefined || usage.status === input.status)
      .filter((usage) => input.model === undefined || usage.model === input.model)
      .filter((usage) => input.before === undefined || usage.startedAt.getTime() < input.before.getTime())
      .filter((usage) => input.from === undefined || usage.startedAt.getTime() >= input.from.getTime())
      .filter((usage) => input.to === undefined || usage.startedAt.getTime() <= input.to.getTime());
  }

  private deleteAgentSessionsForComputer(computerId: string): void {
    for (const thread of this.agentSessionThreads.values()) {
      if (thread.computerId === computerId) {
        this.agentSessionThreads.delete(thread.id);
      }
    }

    for (const version of this.agentSessionVersions.values()) {
      if (version.computerId === computerId) {
        this.agentSessionVersions.delete(version.id);
      }
    }
  }
}

const releaseKey = (input: {
  readonly target: ReleaseTarget;
  readonly channel: string;
  readonly platform: string;
}): string => `${input.target}:${input.channel}:${input.platform}`;

const agentSessionThreadKey = (input: {
  readonly computerId: string;
  readonly harness: string;
  readonly nativeThreadId: string;
}): string => `${input.computerId}:${input.harness}:${input.nativeThreadId}`;
