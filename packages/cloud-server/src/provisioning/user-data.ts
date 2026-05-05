import type { ComputerRecord } from "../db/types.js";

export interface RenderMachineUserDataInput {
  readonly cloudServerPublicUrl: string;
  readonly computer: ComputerRecord;
  readonly bootstrapToken: string;
  readonly machineServerImage: string;
  readonly machineServerVersion: string;
}

export const renderMachineUserData = (input: RenderMachineUserDataInput): string => {
  const envFile = [
    `CLOUD_SERVER_PUBLIC_URL=${input.cloudServerPublicUrl}`,
    `ANK1015_COMPUTER_ID=${input.computer.id}`,
    `ANK1015_MACHINE_BOOTSTRAP_TOKEN=${input.bootstrapToken}`,
    `MACHINE_SERVER_IMAGE=${input.machineServerImage}`,
    `MACHINE_SERVER_VERSION=${input.machineServerVersion}`,
    "PORT=4000",
    "ANK1015_FILESYSTEM_ROOT=/workspace",
    "ANK1015_MACHINE_TOKEN_FILE=/opt/ank1015/machine-token",
  ].join("\n");

  return `#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl docker.io jq unzip
systemctl enable --now docker

if ! command -v aws >/dev/null 2>&1; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
  rm -rf /tmp/aws /tmp/awscliv2.zip
fi

mkdir -p /opt/ank1015
cat >/opt/ank1015/machine.env <<'ENV'
${envFile}
ENV
chmod 600 /opt/ank1015/machine.env

cat >/opt/ank1015/pull-machine-image.sh <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

source /opt/ank1015/machine.env

if [[ "$MACHINE_SERVER_IMAGE" == *".dkr.ecr."*"amazonaws.com"* ]]; then
  ECR_REGISTRY="\${MACHINE_SERVER_IMAGE%%/*}"
  ECR_REGION="$(printf '%s' "$ECR_REGISTRY" | awk -F. '{print $4}')"
  aws ecr get-login-password --region "$ECR_REGION" |
    docker login --username AWS --password-stdin "$ECR_REGISTRY"
fi

docker pull "$MACHINE_SERVER_IMAGE"
SCRIPT
chmod +x /opt/ank1015/pull-machine-image.sh

cat >/opt/ank1015/start-machine-server.sh <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

source /opt/ank1015/machine.env

exec docker run --rm \\
  --name ank1015-machine-server \\
  --network host \\
  --env-file /opt/ank1015/machine.env \\
  -v /opt/ank1015:/opt/ank1015:ro \\
  -v /home/ubuntu:/workspace \\
  "$MACHINE_SERVER_IMAGE"
SCRIPT
chmod +x /opt/ank1015/start-machine-server.sh

cat >/opt/ank1015/machine-heartbeat-loop.sh <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

source /opt/ank1015/machine.env

register_machine() {
  curl -fsS -X POST "$CLOUD_SERVER_PUBLIC_URL/machines/register" \\
    -H 'content-type: application/json' \\
    -d "{\\"computerId\\":\\"$ANK1015_COMPUTER_ID\\",\\"bootstrapToken\\":\\"$ANK1015_MACHINE_BOOTSTRAP_TOKEN\\",\\"machineServerVersion\\":\\"$MACHINE_SERVER_VERSION\\",\\"capabilities\\":[\\"filesystem\\",\\"agent\\"]}" \\
    -o /opt/ank1015/registration.json
  jq -r '.machine.token' /opt/ank1015/registration.json >/opt/ank1015/machine-token
  chmod 600 /opt/ank1015/machine-token
}

while true; do
  if [ ! -s /opt/ank1015/machine-token ]; then
    register_machine || true
  fi

  if [ -s /opt/ank1015/machine-token ]; then
    MACHINE_TOKEN="$(cat /opt/ank1015/machine-token)"
    curl -fsS -X POST "$CLOUD_SERVER_PUBLIC_URL/machines/heartbeat" \\
      -H "authorization: Bearer $MACHINE_TOKEN" \\
      -H 'content-type: application/json' \\
      -d "{\\"status\\":\\"idle\\",\\"machineServerVersion\\":\\"$MACHINE_SERVER_VERSION\\",\\"capabilities\\":[\\"filesystem\\",\\"agent\\"]}" \\
      -o /opt/ank1015/heartbeat.json || rm -f /opt/ank1015/machine-token
  fi

  sleep 30
done
SCRIPT
chmod +x /opt/ank1015/machine-heartbeat-loop.sh

cat >/etc/systemd/system/ank1015-machine-server.service <<'SERVICE'
[Unit]
Description=ank1015 machine server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/opt/ank1015/machine.env
WorkingDirectory=/opt/ank1015
ExecStartPre=-/usr/bin/docker rm -f ank1015-machine-server
ExecStartPre=/opt/ank1015/pull-machine-image.sh
ExecStart=/opt/ank1015/start-machine-server.sh
ExecStop=-/usr/bin/docker stop ank1015-machine-server
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

cat >/etc/systemd/system/ank1015-machine-heartbeat.service <<'SERVICE'
[Unit]
Description=ank1015 machine registration and heartbeat
After=network-online.target ank1015-machine-server.service
Wants=network-online.target ank1015-machine-server.service

[Service]
Type=simple
EnvironmentFile=/opt/ank1015/machine.env
WorkingDirectory=/opt/ank1015
ExecStart=/opt/ank1015/machine-heartbeat-loop.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now ank1015-machine-server.service
systemctl enable --now ank1015-machine-heartbeat.service
`;
};
