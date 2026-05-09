import type { CloudServerConfig } from "../config.js";
import { AwsEc2Provisioner } from "./aws-ec2-provisioner.js";
import { DockerMachineProvisioner } from "./docker-provisioner.js";
import type { ComputerProvisioner } from "./types.js";

export const createComputerProvisioner = (config: CloudServerConfig): ComputerProvisioner => {
  if (config.computerProvisioner === "docker") {
    return new DockerMachineProvisioner();
  }

  return new AwsEc2Provisioner();
};
