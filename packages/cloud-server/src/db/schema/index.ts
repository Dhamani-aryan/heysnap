import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const computerKindEnum = pgEnum("computer_kind", ["cloud", "local"]);
export const releaseTargetEnum = pgEnum("release_target", ["machine-server"]);
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
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  allowPiModels: boolean("allow_pi_models").notNull().default(false),
  allowBrowserStream: boolean("allow_browser_stream").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  emailUnique: uniqueIndex("users_email_unique").on(table.email),
  usernameUnique: uniqueIndex("users_username_unique").on(table.username),
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
  machineHealth: jsonb("machine_health").notNull().default({}),
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
  scopes: jsonb("scopes").notNull().default(["*"]),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tokenHashUnique: uniqueIndex("computer_access_sessions_token_hash_unique").on(table.tokenHash),
}));

export const releaseManifests = pgTable("release_manifests", {
  id: uuid("id").primaryKey().defaultRandom(),
  target: releaseTargetEnum("target").notNull(),
  channel: text("channel").notNull(),
  platform: text("platform").notNull().default("default"),
  version: text("version").notNull(),
  downloadUrl: text("download_url"),
  signatureUrl: text("signature_url"),
  dockerImage: text("docker_image"),
  notes: text("notes"),
  metadata: jsonb("metadata").notNull().default({}),
  releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  targetChannelPlatformUnique: uniqueIndex("release_manifests_target_channel_platform_unique")
    .on(table.target, table.channel, table.platform),
}));

export const aiUsageRequests = pgTable("ai_usage_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  computerId: uuid("computer_id").notNull().references(() => computers.id, { onDelete: "cascade" }),
  machineIdentityId: uuid("machine_identity_id").notNull().references(() => machineIdentities.id, {
    onDelete: "cascade",
  }),
  provider: text("provider").notNull(),
  model: text("model"),
  method: text("method").notNull(),
  upstreamPath: text("upstream_path").notNull(),
  status: text("status").notNull(),
  httpStatus: integer("http_status"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  reasoningOutputTokens: integer("reasoning_output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").notNull().default({}),
}, (table) => ({
  userStartedAtIdx: index("ai_usage_requests_user_started_at_idx").on(table.userId, table.startedAt),
  computerStartedAtIdx: index("ai_usage_requests_computer_started_at_idx").on(table.computerId, table.startedAt),
}));

export const aiUsagePayloads = pgTable("ai_usage_payloads", {
  id: uuid("id").primaryKey().defaultRandom(),
  usageRequestId: uuid("usage_request_id").notNull().references(() => aiUsageRequests.id, { onDelete: "cascade" }),
  requestHeaders: jsonb("request_headers").notNull().default({}),
  requestBody: text("request_body"),
  requestBodyTruncated: boolean("request_body_truncated").notNull().default(false),
  responseHeaders: jsonb("response_headers").notNull().default({}),
  responseBody: text("response_body"),
  responseBodyTruncated: boolean("response_body_truncated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  usageRequestUnique: uniqueIndex("ai_usage_payloads_usage_request_id_unique").on(table.usageRequestId),
}));

export const agentSessionThreads = pgTable("agent_session_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  computerId: uuid("computer_id").notNull().references(() => computers.id, { onDelete: "cascade" }),
  machineIdentityId: uuid("machine_identity_id").notNull().references(() => machineIdentities.id, {
    onDelete: "cascade",
  }),
  harness: text("harness").notNull(),
  nativeThreadId: text("native_thread_id").notNull(),
  threadId: text("thread_id").notNull(),
  sourcePath: text("source_path"),
  relativePath: text("relative_path").notNull(),
  latestVersionId: uuid("latest_version_id"),
  latestSha256: text("latest_sha256"),
  latestObjectKey: text("latest_object_key"),
  latestSizeBytes: integer("latest_size_bytes"),
  latestMtime: timestamp("latest_mtime", { withTimezone: true }),
  sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  firstSyncedAt: timestamp("first_synced_at", { withTimezone: true }).notNull().defaultNow(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  computerHarnessNativeUnique: uniqueIndex("agent_session_threads_computer_harness_native_unique")
    .on(table.computerId, table.harness, table.nativeThreadId),
  userUpdatedAtIdx: index("agent_session_threads_user_updated_at_idx").on(table.userId, table.sourceUpdatedAt),
  computerUpdatedAtIdx: index("agent_session_threads_computer_updated_at_idx")
    .on(table.computerId, table.sourceUpdatedAt),
}));

export const agentSessionVersions = pgTable("agent_session_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentSessionThreadId: uuid("agent_session_thread_id").notNull().references(() => agentSessionThreads.id, {
    onDelete: "cascade",
  }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  computerId: uuid("computer_id").notNull().references(() => computers.id, { onDelete: "cascade" }),
  machineIdentityId: uuid("machine_identity_id").notNull().references(() => machineIdentities.id, {
    onDelete: "cascade",
  }),
  harness: text("harness").notNull(),
  nativeThreadId: text("native_thread_id").notNull(),
  threadId: text("thread_id").notNull(),
  sha256: text("sha256").notNull(),
  objectBucket: text("object_bucket").notNull(),
  objectKey: text("object_key").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sourceMtime: timestamp("source_mtime", { withTimezone: true }).notNull(),
  sourcePath: text("source_path"),
  relativePath: text("relative_path").notNull(),
  sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  computerHarnessNativeShaUnique: uniqueIndex("agent_session_versions_computer_harness_native_sha_unique")
    .on(table.computerId, table.harness, table.nativeThreadId, table.sha256),
  threadUploadedAtIdx: index("agent_session_versions_thread_uploaded_at_idx")
    .on(table.agentSessionThreadId, table.uploadedAt),
}));

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type ComputerRow = typeof computers.$inferSelect;
export type MachineIdentityRow = typeof machineIdentities.$inferSelect;
export type ComputerAccessSessionRow = typeof computerAccessSessions.$inferSelect;
export type ReleaseManifestRow = typeof releaseManifests.$inferSelect;
export type AiUsageRequestRow = typeof aiUsageRequests.$inferSelect;
export type AiUsagePayloadRow = typeof aiUsagePayloads.$inferSelect;
export type AgentSessionThreadRow = typeof agentSessionThreads.$inferSelect;
export type AgentSessionVersionRow = typeof agentSessionVersions.$inferSelect;
