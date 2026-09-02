import { hashToken } from "../auth/tokens.js";
import type { CloudServerConfig } from "../config.js";
import type { CloudStore, MachineIdentityRecord } from "../db/types.js";
import { unauthorized } from "../shared/errors.js";

export const authenticateMachineBearer = async (
  store: CloudStore,
  config: CloudServerConfig,
  authorization: string | undefined,
): Promise<MachineIdentityRecord> => {
  const token = readBearerToken(authorization);

  if (token === undefined) {
    throw unauthorized("Machine token required");
  }

  return authenticateMachineToken(store, config, token);
};

export const authenticateMachineToken = async (
  store: CloudStore,
  config: CloudServerConfig,
  token: string | undefined,
): Promise<MachineIdentityRecord> => {
  const normalized = token?.trim();

  if (normalized === undefined || normalized.length === 0) {
    throw unauthorized("Machine token required");
  }

  const identity = await store.getMachineIdentityByTokenHash(hashToken(normalized, config.sessionSecret));

  if (identity === null || identity.revokedAt !== null) {
    throw unauthorized("Invalid machine token");
  }

  return identity;
};

export const readBearerToken = (authorization: string | undefined): string | undefined => {
  if (authorization === undefined) {
    return undefined;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);

  if (scheme?.toLowerCase() !== "bearer" || token === undefined || token.trim().length === 0) {
    return undefined;
  }

  return token.trim();
};
