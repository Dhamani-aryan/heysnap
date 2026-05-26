import type { CloudServerConfig } from "../config.js";
import type { CloudStore, ComputerAccessSessionRecord } from "../db/types.js";
import { createOpaqueToken, hashToken } from "../auth/tokens.js";

export type GatewayAccessScope =
  | "*"
  | "filesystem:ws"
  | "filesystem:download"
  | "filesystem:upload"
  | "browser-control:ws"
  | "preview:http"
  | "preview:ws"
  | "agent:http"
  | "capabilities:http"
  | "feedback:http";

export const DEFAULT_GATEWAY_ACCESS_SCOPES: readonly GatewayAccessScope[] = [
  "filesystem:ws",
  "filesystem:download",
  "filesystem:upload",
  "browser-control:ws",
  "preview:http",
  "preview:ws",
  "agent:http",
  "capabilities:http",
  "feedback:http",
];

export interface GatewayAccessSessionResult {
  readonly accessSession: ComputerAccessSessionRecord;
  readonly token: string;
}

export class GatewayAccessService {
  constructor(
    private readonly store: CloudStore,
    private readonly config: CloudServerConfig,
  ) {}

  async createAccessSession(input: {
    readonly userId: string;
    readonly computerId: string;
    readonly scopes?: readonly GatewayAccessScope[];
  }): Promise<GatewayAccessSessionResult> {
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.computerAccessSessionTtlSeconds * 1000);
    const accessSession = await this.store.createComputerAccessSession({
      userId: input.userId,
      computerId: input.computerId,
      tokenHash: hashToken(token, this.config.sessionSecret),
      scopes: [...(input.scopes ?? DEFAULT_GATEWAY_ACCESS_SCOPES)],
      expiresAt,
    });

    return { accessSession, token };
  }

  async authenticateAccessToken(input: {
    readonly token: string;
    readonly computerId: string;
    readonly requiredScope?: GatewayAccessScope;
  }): Promise<ComputerAccessSessionRecord | null> {
    const accessSession = await this.store.getComputerAccessSessionByTokenHash(
      hashToken(input.token, this.config.sessionSecret),
    );

    if (
      accessSession === null ||
      accessSession.revokedAt !== null ||
      accessSession.computerId !== input.computerId ||
      accessSession.expiresAt.getTime() <= Date.now() ||
      !hasAccessScope(accessSession, input.requiredScope)
    ) {
      return null;
    }

    return accessSession;
  }
}

export const hasAccessScope = (
  accessSession: ComputerAccessSessionRecord,
  requiredScope: GatewayAccessScope | undefined,
): boolean => {
  if (requiredScope === undefined) {
    return true;
  }

  const scopes = Array.isArray(accessSession.scopes)
    ? accessSession.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];

  return scopes.includes("*") || scopes.includes(requiredScope);
};
