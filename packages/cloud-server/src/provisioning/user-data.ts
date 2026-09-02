import type { ComputerRecord } from "../db/types.js";

export interface RenderMachineUserDataInput {
  readonly cloudServerPublicUrl: string;
  readonly computer: ComputerRecord;
  readonly bootstrapToken: string;
  readonly machineServerChannel: string;
}

export const renderMachineUserData = (input: RenderMachineUserDataInput): string => {
  const envFile = [
    `CLOUD_SERVER_PUBLIC_URL=${input.cloudServerPublicUrl}`,
    `ANK1015_COMPUTER_ID=${input.computer.id}`,
    `MACHINE_SERVER_CHANNEL=${input.machineServerChannel || "stable"}`,
    "ANK1015_MACHINE_ROOT=/opt/ank1015",
    "PORT=4000",
    "HOST=127.0.0.1",
    "NODE_ENV=production",
    "HOME=/home/agent",
    "ANK1015_FILESYSTEM_ROOT=/workspace",
    "ANK1015_MACHINE_ENV_FILE=/opt/ank1015/machine.env",
    "ANK1015_BOOTSTRAP_TOKEN_FILE=/opt/ank1015/bootstrap-token",
    "ANK1015_MACHINE_TOKEN_FILE=/opt/ank1015/machine-token",
    "ANK1015_CAPABILITIES_ROOT=/opt/ank1015/agent-capabilities",
    "ANK1015_AGENT_TOOLS_ROOT=/opt/ank1015/agent-tools",
    "ANK1015_AGENT_TOOLS_BIN_DIR=/opt/ank1015/agent-tools/bin",
    "ANK1015_AGENT_SKILLS_CATALOG_DIR=/opt/ank1015/agent-skills/catalog",
    "PATH=/opt/ank1015/agent-tools/bin:/opt/ank1015/venvs/default/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  ].join("\n");

  return `#!/usr/bin/env bash
set -euo pipefail

install -d -m 0750 -o root -g root /opt/ank1015

cat >/opt/ank1015/machine.env <<'ENV'
${envFile}
ENV
chown root:root /opt/ank1015/machine.env
chmod 0640 /opt/ank1015/machine.env

cat >/opt/ank1015/bootstrap-token <<'TOKEN'
${input.bootstrapToken}
TOKEN
chown root:root /opt/ank1015/bootstrap-token
chmod 0600 /opt/ank1015/bootstrap-token

exec /usr/local/bin/ank1015-machine-bootstrap
`;
};
