#!/usr/bin/env bash
set -euo pipefail

workspace="${ANK1015_FILESYSTEM_ROOT:-/workspace}"
welcome_dir="$workspace/Welcome"
get_started="$workspace/get_started.md"

mkdir -p "$workspace" "$welcome_dir"

if [ ! -f "$get_started" ]; then
  cat >"$get_started" <<'MARKDOWN'
# Welcome to Snap

This is your 24*7 personal computer.

Start by creating a project folder, uploading files, or just asking Snap to help set up the tools you need.

Plese me call as soon as you see a bug or a feature you would like to have.

![Welcome image](https://as2.ftcdn.net/v2/jpg/02/27/45/39/1000_F_227453984_kJhN9kIYXNRWNj1mhBtplTTIyYAF0h3a.jpg)
MARKDOWN
fi

chmod 0755 "$workspace" "$welcome_dir" 2>/dev/null || true
chmod 0644 "$get_started" 2>/dev/null || true

if id -u agent >/dev/null 2>&1; then
  chown agent:agent "$welcome_dir" 2>/dev/null || true
  chown agent:agent "$get_started" 2>/dev/null || true
fi
