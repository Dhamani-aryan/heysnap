import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import type { CloudServerConfig } from "../src/config.js";
import { buildRunInstancesRequest } from "../src/provisioning/aws-ec2-provisioner.js";
import { getDev8gbPreset } from "../src/provisioning/presets.js";
import { renderMachineUserData } from "../src/provisioning/user-data.js";
import type { ComputerRecord } from "../src/db/types.js";

describe("AWS EC2 provisioning", () => {
  it("builds the dev-8gb run-instances request shape", () => {
    const computer = createComputer();
    const userData = renderMachineUserData({
      cloudServerPublicUrl: "https://cloud.example.com",
      computer,
      bootstrapToken: "bootstrap-token",
      machineServerVersion: "test-version",
      codexDefaultModel: "gpt-5.5",
    });
    const request = buildRunInstancesRequest({
      computer,
      imageId: "ami-123",
      instanceType: "t3.large",
      rootVolumeGb: 80,
      userData,
      machineInstanceProfileName: "ank1015-machine-profile",
    });

    expect(request).toMatchObject({
      ImageId: "ami-123",
      InstanceType: "t3.large",
      IamInstanceProfile: { Name: "ank1015-machine-profile" },
      MinCount: 1,
      MaxCount: 1,
      BlockDeviceMappings: [
        {
          DeviceName: "/dev/sda1",
          Ebs: {
            VolumeType: "gp3",
            VolumeSize: 80,
            DeleteOnTermination: false,
            Encrypted: true,
          },
        },
      ],
    });
    expect(Buffer.from(request.UserData ?? "", "base64").toString("utf8")).toContain("bootstrap-token");
    expect(request.TagSpecifications).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ResourceType: "instance",
        Tags: expect.arrayContaining([
          { Key: "ank1015:computer-id", Value: computer.id },
        ]),
      }),
    ]));
  });

  it("resolves the machine AMI from the configured SSM parameter", () => {
    expect(getDev8gbPreset(createConfig()).amiSsmParameterName)
      .toBe("/ank1015/machine-images/test/ami-id");
  });

  it("renders user data with cloud server URL, computer id, and bootstrap token", () => {
    const computer = createComputer();
    const userData = renderMachineUserData({
      cloudServerPublicUrl: "https://cloud.example.com",
      computer,
      bootstrapToken: "bootstrap-token",
      machineServerVersion: "test-version",
      codexDefaultModel: "gpt-5.5",
    });

    expect(userData).toContain("CLOUD_SERVER_PUBLIC_URL=https://cloud.example.com");
    expect(userData).toContain(`ANK1015_COMPUTER_ID=${computer.id}`);
    expect(userData).toContain("cat >/opt/ank1015/bootstrap-token");
    expect(userData).toContain("bootstrap-token");
    expect(userData).toContain("MACHINE_SERVER_VERSION=test-version");
    expect(userData).toContain("MACHINE_SERVER_CHANNEL=stable");
    expect(userData).toContain("http://127.0.0.1:$PORT/status");
    expect(userData).toContain("install_update_if_idle");
    expect(userData).toContain("install-machine-server-release.sh update");
    expect(userData).toContain("downloadUrl");
    expect(userData).toContain("metadata.sha256");
    expect(userData).toContain("ExecStart=/usr/bin/node /opt/ank1015/machine-server/current/dist/index.js");
    expect(userData).toContain("User=agent");
    expect(userData).toContain("set -a\nsource /opt/ank1015/machine.env\nset +a");
    expect(userData).toContain("cat >/home/agent/.codex/config.toml");
    expect(userData).toContain('model = "gpt-5.5"');
    expect(userData).toContain('base_url = "https://cloud.example.com/llm/openai/v1"');
    expect(userData).toContain('"api-key" = "ANK1015_CODEX_GATEWAY_TOKEN"');
    expect(userData).not.toContain("AZURE_OPENAI_API_KEY");
    expect(userData).not.toContain("docker run --rm");
    expect(userData).toContain("ank1015-machine-heartbeat.service");
    expect(userData).toContain("/machines/register");
    expect(userData).not.toContain("bootstrap-placeholder");
  });
});

const createConfig = (): CloudServerConfig => ({
  port: 4100,
  databaseUrl: "postgres://test",
  sessionSecret: "test-session-secret",
  sessionTtlSeconds: 60 * 60,
  computerAccessSessionTtlSeconds: 60,
  cloudServerPublicUrl: "https://cloud.example.com",
  awsRegion: "ap-south-1",
  awsEc2InstanceType: "t3.large",
  awsEc2RootVolumeGb: 80,
  awsMachineAmiSsmParameter: "/ank1015/machine-images/test/ami-id",
  awsMachineInstanceProfileName: "ank1015-machine-profile",
  machineServerVersion: "test-version",
  allowedOrigins: ["https://app.example.com"],
  adminToken: "test-admin-token",
});

const createComputer = (): ComputerRecord => ({
  id: "computer-123",
  ownerUserId: "user-123",
  name: "Dev VM",
  kind: "cloud",
  status: "creating",
  providerMetadata: {},
  capabilities: [],
  machineServerVersion: null,
  lastHeartbeatAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});
