import { describe, expect, it } from "vitest";

import type { CloudServerConfig } from "../src/config.js";
import type { ComputerProvisioner } from "../src/provisioning/types.js";
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
};

describe("removed feedback routes", () => {
  it("returns 404 for old gateway, machine, and admin feedback APIs", async () => {
    const app = createApp({
      store: new InMemoryCloudStore(),
      config,
      provisioner: fakeProvisioner,
    });

    const gateway = await app.request("/gateway/computers/computer-1/feedback?accessToken=token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment: "old route" }),
    });
    expect(gateway.status).toBe(404);

    const machineUpload = await app.request("/machines/feedback/feedback-1/archive", {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: new Uint8Array(),
    });
    expect(machineUpload.status).toBe(404);

    const adminList = await app.request("/admin/feedback", { headers: adminHeaders() });
    expect(adminList.status).toBe(404);

    const adminDownload = await app.request("/admin/feedback/feedback-1/download", { headers: adminHeaders() });
    expect(adminDownload.status).toBe(404);
  });
});

const adminHeaders = () => ({
  authorization: `Bearer ${config.adminToken}`,
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
