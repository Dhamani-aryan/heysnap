#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

bash -n "$ROOT_DIR"/scripts/ank1015-machine-bootstrap \
  "$ROOT_DIR"/scripts/ank1015-machine-release \
  "$ROOT_DIR"/scripts/ank1015-machine-heartbeat \
  "$ROOT_DIR"/lib/ank1015-machine-common.sh \
  "$ROOT_DIR"/../../infra/machine-container/entrypoint.sh

grep -Fq 'agent_home="${ANK1015_AGENT_HOME:-/home/agent}"' "$ROOT_DIR"/../../infra/machine-container/entrypoint.sh
grep -Fq 'HOME=$agent_home' "$ROOT_DIR"/../../infra/machine-container/entrypoint.sh
! grep -Fq 'ANK1015_ACTIVE_SKILLS_DIR' "$ROOT_DIR"/../../infra/machine-container/entrypoint.sh
! grep -Fq 'HOME=${HOME:-/home/agent}' "$ROOT_DIR"/../../infra/machine-container/entrypoint.sh

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required test command: $1" >&2
    exit 1
  fi
}

require jq
require sha256sum

FAKE_BIN="$TEMP_DIR/bin"
MACHINE_ROOT="$TEMP_DIR/machine"
RELEASE_SOURCE="$TEMP_DIR/release-source"
RELEASE_SOURCE_NO_MIGRATIONS="$TEMP_DIR/release-source-no-migrations"
RELEASE_SOURCE_FAILING="$TEMP_DIR/release-source-failing"
ARCHIVE="$TEMP_DIR/machine-server-1.0.0.tar.gz"
ARCHIVE_NO_MIGRATIONS="$TEMP_DIR/machine-server-1.1.0.tar.gz"
ARCHIVE_FAILING="$TEMP_DIR/machine-server-2.0.0.tar.gz"
CAPTURED_HEARTBEAT="$TEMP_DIR/heartbeat-payload.json"
MIGRATION_LOG="$MACHINE_ROOT/migration-order.log"
mkdir -p "$FAKE_BIN" "$MACHINE_ROOT" "$RELEASE_SOURCE/dist/capabilities" "$RELEASE_SOURCE/migrations"
printf 'console.log("machine server")\n' >"$RELEASE_SOURCE/dist/index.js"
printf 'console.log("helper")\n' >"$RELEASE_SOURCE/dist/capabilities/helper.js"
cat >"$RELEASE_SOURCE/migrations/001-first.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s:%s:%s\n' "$ANK1015_RELEASE_VERSION" "$ANK1015_MIGRATION_ID" "$ANK1015_PREVIOUS_RELEASE_DIR" >>"$ANK1015_MACHINE_ROOT/migration-order.log"
SCRIPT
cat >"$RELEASE_SOURCE/migrations/002-second.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s:%s\n' "$ANK1015_RELEASE_VERSION" "$ANK1015_MIGRATION_ID" >>"$ANK1015_MACHINE_ROOT/migration-order.log"
SCRIPT
tar -czf "$ARCHIVE" -C "$RELEASE_SOURCE" .
SHA256="$(sha256sum "$ARCHIVE" | awk '{print $1}')"

mkdir -p "$RELEASE_SOURCE_NO_MIGRATIONS/dist/capabilities"
printf 'console.log("machine server 1.1.0")\n' >"$RELEASE_SOURCE_NO_MIGRATIONS/dist/index.js"
printf 'console.log("helper 1.1.0")\n' >"$RELEASE_SOURCE_NO_MIGRATIONS/dist/capabilities/helper.js"
tar -czf "$ARCHIVE_NO_MIGRATIONS" -C "$RELEASE_SOURCE_NO_MIGRATIONS" .
SHA256_NO_MIGRATIONS="$(sha256sum "$ARCHIVE_NO_MIGRATIONS" | awk '{print $1}')"

mkdir -p "$RELEASE_SOURCE_FAILING/dist/capabilities" "$RELEASE_SOURCE_FAILING/migrations"
printf 'console.log("machine server 2.0.0")\n' >"$RELEASE_SOURCE_FAILING/dist/index.js"
printf 'console.log("helper 2.0.0")\n' >"$RELEASE_SOURCE_FAILING/dist/capabilities/helper.js"
cat >"$RELEASE_SOURCE_FAILING/migrations/001-fail.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
echo "intentional migration failure"
exit 42
SCRIPT
tar -czf "$ARCHIVE_FAILING" -C "$RELEASE_SOURCE_FAILING" .
SHA256_FAILING="$(sha256sum "$ARCHIVE_FAILING" | awk '{print $1}')"

cat >"$FAKE_BIN/curl" <<SCRIPT
#!/usr/bin/env bash
set -euo pipefail
output=""
url=""
data=""
while [ "\$#" -gt 0 ]; do
  case "\$1" in
    -o)
      output="\$2"
      shift 2
      ;;
    -d)
      data="\$2"
      shift 2
      ;;
    -X|-H)
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="\$1"
      shift
      ;;
  esac
done
case "\$url" in
  *"/releases/machine-server/latest"*)
    if [[ "\$url" == *"currentVersion=1.1.0"* ]]; then
      cat >"\$output" <<JSON
{"latest":{"version":"2.0.0","downloadUrl":"https://downloads.example.com/machine-server-2.0.0.tar.gz","metadata":{"sha256":"$SHA256_FAILING"}},"currentVersion":"1.1.0","updateAvailable":true}
JSON
    elif [[ "\$url" == *"currentVersion=1.0.0"* ]]; then
      cat >"\$output" <<JSON
{"latest":{"version":"1.1.0","downloadUrl":"https://downloads.example.com/machine-server-1.1.0.tar.gz","metadata":{"sha256":"$SHA256_NO_MIGRATIONS"}},"currentVersion":"1.0.0","updateAvailable":true}
JSON
    else
      cat >"\$output" <<JSON
{"latest":{"version":"1.0.0","downloadUrl":"https://downloads.example.com/machine-server-1.0.0.tar.gz","metadata":{"sha256":"$SHA256"}},"currentVersion":null,"updateAvailable":false}
JSON
    fi
    ;;
  "https://downloads.example.com/machine-server-1.0.0.tar.gz")
    cp "$ARCHIVE" "\$output"
    ;;
  "https://downloads.example.com/machine-server-1.1.0.tar.gz")
    cp "$ARCHIVE_NO_MIGRATIONS" "\$output"
    ;;
  "https://downloads.example.com/machine-server-2.0.0.tar.gz")
    cp "$ARCHIVE_FAILING" "\$output"
    ;;
  "http://127.0.0.1:4000/status")
    cat <<'JSON'
{"ok":true,"version":"1.0.0","safeToRestart":true,"safeToSleep":true,"lastActivityAt":"2026-01-01T00:00:00.000Z","activeSessions":{"filesystem":0,"agent":0,"capabilities":0,"total":0}}
JSON
    ;;
  "http://127.0.0.1:4000/health")
    cat <<'JSON'
{"ok":true}
JSON
    ;;
  *"/machines/register")
    cat >"\$output" <<'JSON'
{"machine":{"computerId":"computer-test","token":"machine-token","heartbeatIntervalSeconds":30}}
JSON
    ;;
  *"/machines/heartbeat")
    printf '%s' "\$data" >"$CAPTURED_HEARTBEAT"
    cat >"\$output" <<'JSON'
{"ok":true}
JSON
    ;;
  *)
    echo "unexpected curl url: \$url" >&2
    exit 1
    ;;
esac
SCRIPT
chmod +x "$FAKE_BIN/curl"

cat >"$FAKE_BIN/systemctl" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
chmod +x "$FAKE_BIN/systemctl"

ENV_FILE="$MACHINE_ROOT/machine.env"
mkdir -p "$MACHINE_ROOT" "$TEMP_DIR/sudoers"
cat >"$ENV_FILE" <<ENV
CLOUD_SERVER_PUBLIC_URL=https://cloud.example.com
ANK1015_COMPUTER_ID=computer-test
MACHINE_SERVER_CHANNEL=stable
PORT=4000
HOST=127.0.0.1
NODE_ENV=production
HOME=$MACHINE_ROOT/home/agent
ANK1015_FILESYSTEM_ROOT=$MACHINE_ROOT/workspace
ANK1015_MACHINE_TOKEN_FILE=$MACHINE_ROOT/machine-token
ANK1015_CAPABILITIES_ROOT=$MACHINE_ROOT/agent-capabilities
ANK1015_AGENT_TOOLS_ROOT=$MACHINE_ROOT/agent-tools
ANK1015_AGENT_TOOLS_BIN_DIR=$MACHINE_ROOT/agent-tools/bin
ANK1015_AGENT_SKILLS_CATALOG_DIR=$MACHINE_ROOT/agent-skills/catalog
PATH=$FAKE_BIN:$ROOT_DIR/scripts:$PATH
ENV
printf 'bootstrap-token\n' >"$MACHINE_ROOT/bootstrap-token"

export PATH="$FAKE_BIN:$ROOT_DIR/scripts:$PATH"
export ANK1015_MACHINE_ROOT="$MACHINE_ROOT"
export ANK1015_MACHINE_ENV_FILE="$ENV_FILE"
export ANK1015_MACHINE_COMMON_SH="$ROOT_DIR/lib/ank1015-machine-common.sh"
export ANK1015_SUDOERS_DIR="$TEMP_DIR/sudoers"
export ANK1015_FILESYSTEM_ROOT="$MACHINE_ROOT/workspace"

# shellcheck disable=SC1090
. "$ANK1015_MACHINE_COMMON_SH"

dry_run_output="$(ANK1015_BOOTSTRAP_DRY_RUN=1 "$ROOT_DIR/scripts/ank1015-machine-bootstrap")"
test "$dry_run_output" = "supervisor=systemd"

cat >>"$ENV_FILE" <<'ENV'
ANK1015_MACHINE_SUPERVISOR=process
ENV
dry_run_output="$(ANK1015_BOOTSTRAP_DRY_RUN=1 "$ROOT_DIR/scripts/ank1015-machine-bootstrap")"
test "$dry_run_output" = "supervisor=process"
sed -i.bak '/^ANK1015_MACHINE_SUPERVISOR=/d' "$ENV_FILE"

ank1015_machine_seed_workspace_defaults
test -d "$MACHINE_ROOT/workspace/Welcome"
test -f "$MACHINE_ROOT/workspace/get_started.md"
grep -q '# Welcome to Snap' "$MACHINE_ROOT/workspace/get_started.md"

"$ROOT_DIR/scripts/ank1015-machine-release" latest
test -f "$MACHINE_ROOT/machine-server/current/dist/index.js"
test -f "$MACHINE_ROOT/agent-capabilities-helper"
grep -q '^MACHINE_SERVER_VERSION=1.0.0$' "$ENV_FILE"
test -f "$MACHINE_ROOT/machine-migrations/applied/1.0.0/001-first.sh.done"
test -f "$MACHINE_ROOT/machine-migrations/applied/1.0.0/002-second.sh.done"
test "$(cat "$MIGRATION_LOG")" = "$(printf '1.0.0:001-first.sh:\n1.0.0:002-second.sh')"

before_migration_log="$(cat "$MIGRATION_LOG")"
rm "$MACHINE_ROOT/machine-server/current"
sed -i.bak '/^MACHINE_SERVER_VERSION=/d' "$ENV_FILE"
"$ROOT_DIR/scripts/ank1015-machine-release" latest
test "$(cat "$MIGRATION_LOG")" = "$before_migration_log"
grep -q '^MACHINE_SERVER_VERSION=1.0.0$' "$ENV_FILE"

"$ROOT_DIR/scripts/ank1015-machine-release" update
grep -q '^MACHINE_SERVER_VERSION=1.1.0$' "$ENV_FILE"
test "$(readlink -f "$MACHINE_ROOT/machine-server/current")" = "$(readlink -f "$MACHINE_ROOT/machine-server/releases/1.1.0")"
test ! -d "$MACHINE_ROOT/machine-migrations/applied/1.1.0"

if "$ROOT_DIR/scripts/ank1015-machine-release" update; then
  echo "Expected failing migration to block release" >&2
  exit 1
fi
grep -q '^MACHINE_SERVER_VERSION=1.1.0$' "$ENV_FILE"
test "$(readlink -f "$MACHINE_ROOT/machine-server/current")" = "$(readlink -f "$MACHINE_ROOT/machine-server/releases/1.1.0")"
test ! -f "$MACHINE_ROOT/machine-migrations/applied/2.0.0/001-fail.sh.done"
test -f "$MACHINE_ROOT/machine-migrations/logs/2.0.0/001-fail.sh.log"
grep -q 'intentional migration failure' "$MACHINE_ROOT/machine-migrations/logs/2.0.0/001-fail.sh.log"
test "$(cat "$MACHINE_ROOT/machine-update-state")" = "failed"

export ANK1015_HEARTBEAT_ONCE=1
"$ROOT_DIR/scripts/ank1015-machine-heartbeat"
test -f "$MACHINE_ROOT/machine-token"
jq -e '.machineServerVersion == "1.0.0"' "$CAPTURED_HEARTBEAT" >/dev/null
jq -e '.bootstrapVersion == "0.1.1"' "$CAPTURED_HEARTBEAT" >/dev/null
jq -e '.safeToRestart == true' "$CAPTURED_HEARTBEAT" >/dev/null
jq -e '.safeToSleep == true' "$CAPTURED_HEARTBEAT" >/dev/null
jq -e '.lastActivityAt == "2026-01-01T00:00:00.000Z"' "$CAPTURED_HEARTBEAT" >/dev/null
jq -e '.activeSessions.total == 0' "$CAPTURED_HEARTBEAT" >/dev/null
jq -e '.updateState == "failed"' "$CAPTURED_HEARTBEAT" >/dev/null

printf 'machine-bootstrap tests passed\n'
