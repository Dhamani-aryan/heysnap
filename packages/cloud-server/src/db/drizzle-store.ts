import { and, desc, eq, isNull } from "drizzle-orm";

import type { DbClient } from "./client.js";
import {
  computerAccessSessions,
  computers,
  machineIdentities,
  releaseManifests,
  sessions,
  users,
} from "./schema/index.js";
import type {
  CloudStore,
  ComputerAccessSessionRecord,
  ComputerRecord,
  MachineIdentityRecord,
  ReleaseManifestRecord,
  ReleaseTarget,
  SessionRecord,
  UserRecord,
} from "./types.js";

export class DrizzleCloudStore implements CloudStore {
  constructor(private readonly db: DbClient) {}

  async createUser(input: { readonly email: string; readonly passwordHash: string }): Promise<UserRecord> {
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
  }): Promise<ComputerRecord> {
    const [computer] = await this.db.insert(computers).values(input).returning();
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
}
