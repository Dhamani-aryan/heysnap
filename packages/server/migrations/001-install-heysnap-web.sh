#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/ank1015/agent-tools/bin:/opt/ank1015/venvs/default/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install @heysnap-ai/web" >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to validate @heysnap-ai/web" >&2
  exit 1
fi

export NODE_PATH="$(npm root -g):${NODE_PATH:-}"

if npm list -g @heysnap-ai/web --depth=0 >/dev/null 2>&1; then
  echo "@heysnap-ai/web is already installed"
  npx --no-install @heysnap-ai/web --help >/dev/null
  exit 0
fi

npm install -g @heysnap-ai/web
npm list -g @heysnap-ai/web --depth=0 >/dev/null
npx --no-install @heysnap-ai/web --help >/dev/null
