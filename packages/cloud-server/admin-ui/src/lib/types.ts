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

export type ReleaseTarget = "desktop" | "machine-server";

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
