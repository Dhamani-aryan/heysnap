import { describe, expect, it } from "vitest";

import type { CloudServerConfig } from "../src/config.js";
import { hashToken } from "../src/auth/tokens.js";
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
  machineServerImage: "example.com/ank1015-machine-server:test",
  machineServerVersion: "test-version",
  allowedOrigins: ["https://app.example.com", "http://localhost:3000"],
  adminToken: "test-admin-token",
};

describe("cloud server cors", () => {
  it("allows configured browser origins for bearer auth requests", async () => {
    const { app } = createTestApp();
    const auth = await registerUser(app, "user@example.com");
    const preflight = await app.request("/auth/me", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });

    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");

    const me = await app.request("/auth/me", {
      headers: {
        authorization: `Bearer ${auth.token}`,
        origin: "https://app.example.com",
      },
    });

    expect(me.status).toBe(200);
    expect(me.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
  });

  it("does not allow unknown browser origins", async () => {
    const { app } = createTestApp();
    const response = await app.request("/health", {
      headers: { origin: "https://unknown.example.com" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("cloud server auth", () => {
  it("does not expose public user registration", async () => {
    const { app } = createTestApp();
    const register = await app.request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: "USER@example.com", password: "password123" }),
      headers: { "content-type": "application/json" },
    });

    expect(register.status).toBe(404);
  });

  it("lets admins create users and users log in", async () => {
    const { app } = createTestApp();
    const created = await createUserAsAdmin(app, "USER@example.com", "password123");

    expect(created.user.email).toBe("user@example.com");

    const login = await loginUser(app, "user@example.com", "password123");

    const me = await app.request("/auth/me", {
      headers: { authorization: `Bearer ${login.token}` },
    });

    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      user: {
        id: created.user.id,
        email: "user@example.com",
      },
    });
  });

  it("requires admin access and rejects duplicate emails for user creation", async () => {
    const { app } = createTestApp();
    await createUserAsAdmin(app, "user@example.com");

    const unauthorized = await app.request("/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: "other@example.com", password: "password123" }),
      headers: { "content-type": "application/json" },
    });
    expect(unauthorized.status).toBe(401);

    const duplicate = await app.request("/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: "USER@example.com", password: "password123" }),
      headers: adminHeaders(),
    });

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      error: { code: "EMAIL_ALREADY_REGISTERED" },
    });
  });

  it("rejects invalid admin-created email addresses", async () => {
    const { app } = createTestApp();

    const response = await app.request("/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: "not-an-email", password: "password123" }),
      headers: adminHeaders(),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_EMAIL" },
    });
  });

  it("allows admin-created beta test passwords", async () => {
    const { app } = createTestApp();
    await createUserAsAdmin(app, "tester1@gmail.com", "tester1");

    const login = await loginUser(app, "tester1@gmail.com", "tester1");

    expect(login.token).toEqual(expect.any(String));
  });

  it("serves the admin dashboard shell", async () => {
    const { app } = createTestApp();
    const response = await app.request("/admin-dashboard");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("HeySnap Admin");
  });

  it("lets admins inspect users, computers, and release inventory", async () => {
    const { app } = createTestApp();
    const owner = await registerUser(app, "owner@example.com");
    const computer = await createComputer(app, owner.token, "Owner VM");
    await app.request("/admin/releases/machine-server", {
      method: "POST",
      body: JSON.stringify({
        channel: "stable",
        version: "1.0.0",
        dockerImage: "example.com/machine-server:1.0.0",
      }),
      headers: adminHeaders(),
    });

    const unauthorized = await app.request("/admin/overview");
    expect(unauthorized.status).toBe(401);

    const overview = await app.request("/admin/overview", {
      headers: adminHeaders(),
    });

    expect(overview.status).toBe(200);
    expect(await overview.json()).toMatchObject({
      stats: {
        users: 1,
        computers: 1,
        cloudComputers: 1,
      },
      users: [
        {
          email: "owner@example.com",
          computerCount: 1,
        },
      ],
      computers: [
        {
          id: computer.id,
          name: "Owner VM",
          ownerEmail: "owner@example.com",
        },
      ],
      releases: [
        {
          target: "machine-server",
          version: "1.0.0",
        },
      ],
    });
  });

  it("lets admins delete any computer and terminates provider resources", async () => {
    const { app, provisioner } = createTestApp();
    const owner = await registerUser(app, "delete-owner@example.com");
    const computer = await createComputer(app, owner.token, "Delete VM");

    const deleted = await app.request(`/admin/computers/${computer.id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });

    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    expect(provisioner.actions).toContain("terminate");

    const missing = await app.request(`/computers/${computer.id}`, {
      headers: authHeaders(owner.token),
    });
    expect(missing.status).toBe(404);
  });

  it("logs in with the correct password and rejects the wrong password", async () => {
    const { app } = createTestApp();
    await registerUser(app, "user@example.com", "password123");

    const failed = await app.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com", password: "wrong-password" }),
      headers: { "content-type": "application/json" },
    });
    expect(failed.status).toBe(401);

    const login = await app.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com", password: "password123" }),
      headers: { "content-type": "application/json" },
    });
    expect(login.status).toBe(200);
    expect((await login.json() as AuthResponse).session.token).toEqual(expect.any(String));
  });

  it("requires auth for /auth/me and revokes sessions on logout", async () => {
    const { app } = createTestApp();
    const auth = await registerUser(app, "user@example.com");

    expect((await app.request("/auth/me")).status).toBe(401);

    const logout = await app.request("/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${auth.token}` },
    });
    expect(logout.status).toBe(200);

    const me = await app.request("/auth/me", {
      headers: { authorization: `Bearer ${auth.token}` },
    });
    expect(me.status).toBe(401);
  });
});

describe("cloud server computer inventory", () => {
  it("requires auth for computer requests", async () => {
    const { app } = createTestApp();

    expect((await app.request("/computers")).status).toBe(401);
    expect((await app.request("/computers", {
      method: "POST",
      body: JSON.stringify({ name: "Dev VM" }),
      headers: { "content-type": "application/json" },
    })).status).toBe(401);
  });

  it("lets users create, list, read, rename, and delete their own computers", async () => {
    const { app } = createTestApp();
    const auth = await registerUser(app, "user@example.com");

    const created = await app.request("/computers", {
      method: "POST",
      body: JSON.stringify({ name: "Dev VM" }),
      headers: authHeaders(auth.token),
    });
    expect(created.status).toBe(201);

    const createdBody = await created.json() as ComputerResponse;
    expect(createdBody.computer).toMatchObject({
      name: "Dev VM",
      kind: "cloud",
      status: "creating",
      providerMetadata: expect.objectContaining({
        provider: "aws-ec2",
        instanceId: expect.any(String),
      }),
      capabilities: [],
    });

    const listed = await app.request("/computers", { headers: authHeaders(auth.token) });
    expect(await listed.json()).toMatchObject({
      computers: [expect.objectContaining({ id: createdBody.computer.id, name: "Dev VM" })],
    });

    const read = await app.request(`/computers/${createdBody.computer.id}`, {
      headers: authHeaders(auth.token),
    });
    expect(await read.json()).toMatchObject({
      computer: expect.objectContaining({ id: createdBody.computer.id }),
    });

    const renamed = await app.request(`/computers/${createdBody.computer.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed VM" }),
      headers: authHeaders(auth.token),
    });
    expect(await renamed.json()).toMatchObject({
      computer: expect.objectContaining({ name: "Renamed VM" }),
    });

    const deleted = await app.request(`/computers/${createdBody.computer.id}`, {
      method: "DELETE",
      headers: authHeaders(auth.token),
    });
    expect(deleted.status).toBe(200);
    expect((await app.request(`/computers/${createdBody.computer.id}`, {
      headers: authHeaders(auth.token),
    })).status).toBe(404);
  });

  it("does not allow users to access another user's computer", async () => {
    const { app } = createTestApp();
    const owner = await registerUser(app, "owner@example.com");
    const other = await registerUser(app, "other@example.com");
    const created = await createComputer(app, owner.token, "Owner VM");

    expect((await app.request(`/computers/${created.id}`, {
      headers: authHeaders(other.token),
    })).status).toBe(404);
    expect((await app.request(`/computers/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "nope" }),
      headers: authHeaders(other.token),
    })).status).toBe(404);
    expect((await app.request(`/computers/${created.id}`, {
      method: "DELETE",
      headers: authHeaders(other.token),
    })).status).toBe(404);
  });

  it("starts, stops, and restarts owned computers only", async () => {
    const { app, provisioner } = createTestApp();
    const owner = await registerUser(app, "owner@example.com");
    const other = await registerUser(app, "other@example.com");
    const computer = await createComputer(app, owner.token, "Owner VM");

    expect((await app.request(`/computers/${computer.id}/start`, {
      method: "POST",
      headers: authHeaders(other.token),
    })).status).toBe(404);

    const start = await app.request(`/computers/${computer.id}/start`, {
      method: "POST",
      headers: authHeaders(owner.token),
    });
    expect(start.status).toBe(200);
    expect((await start.json() as ComputerResponse).computer.status).toBe("starting");

    const stop = await app.request(`/computers/${computer.id}/stop`, {
      method: "POST",
      headers: authHeaders(owner.token),
    });
    expect((await stop.json() as ComputerResponse).computer.status).toBe("sleeping");

    const restart = await app.request(`/computers/${computer.id}/restart`, {
      method: "POST",
      headers: authHeaders(owner.token),
    });
    expect((await restart.json() as ComputerResponse).computer.status).toBe("starting");
    expect(provisioner.actions).toEqual(["provision", "start", "stop", "restart"]);
  });

  it("syncs one local computer per user device and returns a machine token", async () => {
    const { app, store } = createTestApp();
    const auth = await registerUser(app, "user@example.com");

    const created = await app.request("/computers/local", {
      method: "POST",
      body: JSON.stringify({
        localDeviceId: "local-device-1",
        name: "Local Machine",
        capabilities: ["filesystem", "agent"],
        machineServerVersion: "desktop-test",
      }),
      headers: authHeaders(auth.token),
    });

    expect(created.status).toBe(201);
    const createdBody = await created.json() as LocalComputerSyncResponse;
    expect(createdBody.computer).toMatchObject({
      name: "Local Machine",
      kind: "local",
      status: "online",
      providerMetadata: {
        provider: "electron-local",
        localDeviceId: "local-device-1",
      },
      capabilities: ["filesystem", "agent"],
      machineServerVersion: "desktop-test",
      lastHeartbeatAt: expect.any(String),
    });
    expect(createdBody.machine).toMatchObject({
      computerId: createdBody.computer.id,
      token: expect.any(String),
      heartbeatIntervalSeconds: 30,
    });
    expect(await store.getMachineIdentityByTokenHash(hashToken(createdBody.machine.token, config.sessionSecret)))
      .not.toBeNull();
    expect(JSON.stringify(Array.from(store.machineIdentities.values()))).not.toContain(createdBody.machine.token);

    const heartbeat = await app.request("/machines/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        status: "idle",
        capabilities: ["filesystem", "agent", "local"],
        machineServerVersion: "desktop-test-2",
      }),
      headers: {
        authorization: `Bearer ${createdBody.machine.token}`,
        "content-type": "application/json",
      },
    });

    expect(heartbeat.status).toBe(200);
    expect(await heartbeat.json()).toMatchObject({
      computer: {
        id: createdBody.computer.id,
        status: "idle",
        capabilities: ["filesystem", "agent", "local"],
        machineServerVersion: "desktop-test-2",
      },
    });

    const updated = await app.request("/computers/local", {
      method: "POST",
      body: JSON.stringify({
        localDeviceId: "local-device-1",
        name: "Renamed Local",
        capabilities: ["filesystem", "agent"],
        machineServerVersion: "desktop-test-3",
      }),
      headers: authHeaders(auth.token),
    });
    const updatedBody = await updated.json() as LocalComputerSyncResponse;

    expect(updated.status).toBe(200);
    expect(updatedBody.computer).toMatchObject({
      id: createdBody.computer.id,
      name: "Renamed Local",
      kind: "local",
    });
  });

  it("keeps local computer device ids scoped to the owning user", async () => {
    const { app } = createTestApp();
    const firstUser = await registerUser(app, "first@example.com");
    const secondUser = await registerUser(app, "second@example.com");
    const first = await syncLocalComputer(app, firstUser.token, "shared-device");
    const second = await syncLocalComputer(app, secondUser.token, "shared-device");

    expect(first.computer.id).not.toBe(second.computer.id);
    expect((await app.request(`/computers/${first.computer.id}`, {
      headers: authHeaders(secondUser.token),
    })).status).toBe(404);
  });

  it("removes replaced local device records during local id migration", async () => {
    const { app } = createTestApp();
    const auth = await registerUser(app, "local-migration@example.com");
    const original = await syncLocalComputer(app, auth.token, "old-local-device");
    const duplicate = await syncLocalComputer(app, auth.token, "new-local-device");

    expect(original.computer.id).not.toBe(duplicate.computer.id);

    const migrated = await app.request("/computers/local", {
      method: "POST",
      body: JSON.stringify({
        localDeviceId: "old-local-device",
        replacedLocalDeviceIds: ["new-local-device"],
        name: "Migrated Local",
        capabilities: ["filesystem", "agent"],
        machineServerVersion: "desktop-test",
      }),
      headers: authHeaders(auth.token),
    });

    expect(migrated.status).toBe(200);
    const computers = await app.request("/computers", {
      headers: authHeaders(auth.token),
    });
    const body = await computers.json() as ComputersResponse;

    expect(body.computers).toHaveLength(1);
    expect(body.computers[0]).toMatchObject({
      id: original.computer.id,
      name: "Migrated Local",
      providerMetadata: {
        localDeviceId: "old-local-device",
      },
    });
  });
});

describe("cloud server computer access sessions", () => {
  it("creates an access session for owned computers and stores only the token hash", async () => {
    const { app, store } = createTestApp();
    const auth = await registerUser(app, "user@example.com");
    const computer = await createComputer(app, auth.token, "Dev VM");

    const response = await app.request(`/computers/${computer.id}/access-session`, {
      method: "POST",
      headers: authHeaders(auth.token),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as AccessSessionResponse;
    expect(body.accessSession).toMatchObject({
      computerId: computer.id,
      token: expect.any(String),
    });
    expect(body.routes).toEqual({
      filesystemWebSocketUrl: `/gateway/computers/${computer.id}/filesystem`,
      agentWebSocketUrl: `/gateway/computers/${computer.id}/agent`,
    });

    const tokenHash = hashToken(body.accessSession.token, config.sessionSecret);
    const stored = await store.getComputerAccessSessionByTokenHash(tokenHash);
    expect(stored).not.toBeNull();
    expect(stored?.tokenHash).toBe(tokenHash);
    expect(JSON.stringify(stored)).not.toContain(body.accessSession.token);
  });

  it("requires ownership before creating an access session", async () => {
    const { app } = createTestApp();
    const owner = await registerUser(app, "owner@example.com");
    const other = await registerUser(app, "other@example.com");
    const computer = await createComputer(app, owner.token, "Owner VM");

    const response = await app.request(`/computers/${computer.id}/access-session`, {
      method: "POST",
      headers: authHeaders(other.token),
    });

    expect(response.status).toBe(404);
  });
});

describe("cloud server release manifests", () => {
  it("lets admins publish desktop releases and exposes latest checks publicly", async () => {
    const { app } = createTestApp();

    const unauthorized = await app.request("/admin/releases/desktop", {
      method: "POST",
      body: JSON.stringify({
        platform: "darwin-arm64",
        version: "1.2.3",
        downloadUrl: "https://downloads.example.com/app.dmg",
      }),
      headers: { "content-type": "application/json" },
    });
    expect(unauthorized.status).toBe(401);

    const published = await app.request("/admin/releases/desktop", {
      method: "POST",
      body: JSON.stringify({
        channel: "stable",
        platform: "darwin-arm64",
        version: "1.2.3",
        downloadUrl: "https://downloads.example.com/app.dmg",
        signatureUrl: "https://downloads.example.com/app.dmg.sig",
        notes: "Desktop release",
        metadata: { sha256: "abc123" },
        releasedAt: "2026-05-05T00:00:00.000Z",
      }),
      headers: adminHeaders(),
    });

    expect(published.status).toBe(201);
    expect(await published.json()).toMatchObject({
      release: {
        target: "desktop",
        channel: "stable",
        platform: "darwin-arm64",
        version: "1.2.3",
        downloadUrl: "https://downloads.example.com/app.dmg",
        signatureUrl: "https://downloads.example.com/app.dmg.sig",
        notes: "Desktop release",
        metadata: { sha256: "abc123" },
        releasedAt: "2026-05-05T00:00:00.000Z",
      },
    });

    const latest = await app.request("/releases/desktop/latest?platform=darwin-arm64&currentVersion=1.2.0");
    expect(latest.status).toBe(200);
    expect(await latest.json()).toMatchObject({
      currentVersion: "1.2.0",
      updateAvailable: true,
      latest: {
        target: "desktop",
        channel: "stable",
        platform: "darwin-arm64",
        version: "1.2.3",
      },
    });

    const current = await app.request("/releases/desktop/latest?platform=darwin-arm64&currentVersion=1.2.3");
    expect(await current.json()).toMatchObject({
      currentVersion: "1.2.3",
      updateAvailable: false,
    });
  });

  it("lets machines check protected machine-server release manifests", async () => {
    const { app, provisioner } = createTestApp();
    const auth = await registerUser(app, "machine-release@example.com");
    const computer = await createComputer(app, auth.token, "Machine VM");
    const bootstrapToken = provisioner.bootstrapTokens.get(computer.id);
    const registration = await app.request("/machines/register", {
      method: "POST",
      body: JSON.stringify({
        computerId: computer.id,
        bootstrapToken,
        machineServerVersion: "1.0.0",
        capabilities: ["filesystem", "agent"],
      }),
      headers: { "content-type": "application/json" },
    });
    const registered = await registration.json() as {
      readonly machine: { readonly token: string };
    };

    const published = await app.request("/admin/releases/machine-server", {
      method: "POST",
      body: JSON.stringify({
        channel: "stable",
        version: "1.1.0",
        dockerImage: "example.com/ank1015-machine-server:1.1.0",
        notes: "Machine server rollout",
      }),
      headers: adminHeaders(),
    });
    expect(published.status).toBe(201);

    expect((await app.request("/machines/update-check")).status).toBe(401);

    const updateCheck = await app.request("/machines/update-check?currentVersion=1.0.0", {
      headers: { authorization: `Bearer ${registered.machine.token}` },
    });
    expect(updateCheck.status).toBe(200);
    expect(await updateCheck.json()).toMatchObject({
      update: {
        currentVersion: "1.0.0",
        updateAvailable: true,
        latest: {
          target: "machine-server",
          channel: "stable",
          platform: "default",
          version: "1.1.0",
          dockerImage: "example.com/ank1015-machine-server:1.1.0",
        },
      },
    });

    const heartbeat = await app.request("/machines/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        status: "idle",
        machineServerVersion: "1.0.0",
      }),
      headers: {
        authorization: `Bearer ${registered.machine.token}`,
        "content-type": "application/json",
      },
    });
    expect(await heartbeat.json()).toMatchObject({
      update: {
        updateAvailable: true,
        latest: {
          version: "1.1.0",
        },
      },
    });
  });
});

describe("cloud server machine registration", () => {
  it("exchanges a bootstrap token for a machine token and accepts heartbeats", async () => {
    const { app, provisioner } = createTestApp();
    const auth = await registerUser(app, "user@example.com");
    const computer = await createComputer(app, auth.token, "Machine VM");
    const bootstrapToken = provisioner.bootstrapTokens.get(computer.id);

    expect(bootstrapToken).toEqual(expect.any(String));

    const registration = await app.request("/machines/register", {
      method: "POST",
      body: JSON.stringify({
        computerId: computer.id,
        bootstrapToken,
        machineServerVersion: "0.1.0",
        capabilities: ["filesystem", "agent"],
      }),
      headers: { "content-type": "application/json" },
    });

    expect(registration.status).toBe(201);
    const registered = await registration.json() as {
      readonly machine: { readonly token: string };
      readonly computer: { readonly status: string; readonly machineServerVersion: string };
    };
    expect(registered.computer).toMatchObject({
      status: "online",
      machineServerVersion: "0.1.0",
    });

    const reusedBootstrap = await app.request("/machines/register", {
      method: "POST",
      body: JSON.stringify({ computerId: computer.id, bootstrapToken }),
      headers: { "content-type": "application/json" },
    });
    expect(reusedBootstrap.status).toBe(401);

    const heartbeat = await app.request("/machines/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        status: "idle",
        capabilities: ["filesystem", "agent", "terminal"],
        machineServerVersion: "0.1.1",
      }),
      headers: {
        authorization: `Bearer ${registered.machine.token}`,
        "content-type": "application/json",
      },
    });

    expect(heartbeat.status).toBe(200);
    expect(await heartbeat.json()).toMatchObject({
      computer: {
        status: "idle",
        capabilities: ["filesystem", "agent", "terminal"],
        machineServerVersion: "0.1.1",
        lastHeartbeatAt: expect.any(String),
      },
    });

    const badHeartbeat = await app.request("/machines/heartbeat", {
      method: "POST",
      body: JSON.stringify({}),
      headers: {
        authorization: "Bearer bad-token",
        "content-type": "application/json",
      },
    });
    expect(badHeartbeat.status).toBe(401);
  });
});

const createTestApp = () => {
  const store = new InMemoryCloudStore();
  const provisioner = new FakeProvisioner();
  const app = createApp({ config, store, provisioner });

  return { app, store, provisioner };
};

const registerUser = async (
  app: ReturnType<typeof createApp>,
  email: string,
  password = "password123",
): Promise<{ readonly userId: string; readonly token: string }> => {
  await createUserAsAdmin(app, email, password);
  return loginUser(app, email, password);
};

const createUserAsAdmin = async (
  app: ReturnType<typeof createApp>,
  email: string,
  password = "password123",
): Promise<{ readonly user: AuthResponse["user"] }> => {
  const response = await app.request("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    headers: adminHeaders(),
  });
  return await response.json() as { readonly user: AuthResponse["user"] };
};

const loginUser = async (
  app: ReturnType<typeof createApp>,
  email: string,
  password = "password123",
): Promise<{ readonly userId: string; readonly token: string }> => {
  const response = await app.request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    headers: { "content-type": "application/json" },
  });
  const body = await response.json() as AuthResponse;

  return {
    userId: body.user.id,
    token: body.session.token,
  };
};

const createComputer = async (
  app: ReturnType<typeof createApp>,
  token: string,
  name: string,
): Promise<ComputerResponse["computer"]> => {
  const response = await app.request("/computers", {
    method: "POST",
    body: JSON.stringify({ name }),
    headers: authHeaders(token),
  });
  const body = await response.json() as ComputerResponse;

  return body.computer;
};

const authHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

const adminHeaders = () => ({
  authorization: `Bearer ${config.adminToken}`,
  "content-type": "application/json",
});

interface AuthResponse {
  readonly user: {
    readonly id: string;
    readonly email: string;
  };
  readonly session: {
    readonly token: string;
    readonly expiresAt: string;
  };
}

interface ComputerResponse {
  readonly computer: {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
    readonly status: string;
    readonly providerMetadata: unknown;
    readonly capabilities: unknown;
    readonly machineServerVersion: string | null;
  };
}

interface AccessSessionResponse {
  readonly accessSession: {
    readonly id: string;
    readonly computerId: string;
    readonly token: string;
    readonly expiresAt: string;
  };
  readonly routes: {
    readonly filesystemWebSocketUrl: string;
    readonly agentWebSocketUrl: string;
  };
}

interface LocalComputerSyncResponse {
  readonly computer: ComputerResponse["computer"] & {
    readonly ownerUserId: string;
    readonly providerMetadata: unknown;
    readonly lastHeartbeatAt: string | null;
  };
  readonly machine: {
    readonly computerId: string;
    readonly token: string;
    readonly heartbeatIntervalSeconds: number;
  };
}

const syncLocalComputer = async (
  app: ReturnType<typeof createApp>,
  token: string,
  localDeviceId: string,
): Promise<LocalComputerSyncResponse> => {
  const response = await app.request("/computers/local", {
    method: "POST",
    body: JSON.stringify({
      localDeviceId,
      name: "Local Machine",
      capabilities: ["filesystem", "agent"],
      machineServerVersion: "desktop-test",
    }),
    headers: authHeaders(token),
  });

  return await response.json() as LocalComputerSyncResponse;
};

class FakeProvisioner implements ComputerProvisioner {
  readonly actions: string[] = [];
  readonly bootstrapTokens = new Map<string, string>();

  async provisionComputer(input: {
    readonly computer: ComputerRecord;
    readonly bootstrapToken: string;
  }) {
    this.actions.push("provision");
    this.bootstrapTokens.set(input.computer.id, input.bootstrapToken);
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
