import { randomUUID } from "node:crypto";

import type {
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

export class InMemoryCloudStore implements CloudStore {
  readonly users = new Map<string, UserRecord>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly computers = new Map<string, ComputerRecord>();
  readonly machineIdentities = new Map<string, MachineIdentityRecord>();
  readonly computerAccessSessions = new Map<string, ComputerAccessSessionRecord>();
  readonly releaseManifests = new Map<string, ReleaseManifestRecord>();

  async createUser(input: { readonly email: string; readonly passwordHash: string }): Promise<UserRecord> {
    const now = new Date();
    const user = {
      id: randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
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

  async getUserById(userId: string): Promise<UserRecord | null> {
    return this.users.get(userId) ?? null;
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
    return true;
  }

  async deleteComputerById(computerId: string): Promise<boolean> {
    return this.computers.delete(computerId);
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

  async createComputerAccessSession(input: {
    readonly userId: string;
    readonly computerId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<ComputerAccessSessionRecord> {
    const accessSession = {
      id: randomUUID(),
      userId: input.userId,
      computerId: input.computerId,
      tokenHash: input.tokenHash,
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
}

const releaseKey = (input: {
  readonly target: ReleaseTarget;
  readonly channel: string;
  readonly platform: string;
}): string => `${input.target}:${input.channel}:${input.platform}`;
