import type { AuthenticatedUser } from "./context.js";
import type { ComputerAccessSessionRecord, ComputerRecord } from "../db/types.js";

export const serializeUser = (user: AuthenticatedUser) => ({
  id: user.id,
  email: user.email,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});

export const serializeComputer = (computer: ComputerRecord) => ({
  id: computer.id,
  ownerUserId: computer.ownerUserId,
  name: computer.name,
  kind: computer.kind,
  status: computer.status,
  providerMetadata: computer.providerMetadata,
  capabilities: computer.capabilities,
  machineServerVersion: computer.machineServerVersion,
  lastHeartbeatAt: computer.lastHeartbeatAt?.toISOString() ?? null,
  createdAt: computer.createdAt.toISOString(),
  updatedAt: computer.updatedAt.toISOString(),
});

export const serializeComputerAccessSession = (
  accessSession: ComputerAccessSessionRecord,
  token: string,
) => ({
  id: accessSession.id,
  computerId: accessSession.computerId,
  token,
  expiresAt: accessSession.expiresAt.toISOString(),
});
