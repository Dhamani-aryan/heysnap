import {
  EC2Client,
  RebootInstancesCommand,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
  type RunInstancesCommandInput,
} from "@aws-sdk/client-ec2";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

import { asAwsEc2ProviderMetadata, type AwsEc2ProviderMetadata } from "./metadata.js";
import { getDev8gbPreset } from "./presets.js";
import type {
  ComputerProvisioner,
  ProvisionComputerInput,
  ProvisionComputerResult,
} from "./types.js";
import { renderMachineUserData } from "./user-data.js";
import type { ComputerRecord } from "../db/types.js";

export interface AwsEc2ProvisionerOptions {
  readonly ec2Client?: Pick<EC2Client, "send">;
  readonly ssmClient?: Pick<SSMClient, "send">;
}

export class AwsEc2Provisioner implements ComputerProvisioner {
  private readonly ec2Client: Pick<EC2Client, "send"> | undefined;
  private readonly ssmClient: Pick<SSMClient, "send"> | undefined;

  constructor(options: AwsEc2ProvisionerOptions = {}) {
    this.ec2Client = options.ec2Client;
    this.ssmClient = options.ssmClient;
  }

  async provisionComputer(input: ProvisionComputerInput): Promise<ProvisionComputerResult> {
    const preset = getDev8gbPreset(input.config);
    const ec2 = this.ec2Client ?? new EC2Client({ region: preset.region });
    const ssm = this.ssmClient ?? new SSMClient({ region: preset.region });
    const imageIdResponse = await ssm.send(new GetParameterCommand({
      Name: preset.amiSsmParameterName,
    }));
    const imageId = imageIdResponse.Parameter?.Value;

    if (imageId === undefined || imageId.length === 0) {
      throw new Error(`Could not resolve AMI from ${preset.amiSsmParameterName}`);
    }

    const userData = renderMachineUserData({
      cloudServerPublicUrl: input.config.cloudServerPublicUrl,
      computer: input.computer,
      bootstrapToken: input.bootstrapToken,
      machineServerVersion: input.config.machineServerVersion,
      codexDefaultModel: input.config.codexDefaultModel,
    });
    const request = buildRunInstancesRequest({
      computer: input.computer,
      imageId,
      instanceType: preset.instanceType,
      rootVolumeGb: preset.rootVolumeGb,
      userData,
      machineInstanceProfileName: input.config.awsMachineInstanceProfileName,
    });
    const response = await ec2.send(new RunInstancesCommand(request));
    const instanceId = response.Instances?.[0]?.InstanceId;

    if (instanceId === undefined || instanceId.length === 0) {
      throw new Error("EC2 did not return an instance id");
    }

    return {
      providerMetadata: {
        provider: "aws-ec2",
        preset: preset.id,
        region: preset.region,
        instanceId,
        instanceType: preset.instanceType,
        imageId,
        rootVolumeGb: preset.rootVolumeGb,
        lastAction: "provision",
        lastActionAt: new Date().toISOString(),
      },
    };
  }

  async startComputer(computer: ComputerRecord): Promise<Record<string, unknown>> {
    const metadata = requireAwsMetadata(computer);
    const ec2 = this.ec2Client ?? new EC2Client({ region: metadata.region });
    await ec2.send(new StartInstancesCommand({ InstanceIds: [metadata.instanceId] }));
    return markAction(metadata, "start");
  }

  async stopComputer(computer: ComputerRecord): Promise<Record<string, unknown>> {
    const metadata = requireAwsMetadata(computer);
    const ec2 = this.ec2Client ?? new EC2Client({ region: metadata.region });
    await ec2.send(new StopInstancesCommand({ InstanceIds: [metadata.instanceId] }));
    return markAction(metadata, "stop");
  }

  async restartComputer(computer: ComputerRecord): Promise<Record<string, unknown>> {
    const metadata = requireAwsMetadata(computer);
    const ec2 = this.ec2Client ?? new EC2Client({ region: metadata.region });
    await ec2.send(new RebootInstancesCommand({ InstanceIds: [metadata.instanceId] }));
    return markAction(metadata, "restart");
  }

  async terminateComputer(computer: ComputerRecord): Promise<Record<string, unknown>> {
    const metadata = asAwsEc2ProviderMetadata(computer.providerMetadata);

    if (metadata?.instanceId === undefined) {
      return computer.providerMetadata as Record<string, unknown>;
    }

    const ec2 = this.ec2Client ?? new EC2Client({ region: metadata.region });
    await ec2.send(new TerminateInstancesCommand({ InstanceIds: [metadata.instanceId] }));
    return markAction(metadata, "terminate");
  }
}

export const buildRunInstancesRequest = (input: {
  readonly computer: ComputerRecord;
  readonly imageId: string;
  readonly instanceType: string;
  readonly rootVolumeGb: number;
  readonly userData: string;
  readonly machineInstanceProfileName?: string;
}): RunInstancesCommandInput => {
  const request: RunInstancesCommandInput = {
    ImageId: input.imageId,
    InstanceType: input.instanceType as RunInstancesCommandInput["InstanceType"],
    MinCount: 1,
    MaxCount: 1,
    UserData: Buffer.from(input.userData, "utf8").toString("base64"),
    BlockDeviceMappings: [
      {
        DeviceName: "/dev/sda1",
        Ebs: {
          VolumeType: "gp3",
          VolumeSize: input.rootVolumeGb,
          DeleteOnTermination: false,
          Encrypted: true,
        },
      },
    ],
    TagSpecifications: [
      {
        ResourceType: "instance",
        Tags: [
          { Key: "Name", Value: `ank1015-${input.computer.name}` },
          { Key: "ank1015:computer-id", Value: input.computer.id },
        ],
      },
      {
        ResourceType: "volume",
        Tags: [
          { Key: "Name", Value: `ank1015-${input.computer.name}` },
          { Key: "ank1015:computer-id", Value: input.computer.id },
        ],
      },
    ],
  };

  if (input.machineInstanceProfileName !== undefined) {
    request.IamInstanceProfile = { Name: input.machineInstanceProfileName };
  }

  return request;
};

type RunnableAwsEc2Metadata = AwsEc2ProviderMetadata & {
  readonly instanceId: string;
};

const requireAwsMetadata = (computer: ComputerRecord): RunnableAwsEc2Metadata => {
  const metadata = asAwsEc2ProviderMetadata(computer.providerMetadata);

  if (metadata?.instanceId === undefined) {
    throw new Error("Computer is not backed by an AWS EC2 instance");
  }

  return { ...metadata, instanceId: metadata.instanceId };
};

const markAction = (
  metadata: Record<string, unknown>,
  action: string,
): Record<string, unknown> => ({
  ...metadata,
  lastAction: action,
  lastActionAt: new Date().toISOString(),
});
