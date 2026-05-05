import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { buildRunInstancesRequest } from "../src/provisioning/aws-ec2-provisioner.js";
import { renderMachineUserData } from "../src/provisioning/user-data.js";
import type { ComputerRecord } from "../src/db/types.js";

describe("AWS EC2 provisioning", () => {
  it("builds the dev-8gb run-instances request shape", () => {
    const computer = createComputer();
    const userData = renderMachineUserData({
      cloudServerPublicUrl: "https://cloud.example.com",
      computer,
      bootstrapToken: "bootstrap-token",
      machineServerImage: "example.com/ank1015-machine-server:test",
      machineServerVersion: "test-version",
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

  it("renders user data with cloud server URL, computer id, and bootstrap token", () => {
    const computer = createComputer();
    const userData = renderMachineUserData({
      cloudServerPublicUrl: "https://cloud.example.com",
      computer,
      bootstrapToken: "bootstrap-token",
      machineServerImage: "example.com/ank1015-machine-server:test",
      machineServerVersion: "test-version",
    });

    expect(userData).toContain("CLOUD_SERVER_PUBLIC_URL=https://cloud.example.com");
    expect(userData).toContain(`ANK1015_COMPUTER_ID=${computer.id}`);
    expect(userData).toContain("ANK1015_MACHINE_BOOTSTRAP_TOKEN=bootstrap-token");
    expect(userData).toContain("MACHINE_SERVER_IMAGE=example.com/ank1015-machine-server:test");
    expect(userData).toContain("MACHINE_SERVER_VERSION=test-version");
    expect(userData).toContain("docker run --rm");
    expect(userData).toContain("ank1015-machine-heartbeat.service");
    expect(userData).toContain("/machines/register");
    expect(userData).not.toContain("bootstrap-placeholder");
  });
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
