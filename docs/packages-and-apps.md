# Packages And Apps

This repo is a pnpm monorepo. The apps are deployable/user-facing surfaces.
The packages provide shared UI, machine runtime, and hosted backend services.

## Apps

### `apps/web`

Vite app for the hosted browser product.

- Uses `VITE_CLOUD_SERVER_URL`, defaulting to the local cloud server in dev scripts.
- Supports cloud machines only.
- Uses gateway WebSocket URLs for filesystem and agent sessions.

### `apps/mobile`

Expo app for mobile users.

- Uses the cloud API and gateway sessions for machine access.
- Shares product concepts with the hosted browser product.

## Packages

### `packages/ui`

Shared React UI package.

- Cloud auth shell, login, and `My Machines`.
- Machine workspace layout.
- Filesystem browser and agent UI.
- Cloud API client.
- Runtime-specific behavior is injected by apps.

### `packages/server`

Machine server that runs on every computer.

- HTTP `/health` and `/status`.
- WebSocket `/filesystem`.
- WebSocket `/agent`.
- Outbound machine tunnel client for cloud VMs.
- Host artifact used by EC2 machines.
- Released through `.github/workflows/release-machine-server.yml`.

### `packages/cloud-server`

Hosted Hono server.

- Auth and sessions.
- Admin-created users.
- Computer inventory.
- EC2 provisioning and lifecycle operations.
- Machine registration, heartbeat, and update checks.
- Gateway tunnel and WebSocket proxying.
- Release manifests for machine-server updates.
- Admin dashboard at `/admin-dashboard`.
- Deployed through `.github/workflows/deploy-cloud-server.yml`.

## Root Commands

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm build
```

`pnpm dev` starts `apps/web`. The machine runtime and hosted backend services
run separately when needed.
