import { describe, expect, it } from "vitest";

import type { CloudServerConfig } from "../src/config.js";
import { hashToken } from "../src/auth/tokens.js";
import { createApp } from "../src/server.js";
import type { ComputerProvisioner } from "../src/provisioning/types.js";
import type { ComputerRecord } from "../src/db/types.js";
import type { TunnelStatusRegistry } from "../src/gateway/tunnel.js";
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

  it("allows agent event stream resume headers from the web app", async () => {
    const { app } = createTestApp();
    const preflight = await app.request("/gateway/computers/computer-1/agent/runs/run-1/events", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "GET",
        "access-control-request-headers": "last-event-id",
      },
    });

    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Last-Event-ID");
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
    expect(created.user.username).toBe("user");

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
      body: JSON.stringify({ email: "USER@example.com", username: "user-duplicate", password: "password123" }),
      headers: adminHeaders(),
    });

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      error: { code: "EMAIL_ALREADY_REGISTERED" },
    });
  });

  it("requires unique usernames for admin-created users", async () => {
    const { app } = createTestApp();
    await createUserAsAdmin(app, "first@example.com");

    const missing = await app.request("/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: "missing@example.com", password: "password123" }),
      headers: adminHeaders(),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: { code: "INVALID_BODY" },
    });

    const duplicate = await app.request("/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: "second@example.com", username: "first", password: "password123" }),
      headers: adminHeaders(),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      error: { code: "USERNAME_ALREADY_REGISTERED" },
    });
  });

  it("rejects invalid admin-created email addresses", async () => {
    const { app } = createTestApp();

    const response = await app.request("/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: "not-an-email", username: "bad-email", password: "password123" }),
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

  it("redirects /admin-dashboard to the trailing-slash app shell", async () => {
    const { app } = createTestApp();
    const response = await app.request("/admin-dashboard");

    expect([302, 307]).toContain(response.status);
    expect(response.headers.get("location")).toBe("/admin-dashboard/");
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
        downloadUrl: "https://downloads.example.com/machine-server-1.0.0-linux-x64.tar.gz",
        metadata: { sha256: "abc123" },
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

  it("allows only one cloud computer per user", async () => {
    const { app } = createTestApp();
    const auth = await registerUser(app, "limit@example.com");

    const first = await app.request("/computers", {
      method: "POST",
      body: JSON.stringify({ name: "First VM" }),
      headers: authHeaders(auth.token),
    });
    expect(first.status).toBe(201);

    const second = await app.request("/computers", {
      method: "POST",
      body: JSON.stringify({ name: "Second VM" }),
      headers: authHeaders(auth.token),
    });

    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      error: { code: "CLOUD_MACHINE_LIMIT_REACHED" },
    });
  });

  it("exposes live tunnel state on user computer payloads", async () => {
    const connectedComputerIds = new Set<string>();
    const tunnelRegistry: TunnelStatusRegistry = {
      isConnected: (computerId) => connectedComputerIds.has(computerId),
    };
    const { app } = createTestApp({ tunnelRegistry });
    const auth = await registerUser(app, "tunnel-user@example.com");
    const computer = await createComputer(app, auth.token, "Tunnel VM");

    expect(computer.tunnelConnected).toBe(false);

    connectedComputerIds.add(computer.id);

    const listed = await app.request("/computers", {
      headers: authHeaders(auth.token),
    });
    expect(await listed.json()).toMatchObject({
      computers: [{ id: computer.id, tunnelConnected: true }],
    });

    const read = await app.request(`/computers/${computer.id}`, {
      headers: authHeaders(auth.token),
    });
    expect(await read.json()).toMatchObject({
      computer: { id: computer.id, tunnelConnected: true },
    });
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
      filesystemPreviewBaseUrl: `/gateway/computers/${computer.id}/preview`,
      filesystemPreviewWebSocketUrl: `/gateway/computers/${computer.id}/preview/ws`,
      browserControlWebSocketUrl: `/gateway/computers/${computer.id}/browser-control`,
      agentBaseUrl: `/gateway/computers/${computer.id}/agent`,
      capabilitiesBaseUrl: `/gateway/computers/${computer.id}/capabilities`,
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

  it("proxies filesystem downloads through authenticated gateway access sessions", async () => {
    const requestedPaths: string[] = [];
    const tunnelRegistry: TunnelStatusRegistry = {
      isConnected: () => true,
      proxyHttpRequest: async (_computerId, input) => {
        requestedPaths.push(input.path);
        return {
          statusCode: 200,
          headers: {
            "content-type": "application/zip",
            "content-disposition": "attachment; filename=\"Project.zip\"",
          },
          body: Buffer.from("zip-bytes", "utf8"),
        };
      },
    };
    const { app } = createTestApp({ tunnelRegistry });
    const auth = await registerUser(app, "download-user@example.com");
    const computer = await createComputer(app, auth.token, "Download VM");
    const accessResponse = await app.request(`/computers/${computer.id}/access-session`, {
      method: "POST",
      headers: authHeaders(auth.token),
    });
    const accessBody = await accessResponse.json() as AccessSessionResponse;

    const response = await app.request(
      `/gateway/computers/${computer.id}/filesystem/download?accessToken=${accessBody.accessSession.token}&path=Project`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe("attachment; filename=\"Project.zip\"");
    expect(await response.text()).toBe("zip-bytes");
    expect(requestedPaths).toEqual(["/filesystem/download?path=Project"]);
  });

  it("proxies standalone preview assets through authenticated gateway access sessions", async () => {
    const requestedPaths: string[] = [];
    const requestedHeaders: Array<Record<string, string> | undefined> = [];
    const tunnelRegistry: TunnelStatusRegistry = {
      isConnected: () => true,
      proxyHttpRequest: async (_computerId, input) => {
        requestedPaths.push(input.path);
        requestedHeaders.push(input.headers);
        return {
          statusCode: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          },
          body: Buffer.from("<!doctype html><title>Preview</title>", "utf8"),
        };
      },
    };
    const { app } = createTestApp({ tunnelRegistry });
    const auth = await registerUser(app, "standalone-preview-user@example.com");
    const computer = await createComputer(app, auth.token, "Standalone Preview VM");
    const accessResponse = await app.request(`/computers/${computer.id}/access-session`, {
      method: "POST",
      headers: authHeaders(auth.token),
    });
    const accessBody = await accessResponse.json() as AccessSessionResponse;

    const indexResponse = await app.request(
      `/gateway/computers/${computer.id}/preview?accessToken=${accessBody.accessSession.token}&path=Budget.xlsx`,
    );
    const cookie = indexResponse.headers.get("set-cookie")?.split(";")[0];

    expect(indexResponse.status).toBe(200);
    expect(cookie).toBe(`heysnap_preview_access=${encodeURIComponent(accessBody.accessSession.token)}`);
    expect(indexResponse.headers.get("set-cookie")).toContain(`Path=/gateway/computers/${computer.id}/preview`);

    const assetResponse = await app.request(
      `/gateway/computers/${computer.id}/preview/assets/app.js?path=Budget.xlsx`,
      { headers: { cookie: cookie ?? "" } },
    );

    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(assetResponse.headers.get("cache-control")).toBe("no-store");
    expect(await assetResponse.text()).toBe("<!doctype html><title>Preview</title>");
    expect(requestedPaths).toEqual([
      "/preview?path=Budget.xlsx",
      "/preview/assets/app.js?path=Budget.xlsx",
    ]);
    expect(requestedHeaders).toEqual([
      { "x-heysnap-preview-public-base-path": `/gateway/computers/${computer.id}/preview` },
      { "x-heysnap-preview-public-base-path": `/gateway/computers/${computer.id}/preview` },
    ]);
  });

  it("proxies agent REST and SSE through authenticated gateway access sessions", async () => {
    const requested: Array<{ readonly path: string; readonly method?: string; readonly body?: string }> = [];
    const tunnelRegistry: TunnelStatusRegistry = {
      isConnected: () => true,
      proxyStreamingHttpRequest: async (_computerId, input) => {
        requested.push({
          path: input.path,
          method: input.method,
          body: input.body?.toString("utf8"),
        });
        return {
          statusCode: 200,
          headers: { "content-type": "text/event-stream" },
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("event: run_end\n"));
              controller.enqueue(new TextEncoder().encode("data: {\"runId\":\"run-1\"}\n\n"));
              controller.close();
            },
          }),
          cancel() {},
        };
      },
    };
    const { app } = createTestApp({ tunnelRegistry });
    const auth = await registerUser(app, "agent-proxy-user@example.com");
    const computer = await createComputer(app, auth.token, "Agent VM");
    const accessResponse = await app.request(`/computers/${computer.id}/access-session`, {
      method: "POST",
      headers: authHeaders(auth.token),
    });
    const accessBody = await accessResponse.json() as AccessSessionResponse;

    const response = await app.request(
      `/gateway/computers/${computer.id}/agent/runs?accessToken=${accessBody.accessSession.token}`,
      {
        method: "POST",
        body: JSON.stringify({ path: "Projects", content: [{ type: "text", content: "Go" }] }),
        headers: { "content-type": "application/json" },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe("event: run_end\ndata: {\"runId\":\"run-1\"}\n\n");
    expect(requested).toEqual([{
      path: "/agent/runs",
      method: "POST",
      body: JSON.stringify({ path: "Projects", content: [{ type: "text", content: "Go" }] }),
    }]);
  });

  it("proxies capabilities REST through authenticated gateway access sessions", async () => {
    const requested: Array<{
      readonly path: string;
      readonly method?: string;
      readonly body?: string;
      readonly contentType?: string;
    }> = [];
    const tunnelRegistry: TunnelStatusRegistry = {
      isConnected: () => true,
      proxyHttpRequest: async (_computerId, input) => {
        requested.push({
          path: input.path,
          method: input.method,
          body: input.body?.toString("utf8"),
          contentType: input.headers?.["content-type"],
        });
        return {
          statusCode: 202,
          headers: { "content-type": "application/json" },
          body: Buffer.from(JSON.stringify({
            operation: {
              id: "operation-1",
              operation: "installTool",
              targetId: "github",
              status: "running",
              messages: [],
              createdAt: "2026-05-11T00:00:00.000Z",
              updatedAt: "2026-05-11T00:00:00.000Z",
            },
          }), "utf8"),
        };
      },
    };
    const { app } = createTestApp({ tunnelRegistry });
    const auth = await registerUser(app, "capabilities-proxy-user@example.com");
    const computer = await createComputer(app, auth.token, "Capabilities VM");
    const accessResponse = await app.request(`/computers/${computer.id}/access-session`, {
      method: "POST",
      headers: authHeaders(auth.token),
    });
    const accessBody = await accessResponse.json() as AccessSessionResponse;

    const response = await app.request(
      `/gateway/computers/${computer.id}/capabilities/tools/github/install?accessToken=${accessBody.accessSession.token}`,
      {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toMatchObject({
      operation: {
        id: "operation-1",
        operation: "installTool",
      },
    });
    expect(requested).toEqual([{
      path: "/capabilities/tools/github/install",
      method: "POST",
      body: JSON.stringify({}),
      contentType: "application/json",
    }]);
  });

  it("rejects filesystem downloads without gateway access tokens", async () => {
    const { app } = createTestApp({
      tunnelRegistry: {
        isConnected: () => true,
        proxyHttpRequest: async () => {
          throw new Error("should not proxy unauthenticated downloads");
        },
      },
    });
    const auth = await registerUser(app, "download-no-token@example.com");
    const computer = await createComputer(app, auth.token, "Download VM");

    const response = await app.request(`/gateway/computers/${computer.id}/filesystem/download?path=Project`);

    expect(response.status).toBe(401);
  });

  it("rejects capabilities REST without gateway access tokens", async () => {
    const { app } = createTestApp({
      tunnelRegistry: {
        isConnected: () => true,
        proxyHttpRequest: async () => {
          throw new Error("should not proxy unauthenticated capabilities requests");
        },
      },
    });
    const auth = await registerUser(app, "capabilities-no-token@example.com");
    const computer = await createComputer(app, auth.token, "Capabilities VM");

    const response = await app.request(`/gateway/computers/${computer.id}/capabilities`);

    expect(response.status).toBe(401);
  });

  it("returns tunnel unavailable for capabilities REST when the tunnel is disconnected", async () => {
    const { app } = createTestApp({
      tunnelRegistry: {
        isConnected: () => false,
        proxyHttpRequest: async () => null,
      },
    });
    const auth = await registerUser(app, "capabilities-tunnel-missing@example.com");
    const computer = await createComputer(app, auth.token, "Capabilities VM");
    const accessResponse = await app.request(`/computers/${computer.id}/access-session`, {
      method: "POST",
      headers: authHeaders(auth.token),
    });
    const accessBody = await accessResponse.json() as AccessSessionResponse;

    const response = await app.request(
      `/gateway/computers/${computer.id}/capabilities?accessToken=${accessBody.accessSession.token}`,
    );

    expect(response.status).toBe(503);
  });
});

describe("cloud server release manifests", () => {
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
        downloadUrl: "https://downloads.example.com/machine-server-1.1.0-linux-x64.tar.gz",
        metadata: {
          sha256: "abc123",
        },
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
          downloadUrl: "https://downloads.example.com/machine-server-1.1.0-linux-x64.tar.gz",
          metadata: {
            sha256: "abc123",
          },
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
        bootstrapVersion: "0.1.0",
        capabilities: ["filesystem", "agent"],
      }),
      headers: { "content-type": "application/json" },
    });

    expect(registration.status).toBe(201);
    const registered = await registration.json() as {
      readonly machine: { readonly token: string };
      readonly computer: {
        readonly status: string;
        readonly machineServerVersion: string;
        readonly machineHealth: unknown;
      };
    };
    expect(registered.computer).toMatchObject({
      status: "online",
      machineServerVersion: "0.1.0",
      machineHealth: {
        machineServerVersion: "0.1.0",
        bootstrapVersion: "0.1.0",
      },
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
        bootstrapVersion: "0.1.0",
        safeToRestart: true,
        activeSessions: 0,
        updateState: "checking",
        lastUpdateError: null,
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
        machineHealth: {
          machineServerVersion: "0.1.1",
          bootstrapVersion: "0.1.0",
          safeToRestart: true,
          activeSessions: 0,
          updateState: "checking",
          lastUpdateError: null,
        },
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

  it("auto-sleeps idle cloud machines after the configured idle timeout", async () => {
    const { app, provisioner } = createTestApp({
      config: { machineIdleSleepSeconds: 1 },
    });
    const auth = await registerUser(app, "idle-user@example.com");
    const computer = await createComputer(app, auth.token, "Idle VM");
    const bootstrapToken = provisioner.bootstrapTokens.get(computer.id);
    const registration = await app.request("/machines/register", {
      method: "POST",
      body: JSON.stringify({ computerId: computer.id, bootstrapToken }),
      headers: { "content-type": "application/json" },
    });
    const registered = await registration.json() as {
      readonly machine: { readonly token: string };
    };
    const lastActivityAt = new Date(Date.now() - 2_000).toISOString();

    const heartbeat = await app.request("/machines/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        status: "idle",
        safeToRestart: false,
        safeToSleep: true,
        lastActivityAt,
        activeSessions: { filesystem: 1, agent: 0, total: 1 },
      }),
      headers: {
        authorization: `Bearer ${registered.machine.token}`,
        "content-type": "application/json",
      },
    });

    expect(heartbeat.status).toBe(200);
    expect(provisioner.actions).toEqual(["provision", "stop"]);
    expect(await heartbeat.json()).toMatchObject({
      computer: {
        status: "sleeping",
        machineHealth: {
          safeToSleep: true,
          lastActivityAt,
          autoSleep: {
            status: "requested",
            reason: "idle_timeout",
            thresholdSeconds: 1,
          },
        },
      },
    });
  });

  it("keeps active machine heartbeats awake even after the idle timeout", async () => {
    const { app, provisioner } = createTestApp({
      config: { machineIdleSleepSeconds: 1 },
    });
    const auth = await registerUser(app, "active-user@example.com");
    const computer = await createComputer(app, auth.token, "Active VM");
    const bootstrapToken = provisioner.bootstrapTokens.get(computer.id);
    const registration = await app.request("/machines/register", {
      method: "POST",
      body: JSON.stringify({ computerId: computer.id, bootstrapToken }),
      headers: { "content-type": "application/json" },
    });
    const registered = await registration.json() as {
      readonly machine: { readonly token: string };
    };

    const heartbeat = await app.request("/machines/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        status: "online",
        safeToSleep: false,
        lastActivityAt: new Date(Date.now() - 2_000).toISOString(),
        activeSessions: { agent: 1, total: 1 },
      }),
      headers: {
        authorization: `Bearer ${registered.machine.token}`,
        "content-type": "application/json",
      },
    });

    expect(heartbeat.status).toBe(200);
    expect(provisioner.actions).toEqual(["provision"]);
    expect(await heartbeat.json()).toMatchObject({
      computer: {
        status: "online",
        machineHealth: {
          safeToSleep: false,
        },
      },
    });
  });
});

const createTestApp = (options: {
  readonly config?: Partial<CloudServerConfig>;
  readonly tunnelRegistry?: TunnelStatusRegistry;
} = {}) => {
  const store = new InMemoryCloudStore();
  const provisioner = new FakeProvisioner();
  const app = createApp({
    config: { ...config, ...options.config },
    store,
    provisioner,
    tunnelRegistry: options.tunnelRegistry,
  });

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
    body: JSON.stringify({ email, username: usernameFromEmail(email), password }),
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
    readonly username: string;
  };
  readonly session: {
    readonly token: string;
    readonly expiresAt: string;
  };
}

const usernameFromEmail = (email: string): string => email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9_-]/g, "-");

interface ComputerResponse {
  readonly computer: {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
    readonly status: string;
    readonly providerMetadata: unknown;
    readonly capabilities: unknown;
    readonly machineServerVersion: string | null;
    readonly tunnelConnected: boolean;
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
    readonly filesystemPreviewBaseUrl: string;
    readonly filesystemPreviewWebSocketUrl: string;
    readonly browserControlWebSocketUrl: string;
    readonly agentBaseUrl: string;
    readonly capabilitiesBaseUrl: string;
  };
}

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
