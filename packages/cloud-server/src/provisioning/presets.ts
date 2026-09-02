import type { CloudServerConfig } from "../config.js";

export const DEV_8GB_PRESET_ID = "dev-8gb";
export const UBUNTU_2404_AMD64_SSM_PARAMETER =
  "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id";

export interface Ec2Preset {
  readonly id: typeof DEV_8GB_PRESET_ID;
  readonly region: string;
  readonly instanceType: string;
  readonly rootVolumeGb: number;
  readonly amiSsmParameterName: string;
}

export const getDev8gbPreset = (config: CloudServerConfig): Ec2Preset => ({
  id: DEV_8GB_PRESET_ID,
  region: config.awsRegion,
  instanceType: config.awsEc2InstanceType,
  rootVolumeGb: config.awsEc2RootVolumeGb,
  amiSsmParameterName: config.awsMachineAmiSsmParameter || UBUNTU_2404_AMD64_SSM_PARAMETER,
});
