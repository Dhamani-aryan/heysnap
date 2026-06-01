import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { hashToken } from "../src/auth/tokens.js";
import type { CloudServerConfig } from "../src/config.js";
import type { ComputerRecord, MachineIdentityRecord, UserRecord } from "../src/db/types.js";
import { InMemoryAgentSessionObjectStorage } from "../src/agent-sessions/storage.js";
import { createApp } from "../src/server.js";
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
  agentSessionStoragePrefix: "agent-sessions/",
  agentSessionMaxFileBytes: 1024 * 1024,
};

describe("agent session sync", () => {
  it("rejects unauthenticated machine sync requests", async () => {
    const { app } = await createTestApp();
    const response = await app.request("/machines/agent-sessions/sync-plan", {
      method: "POST",
      body: JSON.stringify({ files: [] }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(401);
  });

  it("plans missing uploads, writes immutable objects, and indexes versions", async () => {
    const { app, store, storage, machineToken, user, computer } = await createTestApp();
    const raw = `${JSON.stringify({
      type: "session_meta",
      payload: { id: "thread-1", timestamp: "2026-06-01T00:00:00.000Z" },
    })}\n{"hello":"world"}\n`;
    const digest = sha256(raw);

    const plan = await app.request("/machines/agent-sessions/sync-plan", {
      method: "POST",
      body: JSON.stringify({
        files: [{
          harness: "codex",
          nativeThreadId: "thread-1",
          threadId: "thread-1",
          sha256: digest,
        }],
      }),
      headers: machineJsonHeaders(machineToken),
    });

    expect(plan.status).toBe(200);
    expect(await plan.json()).toMatchObject({
      uploadCount: 1,
      uploads: [{ harness: "codex", nativeThreadId: "thread-1", sha256: digest }],
    });

    const upload = await uploadSession(app, machineToken, {
      harness: "codex",
      nativeThreadId: "thread-1",
      threadId: "thread-1",
      relativePath: "2026/06/01/session.jsonl",
      sourcePath: "/home/agent/.codex/sessions/2026/06/01/session.jsonl",
      sha256: digest,
      raw,
    });

    expect(upload.status).toBe(201);
    const rows = await store.listAgentSessionThreads();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      computerId: computer.id,
      harness: "codex",
      nativeThreadId: "thread-1",
      threadId: "thread-1",
      latestSha256: digest,
    });
    expect(storage.objects.get(rows[0]!.latestObjectKey ?? "")?.toString()).toBe(raw);

    const repeatedPlan = await app.request("/machines/agent-sessions/sync-plan", {
      method: "POST",
      body: JSON.stringify({
        files: [{
          harness: "codex",
          nativeThreadId: "thread-1",
          threadId: "thread-1",
          sha256: digest,
        }],
      }),
      headers: machineJsonHeaders(machineToken),
    });

    expect(await repeatedPlan.json()).toMatchObject({
      uploadCount: 0,
      uploads: [],
    });
  });

  it("rejects uploads whose body sha does not match metadata", async () => {
    const { app, store, storage, machineToken } = await createTestApp();
    const response = await uploadSession(app, machineToken, {
      harness: "pi",
      nativeThreadId: "pi-thread",
      threadId: "pi:pi-thread",
      relativePath: "pi-thread.jsonl",
      sourcePath: "/home/agent/.pi/agent/sessions/pi-thread.jsonl",
      sha256: sha256("different"),
      raw: `${JSON.stringify({ type: "session", id: "pi-thread" })}\n`,
    });

    expect(response.status).toBe(400);
    expect(await store.listAgentSessionThreads()).toHaveLength(0);
    expect(storage.objects.size).toBe(0);
  });

  it("exposes admin session list, versions, and raw JSONL download", async () => {
    const { app, machineToken, user, computer } = await createTestApp();
    const raw = `${JSON.stringify({ type: "session", id: "pi-thread" })}\n{"type":"message"}\n`;
    const digest = sha256(raw);
    const upload = await uploadSession(app, machineToken, {
      harness: "pi",
      nativeThreadId: "pi-thread",
      threadId: "pi:pi-thread",
      relativePath: "pi-thread.jsonl",
      sourcePath: "/home/agent/.pi/agent/sessions/pi-thread.jsonl",
      sha256: digest,
      raw,
    });
    expect(upload.status).toBe(201);

    const list = await app.request("/admin/agent-sessions", {
      headers: adminHeaders(),
    });
    expect(list.status).toBe(200);
    const listBody = await list.json() as {
      readonly sessions: ReadonlyArray<{ readonly id: string; readonly username: string; readonly computerName: string }>;
    };
    expect(listBody.sessions).toHaveLength(1);
    expect(listBody.sessions[0]).toMatchObject({
      username: user.username,
      computerName: computer.name,
    });

    const sessionId = listBody.sessions[0]!.id;
    const versions = await app.request(`/admin/agent-sessions/${sessionId}/versions`, {
      headers: adminHeaders(),
    });
    expect(versions.status).toBe(200);
    expect(await versions.json()).toMatchObject({
      versions: [{ sha256: digest, sizeBytes: Buffer.byteLength(raw) }],
    });

    const rawDownload = await app.request(`/admin/agent-sessions/${sessionId}/raw`, {
      headers: adminHeaders(),
    });
    expect(rawDownload.status).toBe(200);
    expect(await rawDownload.text()).toBe(raw);
  });
});

const createTestApp = async (): Promise<{
  readonly app: ReturnType<typeof createApp>;
  readonly store: InMemoryCloudStore;
  readonly storage: InMemoryAgentSessionObjectStorage;
  readonly user: UserRecord;
  readonly computer: ComputerRecord;
  readonly identity: MachineIdentityRecord;
  readonly machineToken: string;
}> => {
  const store = new InMemoryCloudStore();
  const storage = new InMemoryAgentSessionObjectStorage();
  const app = createApp({ config, store, agentSessionStorage: storage });
  const user = await store.createUser({
    email: "owner@example.com",
    username: "owner",
    passwordHash: "hash",
  });
  const computer = await store.createComputer({
    ownerUserId: user.id,
    name: "Owner VM",
    kind: "cloud",
    status: "online",
    providerMetadata: {},
    capabilities: [],
  });
  const identity = await store.createMachineIdentity({
    computerId: computer.id,
    bootstrapTokenHash: "bootstrap-hash",
  });
  const machineToken = "machine-token";
  const activated = await store.activateMachineIdentity({
    identityId: identity.id,
    tokenHash: hashToken(machineToken, config.sessionSecret),
    activatedAt: new Date(),
  });

  if (activated === null) {
    throw new Error("Failed to activate machine identity");
  }

  return { app, store, storage, user, computer, identity: activated, machineToken };
};

const uploadSession = (
  app: ReturnType<typeof createApp>,
  machineToken: string,
  input: {
    readonly harness: "codex" | "pi";
    readonly nativeThreadId: string;
    readonly threadId: string;
    readonly relativePath: string;
    readonly sourcePath: string;
    readonly sha256: string;
    readonly raw: string;
  },
): Promise<Response> => {
  const params = new URLSearchParams({
    harness: input.harness,
    nativeThreadId: input.nativeThreadId,
    threadId: input.threadId,
    relativePath: input.relativePath,
    sourcePath: input.sourcePath,
    sha256: input.sha256,
    sizeBytes: String(Buffer.byteLength(input.raw)),
    sourceMtime: "2026-06-01T00:00:02.000Z",
    sourceCreatedAt: "2026-06-01T00:00:00.000Z",
    sourceUpdatedAt: "2026-06-01T00:00:02.000Z",
  });

  return app.request(`/machines/agent-sessions/objects?${params.toString()}`, {
    method: "PUT",
    body: input.raw,
    headers: {
      authorization: `Bearer ${machineToken}`,
      "content-type": "application/x-ndjson",
      "content-length": String(Buffer.byteLength(input.raw)),
    },
  });
};

const machineJsonHeaders = (machineToken: string) => ({
  authorization: `Bearer ${machineToken}`,
  "content-type": "application/json",
});

const adminHeaders = () => ({
  authorization: `Bearer ${config.adminToken}`,
});

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
