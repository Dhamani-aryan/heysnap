import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const computerKindEnum = pgEnum("computer_kind", ["cloud", "local"]);
export const computerStatusEnum = pgEnum("computer_status", [
  "creating",
  "starting",
  "online",
  "idle",
  "sleeping",
  "offline",
  "failed",
  "deleted",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  emailUnique: uniqueIndex("users_email_unique").on(table.email),
}));

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tokenHashUnique: uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
}));

export const computers = pgTable("computers", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: computerKindEnum("kind").notNull(),
  status: computerStatusEnum("status").notNull(),
  providerMetadata: jsonb("provider_metadata").notNull().default({}),
  capabilities: jsonb("capabilities").notNull().default([]),
  machineServerVersion: text("machine_server_version"),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const machineIdentities = pgTable("machine_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  computerId: uuid("computer_id").notNull().references(() => computers.id, { onDelete: "cascade" }),
  bootstrapTokenHash: text("bootstrap_token_hash"),
  tokenHash: text("token_hash"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  bootstrapTokenHashUnique: uniqueIndex("machine_identities_bootstrap_token_hash_unique").on(table.bootstrapTokenHash),
  tokenHashUnique: uniqueIndex("machine_identities_token_hash_unique").on(table.tokenHash),
}));

export const computerAccessSessions = pgTable("computer_access_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  computerId: uuid("computer_id").notNull().references(() => computers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tokenHashUnique: uniqueIndex("computer_access_sessions_token_hash_unique").on(table.tokenHash),
}));

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type ComputerRow = typeof computers.$inferSelect;
export type MachineIdentityRow = typeof machineIdentities.$inferSelect;
export type ComputerAccessSessionRow = typeof computerAccessSessions.$inferSelect;
