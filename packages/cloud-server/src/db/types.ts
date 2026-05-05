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

export interface CloudStore {
  createUser(input: {
    readonly email: string;
    readonly passwordHash: string;
  }): Promise<UserRecord>;
  listUsers(): Promise<UserRecord[]>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserById(userId: string): Promise<UserRecord | null>;

  createSession(input: {
    readonly userId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<SessionRecord>;
  getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  revokeSession(sessionId: string, revokedAt: Date): Promise<void>;

  listComputersForUser(userId: string): Promise<ComputerRecord[]>;
  listComputers(): Promise<ComputerRecord[]>;
  createComputer(input: {
    readonly ownerUserId: string;
    readonly name: string;
    readonly kind: ComputerKind;
    readonly status: ComputerStatus;
    readonly providerMetadata: unknown;
    readonly capabilities: unknown;
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
    readonly machineServerVersion?: string | null;
    readonly lastHeartbeatAt?: Date | null;
  }): Promise<ComputerRecord | null>;
  getComputerById(computerId: string): Promise<ComputerRecord | null>;
  updateComputerById(input: {
    readonly computerId: string;
    readonly status?: ComputerStatus;
    readonly providerMetadata?: unknown;
    readonly capabilities?: unknown;
    readonly machineServerVersion?: string | null;
    readonly lastHeartbeatAt?: Date | null;
  }): Promise<ComputerRecord | null>;
  deleteComputerForUser(input: {
    readonly userId: string;
    readonly computerId: string;
  }): Promise<boolean>;
  deleteComputerById(computerId: string): Promise<boolean>;

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

  createComputerAccessSession(input: {
    readonly userId: string;
    readonly computerId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<ComputerAccessSessionRecord>;
  getComputerAccessSessionByTokenHash(tokenHash: string): Promise<ComputerAccessSessionRecord | null>;

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
}
