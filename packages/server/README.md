# @ank1015-app/server

Machine server for each HeySnap computer.

This server runs on cloud VMs and as the Electron-managed local Docker sidecar.
It exposes the same filesystem and agent protocols everywhere, so the shared UI
does not need to know whether a selected machine is local or remote.

## Responsibilities

- HTTP `/health` endpoint.
- HTTP `/status` endpoint with version, active session counts, and
  `safeToRestart`.
- WebSocket `/filesystem` for filesystem listing and mutations.
- WebSocket `/agent` for agent threads and runs.
- Outbound cloud gateway tunnel when running on cloud VMs.
- Docker image used by VM and Electron sidecar update pipelines.

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

## Updates

Machine-server releases are Docker images. Run:

```sh
gh workflow run release-machine-server.yml --repo ank1015/heysnap --ref main \
  -f version=0.1.1 \
  -f channel=stable \
  -f notes='Release notes'
```

The workflow pushes a multi-arch image to ECR and updates the cloud-server
machine-server latest-version manifest. VM supervisors and Electron sidecars
pull and restart only when `/status.safeToRestart` is true.
