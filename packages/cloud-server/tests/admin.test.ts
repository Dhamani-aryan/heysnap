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
  machineServerImage: "example.com/ank1015-machine-server:test",
  machineServerVersion: "test-version",
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
      user: { id: owner.userId, email: "detail@example.com" },
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
    const { app, provisioner } = createTestApp();
    const owner = await registerUser(app, "deleteme@example.com");
    const first = await createComputer(app, owner.token, "VM A");
    const second = await createComputer(app, owner.token, "VM B");

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

describe("admin release management", () => {
  it("deletes a release manifest", async () => {
    const { app } = createTestApp();
    const created = await app.request("/admin/releases/desktop", {
      method: "POST",
      body: JSON.stringify({
        channel: "stable",
        platform: "darwin-arm64",
        version: "0.1.0",
        downloadUrl: "https://downloads.example.com/app.dmg",
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
    body: JSON.stringify({ email, password }),
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
