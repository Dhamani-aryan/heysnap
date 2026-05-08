import type { ComputerRecord } from "../db/types.js";

export interface RenderMachineUserDataInput {
  readonly cloudServerPublicUrl: string;
  readonly computer: ComputerRecord;
  readonly bootstrapToken: string;
  readonly machineServerVersion: string;
  readonly codexDefaultModel?: string;
}

export const renderMachineUserData = (input: RenderMachineUserDataInput): string => {
  const codexDefaultModel = input.codexDefaultModel?.trim() || "gpt-5.5";
  const envFile = [
    `CLOUD_SERVER_PUBLIC_URL=${input.cloudServerPublicUrl}`,
    `ANK1015_COMPUTER_ID=${input.computer.id}`,
    `MACHINE_SERVER_VERSION=${input.machineServerVersion}`,
    "MACHINE_SERVER_CHANNEL=stable",
    "PORT=4000",
    "HOST=127.0.0.1",
    "NODE_ENV=production",
    "HOME=/home/agent",
    "ANK1015_FILESYSTEM_ROOT=/workspace",
    "ANK1015_MACHINE_TOKEN_FILE=/opt/ank1015/machine-token",
    "ANK1015_CAPABILITIES_ROOT=/opt/ank1015/agent-capabilities",
    "ANK1015_AGENT_TOOLS_ROOT=/opt/ank1015/agent-tools",
    "ANK1015_AGENT_TOOLS_BIN_DIR=/opt/ank1015/agent-tools/bin",
    "ANK1015_AGENT_SKILLS_CATALOG_DIR=/opt/ank1015/agent-skills/catalog",
    "ANK1015_ACTIVE_SKILLS_DIR=/home/agent/.codex/skills",
    "PATH=/opt/ank1015/agent-tools/bin:/opt/ank1015/venvs/default/bin:/usr/local/bin:/usr/bin:/bin",
  ].join("\n");

  return `#!/usr/bin/env bash
set -euo pipefail

groupadd -f ank1015
groupadd -f docker
install -d -m 0750 -o root -g ank1015 /opt/ank1015
if ! id -u agent >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --groups ank1015,docker agent
else
  usermod -aG ank1015,docker agent || true
fi

install -d -m 0755 -o agent -g agent /workspace
install -d -m 0755 -o agent -g agent /home/agent
install -d -m 0700 -o agent -g agent /home/agent/.codex
install -d -m 0755 -o agent -g agent /home/agent/.codex/skills
install -d -m 0755 -o root -g root /opt/ank1015/machine-server/releases
install -d -m 0775 -o root -g ank1015 /opt/ank1015/agent-capabilities
install -d -m 0775 -o root -g ank1015 /opt/ank1015/agent-tools
install -d -m 0775 -o root -g ank1015 /opt/ank1015/agent-tools/bin
install -d -m 0775 -o root -g ank1015 /opt/ank1015/agent-tools/installed
install -d -m 0775 -o root -g ank1015 /opt/ank1015/agent-skills
install -d -m 0775 -o root -g ank1015 /opt/ank1015/agent-skills/catalog

cat >/opt/ank1015/machine.env <<'ENV'
${envFile}
ENV
chown root:ank1015 /opt/ank1015/machine.env
chmod 0640 /opt/ank1015/machine.env

cat >/opt/ank1015/bootstrap-token <<'TOKEN'
${input.bootstrapToken}
TOKEN
chmod 0600 /opt/ank1015/bootstrap-token

cat >/home/agent/.codex/config.toml <<'CODEX'
model_provider = "azure"
model = "${codexDefaultModel}"

[model_providers.azure]
name = "Azure"
base_url = "${input.cloudServerPublicUrl.replace(/\/+$/, "")}/llm/openai/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false

[model_providers.azure.env_http_headers]
"api-key" = "ANK1015_CODEX_GATEWAY_TOKEN"
CODEX
chown agent:agent /home/agent/.codex/config.toml
chmod 0600 /home/agent/.codex/config.toml

cat >/opt/ank1015/install-machine-server-release.sh <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

source /opt/ank1015/machine.env

LATEST_JSON=/opt/ank1015/latest-machine-server.json
DOWNLOAD_DIR=/opt/ank1015/downloads
RELEASES_DIR=/opt/ank1015/machine-server/releases
CURRENT_LINK=/opt/ank1015/machine-server/current

machine_status() {
  curl -fsS "http://127.0.0.1:$PORT/status" || true
}

latest_release() {
  mkdir -p "$DOWNLOAD_DIR"
  curl -fsS "$CLOUD_SERVER_PUBLIC_URL/releases/machine-server/latest?channel=$MACHINE_SERVER_CHANNEL&currentVersion=$MACHINE_SERVER_VERSION" \\
    -o "$LATEST_JSON"
}

release_value() {
  jq -r "$1 // empty" "$LATEST_JSON"
}

update_machine_version() {
  local version="$1"
  sed -i "s|^MACHINE_SERVER_VERSION=.*|MACHINE_SERVER_VERSION=$version|" /opt/ank1015/machine.env
  source /opt/ank1015/machine.env
}

install_capabilities_helper() {
  if [ -f "$CURRENT_LINK/dist/capabilities/helper.js" ]; then
    cat >/opt/ank1015/agent-capabilities-helper <<'HELPER'
#!/usr/bin/env bash
set -euo pipefail
source /opt/ank1015/machine.env
exec /usr/bin/node /opt/ank1015/machine-server/current/dist/capabilities/helper.js "$@"
HELPER
    chown root:root /opt/ank1015/agent-capabilities-helper
    chmod 0755 /opt/ank1015/agent-capabilities-helper
    if command -v sudo >/dev/null 2>&1; then
      cat >/etc/sudoers.d/ank1015-agent-capabilities <<'SUDOERS'
agent ALL=(root) NOPASSWD: /opt/ank1015/agent-capabilities-helper
SUDOERS
      chmod 0440 /etc/sudoers.d/ank1015-agent-capabilities
    fi
  fi
}

install_release() {
  local version="$1"
  local download_url="$2"
  local sha256="$3"
  local release_dir="$RELEASES_DIR/$version"

  if [ -x "$release_dir/dist/index.js" ] || [ -f "$release_dir/dist/index.js" ]; then
    ln -sfnT "$release_dir" "$CURRENT_LINK"
    update_machine_version "$version"
    install_capabilities_helper
    return 0
  fi

  if [ -z "$version" ] || [ -z "$download_url" ] || [ -z "$sha256" ]; then
    echo "Machine-server release is missing version, downloadUrl, or metadata.sha256" >&2
    return 1
  fi

  local archive="$DOWNLOAD_DIR/machine-server-$version.tar.gz"
  local temp_dir="$RELEASES_DIR/.tmp-$version"
  rm -rf "$temp_dir"
  mkdir -p "$DOWNLOAD_DIR" "$temp_dir"

  curl -fL "$download_url" -o "$archive"
  printf '%s  %s\\n' "$sha256" "$archive" | sha256sum -c -
  tar -xzf "$archive" -C "$temp_dir"

  test -f "$temp_dir/dist/index.js"
  rm -rf "$release_dir"
  mv "$temp_dir" "$release_dir"
  chown -R root:root "$release_dir"
  ln -sfnT "$release_dir" "$CURRENT_LINK"
  update_machine_version "$version"
  install_capabilities_helper
}

install_latest_if_needed() {
  if [ -f "$CURRENT_LINK/dist/index.js" ]; then
    return 0
  fi

  latest_release
  install_release \\
    "$(release_value '.latest.version')" \\
    "$(release_value '.latest.downloadUrl')" \\
    "$(release_value '.latest.metadata.sha256')"
}

install_update_if_idle() {
  latest_release

  local update_available
  update_available="$(release_value '.updateAvailable')"

  if [ "$update_available" != "true" ]; then
    return 0
  fi

  local next_version
  local next_url
  local next_sha256
  next_version="$(release_value '.latest.version')"
  next_url="$(release_value '.latest.downloadUrl')"
  next_sha256="$(release_value '.latest.metadata.sha256')"

  if [ -z "$next_version" ] || [ "$next_version" = "$MACHINE_SERVER_VERSION" ]; then
    return 0
  fi

  local status_json
  status_json="$(machine_status)"

  if [ -n "$status_json" ] && [ "$(printf '%s' "$status_json" | jq -r '.safeToRestart // false')" != "true" ]; then
    return 0
  fi

  local previous_target
  previous_target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  install_release "$next_version" "$next_url" "$next_sha256"

  if ! systemctl restart ank1015-machine-server.service; then
    rollback_release "$previous_target"
    return 1
  fi

  sleep 2
  if ! curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null; then
    rollback_release "$previous_target"
    return 1
  fi
}

rollback_release() {
  local previous_target="$1"

  if [ -n "$previous_target" ] && [ -d "$previous_target" ]; then
    ln -sfnT "$previous_target" "$CURRENT_LINK"
    update_machine_version "$(basename "$previous_target")"
    systemctl restart ank1015-machine-server.service || true
  fi
}

install_latest_if_needed
SCRIPT
chmod +x /opt/ank1015/install-machine-server-release.sh

cat >/opt/ank1015/machine-heartbeat-loop.sh <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

source /opt/ank1015/machine.env

machine_status() {
  curl -fsS "http://127.0.0.1:$PORT/status" || true
}

register_machine() {
  local bootstrap_token
  bootstrap_token="$(cat /opt/ank1015/bootstrap-token)"

  curl -fsS -X POST "$CLOUD_SERVER_PUBLIC_URL/machines/register" \\
    -H 'content-type: application/json' \\
    -d "{\\"computerId\\":\\"$ANK1015_COMPUTER_ID\\",\\"bootstrapToken\\":\\"$bootstrap_token\\",\\"machineServerVersion\\":\\"$MACHINE_SERVER_VERSION\\",\\"capabilities\\":[\\"filesystem\\",\\"agent\\",\\"shell\\"]}" \\
    -o /opt/ank1015/registration.json
  jq -r '.machine.token' /opt/ank1015/registration.json >/opt/ank1015/machine-token
  chown root:ank1015 /opt/ank1015/machine-token
  chmod 0640 /opt/ank1015/machine-token
}

while true; do
  if [ ! -s /opt/ank1015/machine-token ]; then
    register_machine || true
  fi

  if [ -s /opt/ank1015/machine-token ]; then
    MACHINE_TOKEN="$(cat /opt/ank1015/machine-token)"
    STATUS_JSON="$(machine_status)"
    SAFE_TO_RESTART="true"

    if [ -n "$STATUS_JSON" ]; then
      MACHINE_SERVER_VERSION="$(printf '%s' "$STATUS_JSON" | jq -r '.version // env.MACHINE_SERVER_VERSION')"
      SAFE_TO_RESTART="$(printf '%s' "$STATUS_JSON" | jq -r '.safeToRestart // true')"
    fi

    MACHINE_STATUS="idle"
    if [ "$SAFE_TO_RESTART" != "true" ]; then
      MACHINE_STATUS="online"
    fi

    curl -fsS -X POST "$CLOUD_SERVER_PUBLIC_URL/machines/heartbeat" \\
      -H "authorization: Bearer $MACHINE_TOKEN" \\
      -H 'content-type: application/json' \\
      -d "{\\"status\\":\\"$MACHINE_STATUS\\",\\"machineServerVersion\\":\\"$MACHINE_SERVER_VERSION\\",\\"capabilities\\":[\\"filesystem\\",\\"agent\\",\\"shell\\"]}" \\
      -o /opt/ank1015/heartbeat.json || rm -f /opt/ank1015/machine-token
    /opt/ank1015/install-machine-server-release.sh || true
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
User=agent
Group=agent
SupplementaryGroups=ank1015 docker
EnvironmentFile=/opt/ank1015/machine.env
WorkingDirectory=/workspace
ExecStartPre=+/opt/ank1015/install-machine-server-release.sh
ExecStart=/usr/bin/node /opt/ank1015/machine-server/current/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

cat >/etc/systemd/system/ank1015-machine-heartbeat.service <<'SERVICE'
[Unit]
Description=ank1015 machine registration, heartbeat, and updates
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
