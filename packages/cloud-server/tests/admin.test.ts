import { describe, expect, it } from "vitest";

import type { CloudServerConfig } from "../src/config.js";
import { createApp } from "../src/server.js";
import type { ComputerProvisioner } from "../src/provisioning/types.js";
import type { ComputerRecord } from "../src/db/types.js";
import { InMemoryCloudStore } from "./in-memory-store.js";

const config: CloudServerConfig = {
  port: 4100,
  databaseUrl: "postgres://test",
  sessionSecret: "test-session-secret",
  sessionTtlSeconds: 60 * 60,
  computerAccessSessionTtlSeconds: 60,
  cloudServerPublicUrl: "https://cloud.example.com",
  awsRegion: "ap-south-1",
  awsEc2InstanceType: "t3.large",
  awsEc2RootVolumeGb: 80,
  awsMachineInstanceProfileName: "ank1015-machine-profile",
  awsMachineAmiSsmParameter: "/ank1015/machine-images/test/ami-id",
  machineServerChannel: "stable",
  allowedOrigins: ["https://app.example.com"],
  adminToken: "test-admin-token",
};

describe("admin auth-check", () => {
  it("rejects requests without the admin token", async () => {
    const { app } = createTestApp();

    const response = await app.request("/admin/auth-check");
    expect(response.status).toBe(401);
  });

  it("returns ok for valid admin tokens", async () => {
    const { app } = createTestApp();

    const get = await app.request("/admin/auth-check", { headers: adminHeaders() });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ ok: true });

    const post = await app.request("/admin/auth-check", {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(post.status).toBe(200);
  });
});

describe("admin user management", () => {
  it("returns user detail with computers and sessions", async () => {
    const { app } = createTestApp();
    const owner = await registerUser(app, "detail@example.com");
    const computer = await createComputer(app, owner.token, "Detail VM");

    const response = await app.request(`/admin/users/${owner.userId}`, {
      headers: adminHeaders(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { id: owner.userId, email: "detail@example.com", username: "detail" },
      computers: [{ id: computer.id, name: "Detail VM", tunnelConnected: false }],
      sessions: [{ userId: owner.userId, revokedAt: null }],
    });
  });

  it("returns 404 for unknown user detail", async () => {
    const { app } = createTestApp();
    const response = await app.request("/admin/users/00000000-0000-0000-0000-000000000000", {
      headers: adminHeaders(),
    });
    expect(response.status).toBe(404);
  });

  it("deletes a user and terminates their cloud computers", async () => {
    const { app, store, provisioner } = createTestApp();
    const owner = await registerUser(app, "deleteme@example.com");
    const first = await createComputer(app, owner.token, "VM A");
    const second = await store.createComputer({
      ownerUserId: owner.userId,
      name: "VM B",
      kind: "cloud",
      status: "creating",
      providerMetadata: {},
      capabilities: [],
    });

    const deleted = await app.request(`/admin/users/${owner.userId}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });

    expect(deleted.status).toBe(200);
    expect(provisioner.actions.filter((action) => action === "terminate").length).toBe(2);

    const missing = await app.request(`/admin/users/${owner.userId}`, {
      headers: adminHeaders(),
    });
    expect(missing.status).toBe(404);

    const computerLookups = await Promise.all([
      app.request(`/admin/computers/${first.id}`, { headers: adminHeaders() }),
      app.request(`/admin/computers/${second.id}`, { headers: adminHeaders() }),
    ]);
    for (const response of computerLookups) {
      expect(response.status).toBe(404);
    }
  });

  it("resets a user password and lets them log in with the new password", async () => {
    const { app } = createTestApp();
    const owner = await registerUser(app, "rotate@example.com", "original-pw");

    const reset = await app.request(`/admin/users/${owner.userId}/password`, {
      method: "POST",
      body: JSON.stringify({ password: "rotated-pw" }),
      headers: adminHeaders(),
    });
    expect(reset.status).toBe(200);

    const oldLogin = await app.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "rotate@example.com", password: "original-pw" }),
      headers: { "content-type": "application/json" },
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await app.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "rotate@example.com", password: "rotated-pw" }),
      headers: { "content-type": "application/json" },
    });
    expect(newLogin.status).toBe(200);
  });

  it("lets admins update user Pi model access", async () => {
    const { app } = createTestApp();
    const owner = await registerUser(app, "pi-models@example.com");

    const initial = await app.request(`/admin/users/${owner.userId}`, {
      headers: adminHeaders(),
    });
    expect(await initial.json()).toMatchObject({
      user: { allowPiModels: false },
    });

    const update = await app.request(`/admin/users/${owner.userId}/model-access`, {
      method: "PATCH",
      body: JSON.stringify({ allowPiModels: true }),
      headers: adminHeaders(),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({
      user: { id: owner.userId, allowPiModels: true },
    });

    const me = await app.request("/auth/me", {
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(await me.json()).toMatchObject({
      user: { id: owner.userId, allowPiModels: true },
    });
  });

  it("lets admins update user browser stream access", async () => {
    const { app } = createTestApp();
    const owner = await registerUser(app, "browser-stream@example.com");

    const initial = await app.request(`/admin/users/${owner.userId}`, {
      headers: adminHeaders(),
    });
    expect(await initial.json()).toMatchObject({
      user: { allowBrowserStream: false },
    });

    const update = await app.request(`/admin/users/${owner.userId}/browser-stream-access`, {
      method: "PATCH",
      body: JSON.stringify({ allowBrowserStream: true }),
      headers: adminHeaders(),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({
      user: { id: owner.userId, allowBrowserStream: true },
    });

    const me = await app.request("/auth/me", {
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(await me.json()).toMatchObject({
      user: { id: owner.userId, allowBrowserStream: true },
    });
  });

  it("rejects weak passwords on reset", async () => {
    const { app } = createTestApp();
    const owner = await registerUser(app, "weakpw@example.com");

    const reset = await app.request(`/admin/users/${owner.userId}/password`, {
      method: "POST",
      body: JSON.stringify({ password: "x" }),
      headers: adminHeaders(),
    });
    expect(reset.status).toBe(400);
  });

  it("revokes all of a user's sessions", async () => {
    const { app } = createTestApp();
    const owner = await registerUser(app, "revoke@example.com");

    const second = await app.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "revoke@example.com", password: "password123" }),
      headers: { "content-type": "application/json" },
    });
    expect(second.status).toBe(200);

    const revoke = await app.request(`/admin/users/${owner.userId}/sessions/revoke-all`, {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ revokedCount: 2 });

    const me = await app.request("/auth/me", {
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(me.status).toBe(401);
  });
});

describe("admin computer management", () => {
  it("returns computer detail with identities and access sessions", async () => {
    const { app } = createTestApp();
    const owner = await registerUser(app, "comp-detail@example.com");
    const computer = await createComputer(app, owner.token, "Detail VM");
    await app.request(`/computers/${computer.id}/access-session`, {
      method: "POST",
      headers: authHeaders(owner.token),
    });

    const response = await app.request(`/admin/computers/${computer.id}`, {
      headers: adminHeaders(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      computer: {
        id: computer.id,
        name: "Detail VM",
        ownerEmail: "comp-detail@example.com",
        tunnelConnected: false,
      },
      identities: [{ computerId: computer.id, hasBootstrapToken: true, hasMachineToken: false }],
      accessSessions: [{ computerId: computer.id, userId: owner.userId }],
    });
  });

  it("renames a computer", async () => {
    const { app } = createTestApp();
    const owner = await registerUser(app, "rename@example.com");
    const computer = await createComputer(app, owner.token, "Original");

    const response = await app.request(`/admin/computers/${computer.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed VM" }),
      headers: adminHeaders(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      computer: { id: computer.id, name: "Renamed VM" },
    });
  });

  it("starts, stops, and restarts a computer via admin actions", async () => {
    const { app, provisioner } = createTestApp();
    const owner = await registerUser(app, "actions@example.com");
    const computer = await createComputer(app, owner.token, "Action VM");

    const start = await app.request(`/admin/computers/${computer.id}/start`, {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(start.status).toBe(200);

    const stop = await app.request(`/admin/computers/${computer.id}/stop`, {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(stop.status).toBe(200);

    const restart = await app.request(`/admin/computers/${computer.id}/restart`, {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(restart.status).toBe(200);
    expect(provisioner.actions).toContain("start");
    expect(provisioner.actions).toContain("stop");
    expect(provisioner.actions).toContain("restart");
  });

  it("revokes a machine identity", async () => {
    const { app, store } = createTestApp();
    const owner = await registerUser(app, "ident@example.com");
    const computer = await createComputer(app, owner.token, "Ident VM");
    const [identity] = await store.listMachineIdentitiesForComputer(computer.id);

    expect(identity).toBeDefined();

    const response = await app.request(
      `/admin/computers/${computer.id}/identities/${identity!.id}/revoke`,
      { method: "POST", headers: adminHeaders() },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      identity: { id: identity!.id, revokedAt: expect.any(String) },
    });
  });

  it("returns 404 for unknown computer detail", async () => {
    const { app } = createTestApp();
    const response = await app.request("/admin/computers/00000000-0000-0000-0000-000000000000", {
      headers: adminHeaders(),
    });
    expect(response.status).toBe(404);
  });
});

describe("admin overview tunnel state", () => {
  it("reflects tunnel registry state on overview and detail", async () => {
    const connected = new Set<string>();
    const tunnelRegistry = {
      isConnected: (computerId: string) => connected.has(computerId),
    };
    const store = new InMemoryCloudStore();
    const provisioner = new FakeProvisioner();
    const app = createApp({ config, store, provisioner, tunnelRegistry });
    const owner = await registerUser(app, "tunnel@example.com");
    const computer = await createComputer(app, owner.token, "Tunnel VM");

    connected.add(computer.id);

    const overview = await app.request("/admin/overview", { headers: adminHeaders() });
    expect(await overview.json()).toMatchObject({
      computers: [{ id: computer.id, tunnelConnected: true }],
    });

    const detail = await app.request(`/admin/computers/${computer.id}`, {
      headers: adminHeaders(),
    });
    expect(await detail.json()).toMatchObject({
      computer: { id: computer.id, tunnelConnected: true },
    });
  });
});

describe("admin AI usage analytics", () => {
  it("filters list by status, model, and from", async () => {
    const { app, store } = createTestApp();
    const owner = await registerUser(app, "ai-list@example.com");
    const computer = await createComputer(app, owner.token, "AI VM");
    const [identity] = await store.listMachineIdentitiesForComputer(computer.id);

    await seedAiUsage(store, {
      userId: owner.userId,
      computerId: computer.id,
      identityId: identity!.id,
      model: "gpt-4o",
      status: "succeeded",
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 800,
      startedAt: new Date("2026-04-01T10:00:00Z"),
    });
    await seedAiUsage(store, {
      userId: owner.userId,
      computerId: computer.id,
      identityId: identity!.id,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      status: "succeeded",
      inputTokens: 30,
      outputTokens: 12,
      durationMs: 800,
      startedAt: new Date("2026-04-04T10:00:00Z"),
      upstreamPath: "/v1/messages",
    });
    await seedAiUsage(store, {
      userId: owner.userId,
      computerId: computer.id,
      identityId: identity!.id,
      model: "gpt-4o-mini",
      status: "failed",
      inputTokens: 10,
      outputTokens: 0,
      durationMs: 50,
      startedAt: new Date("2026-04-02T10:00:00Z"),
    });
    await seedAiUsage(store, {
      userId: owner.userId,
      computerId: computer.id,
      identityId: identity!.id,
      model: "gpt-4o",
      status: "succeeded",
      inputTokens: 200,
      outputTokens: 80,
      durationMs: 1200,
      startedAt: new Date("2026-04-03T10:00:00Z"),
    });

    const filteredByStatus = await app.request(
      "/admin/ai-usage?status=failed",
      { headers: adminHeaders() },
    );
    expect(filteredByStatus.status).toBe(200);
    const failedBody = await filteredByStatus.json() as { readonly usage: ReadonlyArray<{ readonly status: string }> };
    expect(failedBody.usage).toHaveLength(1);
    expect(failedBody.usage[0]!.status).toBe("failed");

    const filteredByModel = await app.request(
      "/admin/ai-usage?model=gpt-4o",
      { headers: adminHeaders() },
    );
    expect(filteredByModel.status).toBe(200);
    const modelBody = await filteredByModel.json() as { readonly usage: ReadonlyArray<{ readonly model: string }> };
    expect(modelBody.usage).toHaveLength(2);
    expect(modelBody.usage.every((row) => row.model === "gpt-4o")).toBe(true);

    const filteredByFrom = await app.request(
      "/admin/ai-usage?from=2026-04-02T00:00:00Z",
      { headers: adminHeaders() },
    );
    expect(filteredByFrom.status).toBe(200);
    const fromBody = await filteredByFrom.json() as { readonly usage: unknown[] };
    expect(fromBody.usage).toHaveLength(3);

    const filteredByProvider = await app.request(
      "/admin/ai-usage?provider=anthropic",
      { headers: adminHeaders() },
    );
    expect(filteredByProvider.status).toBe(200);
    const providerBody = await filteredByProvider.json() as {
      readonly usage: ReadonlyArray<{ readonly provider: string; readonly model: string; readonly upstreamPath: string }>;
    };
    expect(providerBody.usage).toEqual([
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        upstreamPath: "/v1/messages",
      }),
    ]);
  });

  it("returns rich summary fields", async () => {
    const { app, store } = createTestApp();
    const owner = await registerUser(app, "ai-summary@example.com");
    const computer = await createComputer(app, owner.token, "Summary VM");
    const [identity] = await store.listMachineIdentitiesForComputer(computer.id);

    await seedAiUsage(store, {
      userId: owner.userId,
      computerId: computer.id,
      identityId: identity!.id,
      model: "gpt-4o",
      status: "succeeded",
      inputTokens: 100,
      outputTokens: 80,
      durationMs: 100,
      startedAt: new Date("2026-04-01T10:00:00Z"),
    });
    await seedAiUsage(store, {
      userId: owner.userId,
      computerId: computer.id,
      identityId: identity!.id,
      model: "gpt-4o",
      status: "failed",
      inputTokens: 5,
      outputTokens: 0,
      durationMs: null,
      startedAt: new Date("2026-04-01T11:00:00Z"),
    });
    await seedAiUsage(store, {
      userId: owner.userId,
      computerId: computer.id,
      identityId: identity!.id,
      model: "gpt-4o-mini",
      status: "succeeded",
      inputTokens: 20,
      outputTokens: 5,
      durationMs: 300,
      startedAt: new Date("2026-04-01T12:00:00Z"),
    });

    const response = await app.request("/admin/ai-usage/summary", { headers: adminHeaders() });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      readonly summary: {
        readonly requestCount: number;
        readonly successCount: number;
        readonly failedCount: number;
        readonly distinctModels: number;
        readonly distinctUsers: number;
        readonly distinctComputers: number;
        readonly avgDurationMs: number | null;
        readonly p50DurationMs: number | null;
        readonly p95DurationMs: number | null;
      };
    };
    expect(body.summary.requestCount).toBe(3);
    expect(body.summary.successCount).toBe(2);
    expect(body.summary.failedCount).toBe(1);
    expect(body.summary.distinctModels).toBe(2);
    expect(body.summary.distinctUsers).toBe(1);
    expect(body.summary.distinctComputers).toBe(1);
    expect(body.summary.avgDurationMs).toBe(200);
    expect(body.summary.p50DurationMs).not.toBeNull();
    expect(body.summary.p95DurationMs).not.toBeNull();
  });

  it("serializes estimated AI usage cost fields", async () => {
    const { app, store } = createTestApp();
    const owner = await registerUser(app, "ai-cost@example.com");
    const computer = await createComputer(app, owner.token, "Cost VM");
    const [identity] = await store.listMachineIdentitiesForComputer(computer.id);

    await seedAiUsage(store, {
      userId: owner.userId,
      computerId: computer.id,
      identityId: identity!.id,
      model: "gpt-5.5",
      status: "succeeded",
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 10,
      reasoningOutputTokens: 5,
      durationMs: 100,
      startedAt: new Date("2026-04-01T10:00:00Z"),
      metadata: {
        upstreamUsage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          input_tokens_details: { cached_tokens: 10 },
          output_tokens_details: { reasoning_tokens: 5 },
        },
      },
    });

    const listResponse = await app.request("/admin/ai-usage", { headers: adminHeaders() });
    const listBody = await listResponse.json() as {
      readonly usage: ReadonlyArray<{
        readonly estimatedCostUsd: number | null;
        readonly costBreakdown: {
          readonly totalUsd: number;
          readonly lineItems: ReadonlyArray<{ readonly key: string; readonly tokens: number }>;
        } | null;
      }>;
    };
    expect(listBody.usage[0]!.estimatedCostUsd).toBe(0.001055);
    expect(listBody.usage[0]!.costBreakdown).toMatchObject({
      totalUsd: 0.001055,
      lineItems: [
        { key: "input", tokens: 90 },
        { key: "cached-input", tokens: 10 },
        { key: "output", tokens: 20 },
      ],
    });

    const summaryResponse = await app.request("/admin/ai-usage/summary", { headers: adminHeaders() });
    const summaryBody = await summaryResponse.json() as {
      readonly summary: { readonly estimatedCostUsd: number };
    };
    expect(summaryBody.summary.estimatedCostUsd).toBe(0.001055);

    const breakdownResponse = await app.request(
      "/admin/ai-usage/breakdown?groupBy=model",
      { headers: adminHeaders() },
    );
    const breakdownBody = await breakdownResponse.json() as {
      readonly groups: ReadonlyArray<{ readonly estimatedCostUsd: number }>;
    };
    expect(breakdownBody.groups[0]!.estimatedCostUsd).toBe(0.001055);
  });

  it("returns daily token buckets", async () => {
    const { app, store } = createTestApp();
    const owner = await registerUser(app, "ai-buckets@example.com");
    const computer = await createComputer(app, owner.token, "Buckets VM");
    const [identity] = await store.listMachineIdentitiesForComputer(computer.id);

    await seedAiUsage(store, {
      userId: owner.userId,
      computerId: computer.id,
      identityId: identity!.id,
      model: "gpt-4o",
      status: "succeeded",
      inputTokens: 10,
      outputTokens: 5,
      durationMs: 100,
      startedAt: new Date("2026-04-01T10:00:00Z"),
    });
    await seedAiUsage(store, {
      userId: owner.userId,
      computerId: computer.id,
      identityId: identity!.id,
      model: "gpt-4o",
      status: "succeeded",
      inputTokens: 20,
      outputTokens: 10,
      durationMs: 100,
      startedAt: new Date("2026-04-01T22:00:00Z"),
    });
    await seedAiUsage(store, {
      userId: owner.userId,
      computerId: computer.id,
      identityId: identity!.id,
      model: "gpt-4o",
      status: "failed",
      inputTokens: 1,
      outputTokens: 0,
      durationMs: null,
      startedAt: new Date("2026-04-02T03:00:00Z"),
    });

    const response = await app.request(
      "/admin/ai-usage/buckets?bucket=day&from=2026-03-30T00:00:00Z&to=2026-04-05T00:00:00Z",
      { headers: adminHeaders() },
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      readonly buckets: ReadonlyArray<{
        readonly bucketStart: string;
        readonly requestCount: number;
        readonly inputTokens: number;
        readonly successCount: number;
        readonly failedCount: number;
      }>;
    };
    expect(body.buckets).toHaveLength(2);
    const [first, second] = body.buckets;
    expect(first!.bucketStart).toBe("2026-04-01T00:00:00.000Z");
    expect(first!.requestCount).toBe(2);
    expect(first!.inputTokens).toBe(30);
    expect(first!.successCount).toBe(2);
    expect(second!.bucketStart).toBe("2026-04-02T00:00:00.000Z");
    expect(second!.failedCount).toBe(1);
  });

  it("returns model and user breakdowns with labels", async () => {
    const { app, store } = createTestApp();
    const userA = await registerUser(app, "ai-break-a@example.com");
    const userB = await registerUser(app, "ai-break-b@example.com");
    const computerA = await createComputer(app, userA.token, "VM A");
    const computerB = await createComputer(app, userB.token, "VM B");
    const [identityA] = await store.listMachineIdentitiesForComputer(computerA.id);
    const [identityB] = await store.listMachineIdentitiesForComputer(computerB.id);

    await seedAiUsage(store, {
      userId: userA.userId,
      computerId: computerA.id,
      identityId: identityA!.id,
      model: "gpt-4o",
      status: "succeeded",
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 500,
      startedAt: new Date("2026-04-01T00:00:00Z"),
    });
    await seedAiUsage(store, {
      userId: userA.userId,
      computerId: computerA.id,
      identityId: identityA!.id,
      model: "gpt-4o",
      status: "succeeded",
      inputTokens: 200,
      outputTokens: 100,
      durationMs: 500,
      startedAt: new Date("2026-04-01T01:00:00Z"),
    });
    await seedAiUsage(store, {
      userId: userB.userId,
      computerId: computerB.id,
      identityId: identityB!.id,
      model: "gpt-4o-mini",
      status: "succeeded",
      inputTokens: 5,
      outputTokens: 5,
      durationMs: 100,
      startedAt: new Date("2026-04-01T02:00:00Z"),
    });

    const modelResponse = await app.request(
      "/admin/ai-usage/breakdown?groupBy=model&limit=10",
      { headers: adminHeaders() },
    );
    expect(modelResponse.status).toBe(200);
    const modelBody = await modelResponse.json() as {
      readonly groupBy: string;
      readonly groups: ReadonlyArray<{ readonly key: string; readonly label: string; readonly totalTokens: number }>;
    };
    expect(modelBody.groupBy).toBe("model");
    expect(modelBody.groups[0]!.key).toBe("gpt-4o");
    expect(modelBody.groups[0]!.totalTokens).toBeGreaterThan(modelBody.groups[1]!.totalTokens);

    const userResponse = await app.request(
      "/admin/ai-usage/breakdown?groupBy=user",
      { headers: adminHeaders() },
    );
    expect(userResponse.status).toBe(200);
    const userBody = await userResponse.json() as {
      readonly groups: ReadonlyArray<{ readonly key: string; readonly label: string }>;
    };
    const labelByKey = new Map(userBody.groups.map((row) => [row.key, row.label]));
    expect(labelByKey.get(userA.userId)).toBe("ai-break-a@example.com");
    expect(labelByKey.get(userB.userId)).toBe("ai-break-b@example.com");

    const providerResponse = await app.request(
      "/admin/ai-usage/breakdown?groupBy=provider",
      { headers: adminHeaders() },
    );
    expect(providerResponse.status).toBe(200);
    const providerBody = await providerResponse.json() as {
      readonly groupBy: string;
      readonly groups: ReadonlyArray<{ readonly key: string; readonly requestCount: number }>;
    };
    expect(providerBody.groupBy).toBe("provider");
    expect(providerBody.groups).toEqual([
      expect.objectContaining({ key: "azure", requestCount: 3 }),
    ]);
  });

  it("returns combined per-user analytics", async () => {
    const { app, store } = createTestApp();
    const owner = await registerUser(app, "ai-user@example.com");
    const computer = await createComputer(app, owner.token, "User AI VM");
    const [identity] = await store.listMachineIdentitiesForComputer(computer.id);

    await seedAiUsage(store, {
      userId: owner.userId,
      computerId: computer.id,
      identityId: identity!.id,
      model: "gpt-4o",
      status: "succeeded",
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 200,
      startedAt: new Date("2026-04-01T10:00:00Z"),
    });

    const response = await app.request(
      `/admin/users/${owner.userId}/ai-usage?from=2026-03-30T00:00:00Z`,
      { headers: adminHeaders() },
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      readonly summary: { readonly requestCount: number };
      readonly buckets: ReadonlyArray<{ readonly requestCount: number }>;
      readonly breakdown: {
        readonly models: ReadonlyArray<{ readonly key: string }>;
        readonly computers: ReadonlyArray<{ readonly key: string; readonly label: string }>;
      };
    };
    expect(body.summary.requestCount).toBe(1);
    expect(body.buckets).toHaveLength(1);
    expect(body.breakdown.models[0]!.key).toBe("gpt-4o");
    expect(body.breakdown.computers[0]!.key).toBe(computer.id);
    expect(body.breakdown.computers[0]!.label).toBe("User AI VM");
  });

  it("returns 404 for unknown user/computer ai-usage", async () => {
    const { app } = createTestApp();
    const userResponse = await app.request(
      "/admin/users/00000000-0000-0000-0000-000000000000/ai-usage",
      { headers: adminHeaders() },
    );
    expect(userResponse.status).toBe(404);

    const computerResponse = await app.request(
      "/admin/computers/00000000-0000-0000-0000-000000000000/ai-usage",
      { headers: adminHeaders() },
    );
    expect(computerResponse.status).toBe(404);
  });

  it("returns combined per-computer analytics", async () => {
    const { app, store } = createTestApp();
    const owner = await registerUser(app, "ai-comp@example.com");
    const computer = await createComputer(app, owner.token, "Computer AI VM");
    const [identity] = await store.listMachineIdentitiesForComputer(computer.id);

    await seedAiUsage(store, {
      userId: owner.userId,
      computerId: computer.id,
      identityId: identity!.id,
      model: "gpt-4o",
      status: "succeeded",
      inputTokens: 50,
      outputTokens: 25,
      durationMs: 150,
      startedAt: new Date("2026-04-01T10:00:00Z"),
    });

    const response = await app.request(
      `/admin/computers/${computer.id}/ai-usage`,
      { headers: adminHeaders() },
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      readonly summary: { readonly requestCount: number };
      readonly breakdown: {
        readonly models: ReadonlyArray<{ readonly key: string }>;
        readonly users: ReadonlyArray<{ readonly key: string; readonly label: string }>;
      };
    };
    expect(body.summary.requestCount).toBe(1);
    expect(body.breakdown.models[0]!.key).toBe("gpt-4o");
    expect(body.breakdown.users[0]!.key).toBe(owner.userId);
    expect(body.breakdown.users[0]!.label).toBe("ai-comp@example.com");
  });
});

describe("admin release management", () => {
  it("deletes a release manifest", async () => {
    const { app } = createTestApp();
    const created = await app.request("/admin/releases/machine-server", {
      method: "POST",
      body: JSON.stringify({
        channel: "stable",
        version: "0.1.0",
        downloadUrl: "https://downloads.example.com/machine-server.tar.gz",
      }),
      headers: adminHeaders(),
    });
    const body = await created.json() as { readonly release: { readonly id: string } };

    const deleted = await app.request(`/admin/releases/${body.release.id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(deleted.status).toBe(200);

    const list = await app.request("/admin/overview", { headers: adminHeaders() });
    expect(await list.json()).toMatchObject({ releases: [] });
  });

  it("returns 404 when deleting an unknown release", async () => {
    const { app } = createTestApp();
    const response = await app.request("/admin/releases/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(response.status).toBe(404);
  });
});

const createTestApp = () => {
  const store = new InMemoryCloudStore();
  const provisioner = new FakeProvisioner();
  const tunnelRegistry = { isConnected: () => false };
  const app = createApp({ config, store, provisioner, tunnelRegistry });

  return { app, store, provisioner };
};

const registerUser = async (
  app: ReturnType<typeof createApp>,
  email: string,
  password = "password123",
): Promise<{ readonly userId: string; readonly token: string }> => {
  await app.request("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, username: usernameFromEmail(email), password }),
    headers: adminHeaders(),
  });
  const login = await app.request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    headers: { "content-type": "application/json" },
  });
  const body = await login.json() as {
    readonly user: { readonly id: string };
    readonly session: { readonly token: string };
  };

  return { userId: body.user.id, token: body.session.token };
};

const usernameFromEmail = (email: string): string => email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9_-]/g, "-");

const createComputer = async (
  app: ReturnType<typeof createApp>,
  token: string,
  name: string,
): Promise<{ readonly id: string; readonly name: string }> => {
  const response = await app.request("/computers", {
    method: "POST",
    body: JSON.stringify({ name }),
    headers: authHeaders(token),
  });
  const body = await response.json() as { readonly computer: { readonly id: string; readonly name: string } };
  return body.computer;
};

const seedAiUsage = async (
  store: InMemoryCloudStore,
  input: {
    readonly userId: string;
    readonly computerId: string;
    readonly identityId: string;
    readonly provider?: string;
    readonly model: string | null;
    readonly status: "started" | "succeeded" | "failed" | "aborted";
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cachedInputTokens?: number;
    readonly reasoningOutputTokens?: number;
    readonly durationMs: number | null;
    readonly startedAt: Date;
    readonly metadata?: unknown;
    readonly upstreamPath?: string;
  },
): Promise<void> => {
  const usage = await store.createAiUsageRequest({
    userId: input.userId,
    computerId: input.computerId,
    machineIdentityId: input.identityId,
    provider: input.provider ?? "azure",
    model: input.model,
    method: "POST",
    upstreamPath: input.upstreamPath ?? "/openai/v1/chat/completions",
    status: input.status === "succeeded" || input.status === "failed" || input.status === "aborted"
      ? "started"
      : input.status,
    startedAt: input.startedAt,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });
  if (input.status === "started") {
    return;
  }
  const completedAt = input.durationMs !== null
    ? new Date(input.startedAt.getTime() + input.durationMs)
    : input.startedAt;
  await store.updateAiUsageRequest({
    id: usage.id,
    status: input.status,
    httpStatus: input.status === "succeeded" ? 200 : 500,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    ...(input.cachedInputTokens !== undefined ? { cachedInputTokens: input.cachedInputTokens } : {}),
    ...(input.reasoningOutputTokens !== undefined ? { reasoningOutputTokens: input.reasoningOutputTokens } : {}),
    totalTokens: input.inputTokens + input.outputTokens,
    completedAt,
    durationMs: input.durationMs,
  });
};

const authHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

const adminHeaders = () => ({
  authorization: `Bearer ${config.adminToken}`,
  "content-type": "application/json",
});

class FakeProvisioner implements ComputerProvisioner {
  readonly actions: string[] = [];

  async provisionComputer(input: {
    readonly computer: ComputerRecord;
    readonly bootstrapToken: string;
  }) {
    this.actions.push("provision");
    return {
      providerMetadata: {
        provider: "aws-ec2",
        preset: "dev-8gb",
        region: "ap-south-1",
        instanceId: `i-${input.computer.id.slice(0, 8)}`,
        instanceType: "t3.large",
        imageId: "ami-test",
        rootVolumeGb: 80,
      },
    };
  }

  async startComputer(computer: ComputerRecord) {
    this.actions.push("start");
    return { ...(computer.providerMetadata as Record<string, unknown>), lastAction: "start" };
  }

  async stopComputer(computer: ComputerRecord) {
    this.actions.push("stop");
    return { ...(computer.providerMetadata as Record<string, unknown>), lastAction: "stop" };
  }

  async restartComputer(computer: ComputerRecord) {
    this.actions.push("restart");
    return { ...(computer.providerMetadata as Record<string, unknown>), lastAction: "restart" };
  }

  async terminateComputer(computer: ComputerRecord) {
    this.actions.push("terminate");
    return { ...(computer.providerMetadata as Record<string, unknown>), lastAction: "terminate" };
  }
}
