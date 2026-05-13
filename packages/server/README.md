# @ank1015-app/server

Machine server for each HeySnap computer.

This server runs on cloud VMs and is embedded by Electron for the local machine.
It exposes the same filesystem and agent protocols everywhere, so the shared UI
does not need to know whether a selected machine is local or remote.

## Responsibilities

- HTTP `/health` endpoint.
- HTTP `/status` endpoint with version, active session counts, and
  `safeToRestart`.
- WebSocket `/filesystem` for filesystem listing and mutations.
- HTTP `/agent/*` for agent threads and resumable SSE runs.
- Outbound cloud gateway tunnel when running on cloud VMs.
- Host artifact used by VM update pipelines.

## Commands

```sh
pnpm --filter @ank1015-app/server dev
pnpm --filter @ank1015-app/server build
pnpm --filter @ank1015-app/server test
pnpm --filter @ank1015-app/server typecheck
pnpm --filter @ank1015-app/server docker:build
```

## Runtime Environment

Common environment variables:

```sh
PORT=4000
HOST=127.0.0.1
ANK1015_FILESYSTEM_ROOT=~/Desktop
MACHINE_SERVER_VERSION=development
CODEX_BIN=/path/to/codex
```

Cloud VM tunnel variables:

```sh
CLOUD_SERVER_PUBLIC_URL=https://api.heysnap.xyz
ANK1015_COMPUTER_ID=...
ANK1015_MACHINE_TOKEN_FILE=/opt/ank1015/machine-token
```

When `ANK1015_MACHINE_TOKEN_FILE` is present, the machine server reads that file
before starting `codex app-server` and injects
`ANK1015_CODEX_GATEWAY_TOKEN` into the Codex child process. This lets Codex use
the cloud AI gateway without writing provider secrets to the VM.

## Updates

Machine-server releases are host artifacts for cloud VMs. Run:

```sh
gh workflow run release-machine-server.yml --repo ank1015/heysnap --ref main \
  -f version=0.1.1 \
  -f channel=stable \
  -f notes='Release notes'
```

The workflow packages `dist/`, production runtime dependencies, and
`migrations/*.sh` into a tarball, uploads it to S3, publishes the cloud-server
machine-server release manifest, and updates the cloud-server provisioning
defaults for stable releases. Existing VM supervisors download, verify, run
release migrations as root once per release version, and restart only when
`/status.safeToRestart` is true.

The Electron local machine embeds this package directly, so local desktop
machine-server changes ship through the desktop app release.
