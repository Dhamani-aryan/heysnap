import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { hashToken } from "../src/auth/tokens.js";
import type { CloudServerConfig } from "../src/config.js";
import type { MachineIdentityRecord } from "../src/db/types.js";
import type { GatewayHttpRequest, TunnelStatusRegistry } from "../src/gateway/tunnel.js";
import type { ComputerProvisioner } from "../src/provisioning/types.js";
import { createApp } from "../src/server.js";
import { InMemoryCloudStore } from "./in-memory-store.js";

const baseConfig: CloudServerConfig = {
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

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("feedback snapshots", () => {
  it("creates feedback, asks the machine to snapshot, and returns completed archive metadata", async () => {
    const { app, computer, machineToken, accessToken, store } = await createFeedbackFixture({
      tunnelRegistry: {
        isConnected: () => true,
        proxyHttpRequest: async (computerId, request) => {
          expect(computerId).toBe(computer.id);
          expect(request.path).toBe("/feedback/snapshot");
          const trigger = readTriggerBody(request);
          expect(trigger.comment).toBe("The terminal output got stuck");

          const archive = Buffer.from("PK feedback archive bytes", "utf8");
          const upload = await app.request(`/machines/feedback/${trigger.feedbackId}/archive`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${machineToken}`,
              "content-type": "application/zip",
              "x-heysnap-feedback-sha256": sha256(archive),
              "x-heysnap-feedback-file-count": "7",
              "x-heysnap-feedback-machine-context": Buffer.from(JSON.stringify({ version: "test" })).toString("base64"),
            },
            body: new Uint8Array(archive),
          });

          expect(upload.status).toBe(200);
          return {
            statusCode: 200,
            headers: { "content-type": "application/json" },
            body: Buffer.from(await upload.arrayBuffer()),
          };
        },
      },
    });

    const response = await app.request(`/gateway/computers/${computer.id}/feedback?accessToken=${accessToken}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        comment: "  The terminal output got stuck  ",
        threadId: "thread-123",
        cwd: "/workspace/app",
        clientContext: { surface: "workspace" },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      feedback: {
        status: "complete",
        comment: "The terminal output got stuck",
        threadId: "thread-123",
        cwd: "/workspace/app",
        archive: {
          available: true,
          bytes: 25,
          fileCount: 7,
        },
      },
    });

    const reports = await store.listFeedbackReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      status: "complete",
      archiveSha256: sha256(Buffer.from("PK feedback archive bytes", "utf8")),
      fileCount: 7,
    });
  });

  it("keeps the comment visible when the machine tunnel is disconnected", async () => {
    const { app, computer, accessToken, store } = await createFeedbackFixture({
      tunnelRegistry: { isConnected: () => false },
    });

    const response = await app.request(`/gateway/computers/${computer.id}/feedback?accessToken=${accessToken}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment: "Wish the preview auto-refreshed" }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      feedback: {
        status: "comment_only",
        comment: "Wish the preview auto-refreshed",
        archive: { available: false },
      },
    });

    const reports = await store.listFeedbackReports();
    expect(reports[0]?.errorMessage).toContain("HTTP proxy is unavailable");
  });

  it("rejects invalid machine archive uploads and marks oversized archives comment-only", async () => {
    const { app, computer, machineToken, store } = await createFeedbackFixture({
      config: { feedbackArchiveMaxBytes: 4 },
    });
    const report = await store.createFeedbackReport({
      userId: computer.ownerUserId,
      computerId: computer.id,
      comment: "Archive checks",
    });

    const missingToken = await app.request(`/machines/feedback/${report.id}/archive`, {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: new Uint8Array(Buffer.from("zip")),
    });
    expect(missingToken.status).toBe(401);

    const unknown = await app.request("/machines/feedback/00000000-0000-0000-0000-000000000000/archive", {
      method: "POST",
      headers: {
        authorization: `Bearer ${machineToken}`,
        "content-type": "application/zip",
      },
      body: new Uint8Array(Buffer.from("zip")),
    });
    expect(unknown.status).toBe(404);

    const otherComputer = await store.createComputer({
      ownerUserId: computer.ownerUserId,
      name: "Other VM",
      kind: "cloud",
      status: "online",
      providerMetadata: {},
      capabilities: [],
    });
    const otherIdentity = await store.createMachineIdentity({
      computerId: otherComputer.id,
      bootstrapTokenHash: "other-bootstrap",
    });
    const otherMachineToken = "other-machine-token";
    await store.activateMachineIdentity({
      identityId: otherIdentity.id,
      tokenHash: hashToken(otherMachineToken, baseConfig.sessionSecret),
      activatedAt: new Date(),
    });
    const wrongMachine = await app.request(`/machines/feedback/${report.id}/archive`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${otherMachineToken}`,
        "content-type": "application/zip",
      },
      body: new Uint8Array(Buffer.from("zip")),
    });
    expect(wrongMachine.status).toBe(403);

    const oversized = Buffer.from("12345");
    const oversizedResponse = await app.request(`/machines/feedback/${report.id}/archive`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${machineToken}`,
        "content-type": "application/zip",
        "content-length": String(oversized.byteLength),
      },
      body: new Uint8Array(oversized),
    });
    expect(oversizedResponse.status).toBe(413);
    expect(await store.getFeedbackReportById(report.id)).toMatchObject({
      status: "comment_only",
      errorMessage: "Feedback archive exceeded maximum upload size",
    });
  });

  it("lists admin feedback rows and downloads ZIP bytes", async () => {
    const archive = Buffer.from("PK downloadable archive", "utf8");
    const { app, computer, machineToken, store } = await createFeedbackFixture();
    const report = await store.createFeedbackReport({
      userId: computer.ownerUserId,
      computerId: computer.id,
      comment: "Download this",
      threadId: "thread-download",
      cwd: "/workspace/download",
    });

    const upload = await app.request(`/machines/feedback/${report.id}/archive`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${machineToken}`,
        "content-type": "application/zip",
        "x-heysnap-feedback-sha256": sha256(archive),
        "x-heysnap-feedback-file-count": "3",
      },
      body: new Uint8Array(archive),
    });
    expect(upload.status).toBe(200);

    const list = await app.request("/admin/feedback", { headers: adminHeaders() });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      feedback: [{
        username: "feedback",
        userEmail: "feedback@example.com",
        computerName: "Feedback VM",
        threadId: "thread-download",
        comment: "Download this",
        cwd: "/workspace/download",
        status: "complete",
        archive: { available: true, bytes: archive.byteLength, fileCount: 3 },
      }],
    });

    const download = await app.request(`/admin/feedback/${report.id}/download`, { headers: adminHeaders() });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toContain("application/zip");
    expect(download.headers.get("content-disposition")).toContain(`feedback-${report.id}.zip`);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(archive);
  });
});

const createFeedbackFixture = async (options: {
  readonly tunnelRegistry?: TunnelStatusRegistry;
  readonly config?: Partial<CloudServerConfig>;
} = {}) => {
  const storageDir = await mkdtemp(join(tmpdir(), "heysnap-feedback-test-"));
  tempDirs.push(storageDir);

  const config = {
    ...baseConfig,
    feedbackArchiveLocalDir: storageDir,
    ...options.config,
  };
  const store = new InMemoryCloudStore();
  const user = await store.createUser({
    email: "feedback@example.com",
    username: "feedback",
    passwordHash: "hash",
  });
  const computer = await store.createComputer({
    ownerUserId: user.id,
    name: "Feedback VM",
    kind: "cloud",
    status: "online",
    providerMetadata: {},
    capabilities: [],
  });
  const accessToken = "access-token";
  await store.createComputerAccessSession({
    userId: user.id,
    computerId: computer.id,
    tokenHash: hashToken(accessToken, config.sessionSecret),
    expiresAt: new Date(Date.now() + 60_000),
  });
  const machineToken = "machine-token";
  const machine = await store.createMachineIdentity({
    computerId: computer.id,
    bootstrapTokenHash: "bootstrap",
  });
  await store.activateMachineIdentity({
    identityId: machine.id,
    tokenHash: hashToken(machineToken, config.sessionSecret),
    activatedAt: new Date(),
  });
  const app = createApp({
    store,
    config,
    provisioner: fakeProvisioner,
    tunnelRegistry: options.tunnelRegistry,
  });

  return {
    app,
    computer,
    machine: (await store.getMachineIdentityByTokenHash(hashToken(machineToken, config.sessionSecret))) as MachineIdentityRecord,
    machineToken,
    accessToken,
    store,
  };
};

const readTriggerBody = (request: GatewayHttpRequest): Record<string, string> => {
  expect(request.body).toBeDefined();
  return JSON.parse(request.body?.toString("utf8") ?? "{}") as Record<string, string>;
};

const sha256 = (body: Buffer): string => createHash("sha256").update(body).digest("hex");

const adminHeaders = () => ({
  authorization: `Bearer ${baseConfig.adminToken}`,
});

const fakeProvisioner: ComputerProvisioner = {
  provisionComputer: async () => ({
    providerMetadata: {},
  }),
  startComputer: async () => ({}),
  stopComputer: async () => ({}),
  restartComputer: async () => ({}),
  terminateComputer: async () => ({}),
};
