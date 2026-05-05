import type { CloudServerConfig } from "../config.js";
import type { CloudStore, ComputerAccessSessionRecord } from "../db/types.js";
import { createOpaqueToken, hashToken } from "../auth/tokens.js";

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
  }): Promise<GatewayAccessSessionResult> {
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.computerAccessSessionTtlSeconds * 1000);
    const accessSession = await this.store.createComputerAccessSession({
      userId: input.userId,
      computerId: input.computerId,
      tokenHash: hashToken(token, this.config.sessionSecret),
      expiresAt,
    });

    return { accessSession, token };
  }

  async authenticateAccessToken(input: {
    readonly token: string;
    readonly computerId: string;
  }): Promise<ComputerAccessSessionRecord | null> {
    const accessSession = await this.store.getComputerAccessSessionByTokenHash(
      hashToken(input.token, this.config.sessionSecret),
    );

    if (
      accessSession === null ||
      accessSession.revokedAt !== null ||
      accessSession.computerId !== input.computerId ||
      accessSession.expiresAt.getTime() <= Date.now()
    ) {
      return null;
    }

    return accessSession;
  }
}
