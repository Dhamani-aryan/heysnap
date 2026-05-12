#!/usr/bin/env bash
set -euo pipefail

workspace="${ANK1015_FILESYSTEM_ROOT:-/workspace}"
welcome_dir="$workspace/Welcome"
get_started="$welcome_dir/get_started.md"

mkdir -p "$welcome_dir"

if [ ! -f "$get_started" ]; then
  cat >"$get_started" <<'MARKDOWN'
# Welcome to HeySnap

This is your machine workspace. Files you create here are stored on this VM's persistent disk.

Start by creating a project folder, uploading files, or asking Snap to help set up the tools you need.
MARKDOWN
fi

chmod 0755 "$workspace" "$welcome_dir" 2>/dev/null || true
chmod 0644 "$get_started" 2>/dev/null || true

if id -u agent >/dev/null 2>&1; then
  chown -R agent:agent "$welcome_dir" 2>/dev/null || true
fi
