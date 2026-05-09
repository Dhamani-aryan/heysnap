import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import type { CloudServerConfig } from "../src/config.js";
import { AwsEc2Provisioner, buildRunInstancesRequest } from "../src/provisioning/aws-ec2-provisioner.js";
import { createComputerProvisioner } from "../src/provisioning/factory.js";
import { DockerMachineProvisioner } from "../src/provisioning/docker-provisioner.js";
import { getDev8gbPreset } from "../src/provisioning/presets.js";
import { renderMachineUserData } from "../src/provisioning/user-data.js";
import type { ComputerRecord } from "../src/db/types.js";
import type { CommandExecutor } from "../src/provisioning/types.js";

describe("AWS EC2 provisioning", () => {
  it("builds the dev-8gb run-instances request shape", () => {
    const computer = createComputer();
    const userData = renderMachineUserData({
      cloudServerPublicUrl: "https://cloud.example.com",
      computer,
      bootstrapToken: "bootstrap-token",
      machineServerChannel: "stable",
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
      machineServerChannel: "stable",
    });

    expect(userData).toContain("CLOUD_SERVER_PUBLIC_URL=https://cloud.example.com");
    expect(userData).toContain(`ANK1015_COMPUTER_ID=${computer.id}`);
    expect(userData).toContain("cat >/opt/ank1015/bootstrap-token");
    expect(userData).toContain("bootstrap-token");
    expect(userData).toContain("MACHINE_SERVER_CHANNEL=stable");
    expect(userData).toContain("exec /usr/local/bin/ank1015-machine-bootstrap");
    expect(userData).toContain("PATH=/opt/ank1015/agent-tools/bin:/opt/ank1015/venvs/default/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
    expect(userData).toContain("ANK1015_MACHINE_TOKEN_FILE=/opt/ank1015/machine-token");
    expect(userData).toContain("ANK1015_ACTIVE_SKILLS_DIR=/home/agent/.codex/skills");
    expect(userData).not.toContain("MACHINE_SERVER_VERSION=");
    expect(userData).not.toContain("http://127.0.0.1:$PORT/status");
    expect(userData).not.toContain("install_update_if_idle");
    expect(userData).not.toContain("install-machine-server-release.sh update");
    expect(userData).not.toContain("downloadUrl");
    expect(userData).not.toContain("metadata.sha256");
    expect(userData).not.toContain("ExecStart=/usr/bin/node /opt/ank1015/machine-server/current/dist/index.js");
    expect(userData).not.toContain("User=agent");
    expect(userData).not.toContain("set -a\nsource /opt/ank1015/machine.env\nset +a");
    expect(userData).not.toContain("cat >/home/agent/.codex/config.toml");
    expect(userData).not.toContain('model_provider = "azure"');
    expect(userData).not.toContain('base_url = "https://cloud.example.com/llm/openai/v1"');
    expect(userData).not.toContain('"api-key" = "ANK1015_CODEX_GATEWAY_TOKEN"');
    expect(userData).not.toContain("AZURE_OPENAI_API_KEY");
    expect(userData).not.toContain("docker run --rm");
    expect(userData).not.toContain("ank1015-machine-heartbeat.service");
    expect(userData).not.toContain("/machines/register");
    expect(userData).not.toContain("bootstrap-placeholder");
  });
});

describe("Docker machine provisioning", () => {
  it("is selected only when COMPUTER_PROVISIONER=docker", () => {
    expect(createComputerProvisioner(createConfig())).toBeInstanceOf(AwsEc2Provisioner);
    expect(createComputerProvisioner({
      ...createConfig(),
      computerProvisioner: "docker",
    })).toBeInstanceOf(DockerMachineProvisioner);
  });

  it("creates a machine container with identity, labels, network, channel, and workspace volume", async () => {
    const commands: Array<{ command: string; args: readonly string[] }> = [];
    const executor: CommandExecutor = async (command, args) => {
      commands.push({ command, args });
      if (args[0] === "network" && args[1] === "inspect") {
        throw new Error("network missing");
      }
      if (args[0] === "run") {
        return { stdout: "container-123\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };
    const provisioner = new DockerMachineProvisioner({ executor });
    const computer = createComputer();

    const result = await provisioner.provisionComputer({
      computer,
      bootstrapToken: "bootstrap-token",
      config: {
        ...createConfig(),
        computerProvisioner: "docker",
        localDockerMachineImage: "machine-image:test",
        localDockerNetwork: "ank1015-test",
        localDockerCloudUrl: "http://host.docker.internal:4100",
        machineServerChannel: "local",
      },
    });

    expect(commands.map((entry) => [entry.command, ...entry.args])).toEqual([
      ["docker", "network", "inspect", "ank1015-test"],
      ["docker", "network", "create", "ank1015-test"],
      expect.arrayContaining([
        "docker",
        "run",
        "-d",
        "--name",
        "ank1015-machine-computer-123",
        "--label",
        "ank1015:kind=machine",
        "--label",
        "ank1015:computer-id=computer-123",
        "--network",
        "ank1015-test",
        "--restart",
        "unless-stopped",
        "-v",
        "ank1015-workspace-computer-123:/workspace",
        "-e",
        "CLOUD_SERVER_PUBLIC_URL=http://host.docker.internal:4100",
        "-e",
        "ANK1015_COMPUTER_ID=computer-123",
        "-e",
        "ANK1015_BOOTSTRAP_TOKEN=bootstrap-token",
        "-e",
        "MACHINE_SERVER_CHANNEL=local",
        "-e",
        "ANK1015_MACHINE_SUPERVISOR=process",
        "machine-image:test",
      ]),
    ]);
    expect(result.providerMetadata).toMatchObject({
      provider: "docker",
      containerId: "container-123",
      containerName: "ank1015-machine-computer-123",
      image: "machine-image:test",
      network: "ank1015-test",
      workspaceVolume: "ank1015-workspace-computer-123",
      lastAction: "provision",
    });
  });

  it("maps lifecycle commands to docker and removes the local workspace volume on terminate", async () => {
    const commands: Array<readonly string[]> = [];
    const executor: CommandExecutor = async (command, args) => {
      commands.push([command, ...args]);
      return { stdout: "", stderr: "" };
    };
    const provisioner = new DockerMachineProvisioner({ executor });
    const computer = {
      ...createComputer(),
      providerMetadata: {
        provider: "docker",
        containerName: "ank1015-machine-computer-123",
        image: "machine-image:test",
        network: "ank1015-test",
        workspaceVolume: "ank1015-workspace-computer-123",
      },
    };

    await provisioner.startComputer(computer);
    await provisioner.stopComputer(computer);
    await provisioner.restartComputer(computer);
    const metadata = await provisioner.terminateComputer(computer);

    expect(commands).toEqual([
      ["docker", "start", "ank1015-machine-computer-123"],
      ["docker", "stop", "ank1015-machine-computer-123"],
      ["docker", "restart", "ank1015-machine-computer-123"],
      ["docker", "rm", "-f", "ank1015-machine-computer-123"],
      ["docker", "volume", "rm", "-f", "ank1015-workspace-computer-123"],
    ]);
    expect(metadata).toMatchObject({
      provider: "docker",
      lastAction: "terminate",
    });
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
  machineServerChannel: "stable",
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
  machineHealth: {},
  machineServerVersion: null,
  lastHeartbeatAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});
