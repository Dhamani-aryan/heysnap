# Packages And Apps

This repo is a pnpm monorepo. The apps are deployable/user-facing surfaces.
The packages provide shared UI, machine runtime, and hosted backend services.

## Apps

### `apps/web`

Next.js app for the hosted browser product.

- Renders the shared `CloudApp` from `packages/ui`.
- Uses `NEXT_PUBLIC_CLOUD_SERVER_URL`, defaulting to `https://api.heysnap.xyz`.
- Supports cloud machines only.
- Uses gateway WebSocket URLs for filesystem and agent sessions.
- Deployed through AWS Amplify via `.github/workflows/deploy-web.yml`.

### `apps/desktop`

Electron app for desktop users.

- Renders the same shared `CloudApp` from `packages/ui`.
- Supports cloud machines plus the local machine.
- Manages the local machine-server Docker sidecar from Electron main.
- Opens local workspaces through direct `127.0.0.1` WebSocket URLs.
- Opens remote workspaces through the hosted gateway.
- Checks desktop app updates with `electron-updater` and cloud release manifests.
- Released through `.github/workflows/release-desktop.yml`.

## Packages

### `packages/ui`

Shared React UI package.

- Cloud auth shell, login, and `My Machines`.
- Machine workspace layout.
- Filesystem browser and agent UI.
- Cloud API client.
- Runtime-specific behavior is injected by apps, such as the Electron local-machine bridge.

### `packages/server`

Machine server that runs on every computer.

- HTTP `/health` and `/status`.
- WebSocket `/filesystem`.
- WebSocket `/agent`.
- Outbound machine tunnel client for cloud VMs.
- Docker image used by EC2 machines and the Electron local sidecar.
- Released through `.github/workflows/release-machine-server.yml`.

### `packages/cloud-server`

Hosted Hono server.

- Auth and sessions.
- Admin-created users.
- Computer inventory.
- EC2 provisioning and lifecycle operations.
- Machine registration, heartbeat, and update checks.
- Gateway tunnel and WebSocket proxying.
- Release manifests for desktop and machine-server updates.
- Admin dashboard at `/admin-dashboard`.
- Deployed through `.github/workflows/deploy-cloud-server.yml`.

## Root Commands

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm build
```

`pnpm dev` starts only `apps/web` and `apps/desktop`. For desktop local-machine
work, Docker Desktop must be running and the development machine-server image
must exist:

```sh
pnpm --filter @ank1015-app/server docker:build
pnpm dev
```
