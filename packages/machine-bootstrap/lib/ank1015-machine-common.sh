#!/usr/bin/env bash

ANK1015_MACHINE_BOOTSTRAP_VERSION="${ANK1015_MACHINE_BOOTSTRAP_VERSION:-0.1.1}"

ank1015_machine_root() {
  printf '%s\n' "${ANK1015_MACHINE_ROOT:-/opt/ank1015}"
}

ank1015_machine_env_file() {
  printf '%s\n' "${ANK1015_MACHINE_ENV_FILE:-$(ank1015_machine_root)/machine.env}"
}

ank1015_machine_load_env() {
  local env_file
  env_file="$(ank1015_machine_env_file)"

  if [ ! -f "$env_file" ]; then
    echo "Machine env file not found: $env_file" >&2
    return 1
  fi

  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a

  export ANK1015_MACHINE_BOOTSTRAP_VERSION
  : "${PORT:=4000}"
  : "${HOST:=127.0.0.1}"
  : "${MACHINE_SERVER_CHANNEL:=stable}"
  : "${ANK1015_MACHINE_SUPERVISOR:=systemd}"
  : "${NODE_ENV:=production}"
  : "${HOME:=/home/agent}"
  : "${ANK1015_FILESYSTEM_ROOT:=/workspace}"
  : "${ANK1015_MACHINE_TOKEN_FILE:=$(ank1015_machine_root)/machine-token}"
  : "${ANK1015_CAPABILITIES_ROOT:=$(ank1015_machine_root)/agent-capabilities}"
  : "${ANK1015_AGENT_TOOLS_ROOT:=$(ank1015_machine_root)/agent-tools}"
  : "${ANK1015_AGENT_TOOLS_BIN_DIR:=$ANK1015_AGENT_TOOLS_ROOT/bin}"
  : "${ANK1015_AGENT_SKILLS_CATALOG_DIR:=$(ank1015_machine_root)/agent-skills/catalog}"
  : "${ANK1015_ACTIVE_SKILLS_DIR:=$HOME/.codex/skills}"
}

ank1015_machine_release_dir() {
  printf '%s\n' "${ANK1015_MACHINE_RELEASES_DIR:-$(ank1015_machine_root)/machine-server/releases}"
}

ank1015_machine_current_link() {
  printf '%s\n' "${ANK1015_MACHINE_CURRENT_LINK:-$(ank1015_machine_root)/machine-server/current}"
}

ank1015_machine_download_dir() {
  printf '%s\n' "${ANK1015_MACHINE_DOWNLOAD_DIR:-$(ank1015_machine_root)/downloads}"
}

ank1015_machine_migrations_dir() {
  printf '%s\n' "${ANK1015_MACHINE_MIGRATIONS_DIR:-$(ank1015_machine_root)/machine-migrations}"
}

ank1015_machine_migrations_applied_dir() {
  printf '%s\n' "$(ank1015_machine_migrations_dir)/applied"
}

ank1015_machine_migrations_logs_dir() {
  printf '%s\n' "$(ank1015_machine_migrations_dir)/logs"
}

ank1015_machine_update_state_file() {
  printf '%s\n' "${ANK1015_MACHINE_UPDATE_STATE_FILE:-$(ank1015_machine_root)/machine-update-state}"
}

ank1015_machine_update_error_file() {
  printf '%s\n' "${ANK1015_MACHINE_UPDATE_ERROR_FILE:-$(ank1015_machine_root)/machine-update-error}"
}

ank1015_machine_status_url() {
  printf 'http://127.0.0.1:%s/status\n' "$PORT"
}

ank1015_machine_health_url() {
  printf 'http://127.0.0.1:%s/health\n' "$PORT"
}

ank1015_machine_set_update_state() {
  local state="$1"
  local error="${2:-}"

  mkdir -p "$(ank1015_machine_root)"
  printf '%s\n' "$state" >"$(ank1015_machine_update_state_file)"

  if [ -n "$error" ]; then
    printf '%s\n' "$error" >"$(ank1015_machine_update_error_file)"
  else
    rm -f "$(ank1015_machine_update_error_file)"
  fi
}

ank1015_machine_read_update_state() {
  local state_file
  state_file="$(ank1015_machine_update_state_file)"

  if [ -s "$state_file" ]; then
    head -n 1 "$state_file"
    return
  fi

  printf 'idle\n'
}

ank1015_machine_read_update_error() {
  local error_file
  error_file="$(ank1015_machine_update_error_file)"

  if [ -s "$error_file" ]; then
    head -n 1 "$error_file"
  fi
}

ank1015_machine_update_env_value() {
  local key="$1"
  local value="$2"
  local env_file temp_file
  env_file="$(ank1015_machine_env_file)"
  temp_file="${env_file}.$$"

  if grep -q "^${key}=" "$env_file"; then
    sed "s|^${key}=.*|${key}=${value}|" "$env_file" >"$temp_file"
    mv "$temp_file" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$env_file"
  fi
}

ank1015_machine_common_version_or_continue() {
  if [ "${1:-}" = "--version" ]; then
    printf '%s\n' "$ANK1015_MACHINE_BOOTSTRAP_VERSION"
    exit 0
  fi
}
