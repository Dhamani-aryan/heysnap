import type { CloudServerConfig } from "../config.js";
import type { CloudStore, SessionRecord, UserRecord } from "../db/types.js";
import { conflict, notFound, unauthorized } from "../shared/errors.js";
import { normalizeEmail, requirePassword } from "../shared/validation.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { createOpaqueToken, hashToken } from "./tokens.js";

export interface AuthSessionResult {
  readonly user: UserRecord;
  readonly session: SessionRecord;
  readonly token: string;
}

export class AuthService {
  constructor(
    private readonly store: CloudStore,
    private readonly config: CloudServerConfig,
  ) {}

  async createUser(input: { readonly email: string; readonly password: string }): Promise<UserRecord> {
    const email = normalizeEmail(input.email);
    requirePassword(input.password);

    if (await this.store.getUserByEmail(email)) {
      throw conflict("EMAIL_ALREADY_REGISTERED", "Email is already registered");
    }

    const user = await this.store.createUser({
      email,
      passwordHash: await hashPassword(input.password),
    });

    return user;
  }

  async setPassword(input: { readonly userId: string; readonly password: string }): Promise<UserRecord> {
    requirePassword(input.password);

    const user = await this.store.updateUserPassword({
      userId: input.userId,
      passwordHash: await hashPassword(input.password),
    });

    if (user === null) {
      throw notFound("USER_NOT_FOUND", "User not found");
    }

    return user;
  }

  async login(input: { readonly email: string; readonly password: string }): Promise<AuthSessionResult> {
    const email = normalizeEmail(input.email);
    const user = await this.store.getUserByEmail(email);

    if (user === null || !(await verifyPassword(input.password, user.passwordHash))) {
      throw unauthorized("Invalid email or password");
    }

    return this.createSessionForUser(user);
  }

  async authenticateToken(token: string): Promise<{ readonly user: UserRecord; readonly session: SessionRecord } | null> {
    const tokenHash = hashToken(token, this.config.sessionSecret);
    const session = await this.store.getSessionByTokenHash(tokenHash);

    if (session === null || session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    const user = await this.store.getUserById(session.userId);

    if (user === null) {
      return null;
    }

    return { user, session };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.store.revokeSession(sessionId, new Date());
  }

  private async createSessionForUser(user: UserRecord): Promise<AuthSessionResult> {
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlSeconds * 1000);
    const session = await this.store.createSession({
      userId: user.id,
      tokenHash: hashToken(token, this.config.sessionSecret),
      expiresAt,
    });

    return { user, session, token };
  }
}
