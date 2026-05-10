import type { SessionRecord, UserRecord } from "../db/types.js";

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly username: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AppVariables {
  readonly currentUser: AuthenticatedUser;
  readonly currentSession: SessionRecord;
}

export const toAuthenticatedUser = (user: UserRecord): AuthenticatedUser => ({
  id: user.id,
  email: user.email,
  username: user.username,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});
