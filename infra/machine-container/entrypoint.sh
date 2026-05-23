#!/usr/bin/env bash
set -euo pipefail

machine_root="${ANK1015_MACHINE_ROOT:-/opt/ank1015}"
agent_home="${ANK1015_AGENT_HOME:-/home/agent}"
env_file="${ANK1015_MACHINE_ENV_FILE:-$machine_root/machine.env}"
token_file="${ANK1015_BOOTSTRAP_TOKEN_FILE:-$machine_root/bootstrap-token}"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required environment variable: $name" >&2
    exit 2
  fi
}

require_env CLOUD_SERVER_PUBLIC_URL
require_env ANK1015_COMPUTER_ID
require_env ANK1015_BOOTSTRAP_TOKEN

install -d -m 0750 "$machine_root"
install -d -m 0755 /workspace "$agent_home"

cat >"$env_file" <<ENV
CLOUD_SERVER_PUBLIC_URL=$CLOUD_SERVER_PUBLIC_URL
ANK1015_COMPUTER_ID=$ANK1015_COMPUTER_ID
MACHINE_SERVER_CHANNEL=${MACHINE_SERVER_CHANNEL:-local}
ANK1015_MACHINE_SUPERVISOR=${ANK1015_MACHINE_SUPERVISOR:-process}
ANK1015_MACHINE_ROOT=$machine_root
ANK1015_MACHINE_ENV_FILE=$env_file
PORT=${PORT:-4000}
HOST=${HOST:-127.0.0.1}
NODE_ENV=${NODE_ENV:-production}
HOME=$agent_home
ANK1015_FILESYSTEM_ROOT=${ANK1015_FILESYSTEM_ROOT:-/workspace}
ANK1015_BOOTSTRAP_TOKEN_FILE=$token_file
ANK1015_MACHINE_TOKEN_FILE=${ANK1015_MACHINE_TOKEN_FILE:-$machine_root/machine-token}
ANK1015_CAPABILITIES_ROOT=${ANK1015_CAPABILITIES_ROOT:-$machine_root/agent-capabilities}
ANK1015_AGENT_TOOLS_ROOT=${ANK1015_AGENT_TOOLS_ROOT:-$machine_root/agent-tools}
ANK1015_AGENT_TOOLS_BIN_DIR=${ANK1015_AGENT_TOOLS_BIN_DIR:-$machine_root/agent-tools/bin}
ANK1015_AGENT_SKILLS_CATALOG_DIR=${ANK1015_AGENT_SKILLS_CATALOG_DIR:-$machine_root/agent-skills/catalog}
PATH=${PATH:-/opt/ank1015/agent-tools/bin:/opt/ank1015/venvs/default/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}
ENV

printf '%s\n' "$ANK1015_BOOTSTRAP_TOKEN" >"$token_file"
chmod 0640 "$env_file" "$token_file"

exec /usr/local/bin/ank1015-machine-bootstrap
