# HeySnap AI

HeySnap is a cloud-machine AI workspace. Users log in, create or open a personal
computer, then work with the same filesystem, file previews, browser surface,
and streamed agent session from web or mobile.

The project is built around a product belief: useful AI agents should live close
to the files, browser, and tools they are expected to operate on. HeySnap is not
only a chat UI. It includes the control plane, gateway, machine runtime,
previewer, mobile client, admin surface, and release loop needed to make a
remote AI computer usable.

## What It Shows

- A Vite web workspace for cloud computers.
- An Expo mobile app that connects to the same machine model.
- A Hono cloud server for auth, machines, gateway access, admin operations, and
  release manifests.
- A per-machine server that exposes filesystem, preview, browser-control,
  capabilities, and agent APIs.
- Outbound gateway tunnels so machines do not need public machine-server ports.
- File previews for PDFs, spreadsheets, docs, presentations, images, video,
  audio, markdown, CSV, HTML, and code.
- Local Docker machine development that mirrors the hosted architecture.
- GitHub Actions paths for web deploys, cloud-server deploys, machine-server
  releases, and machine image builds.

## Workspace

- `apps/web`: Vite browser app for cloud machines.
- `apps/mobile`: Expo mobile app for cloud machines.
- `packages/server`: machine server that runs on provisioned machines.
- `packages/cloud-server`: hosted Hono control plane, gateway, admin, and release API.
- `packages/previewer`: file preview service and browser preview UI.
- `packages/tunnel-protocol`: shared framing and queueing rules for gateway tunnels.

Each app/package has its own README with local commands and responsibilities.

## Common Commands

```sh
pnpm install
pnpm dev
pnpm build
pnpm typecheck
```

`pnpm dev` starts the web app. Use `pnpm dev:local` for the local
cloud-server, admin UI, and Docker-provisioned machine workflow.

## Local Machine Flow

```text
User opens HeySnap
  -> cloud server authenticates the user
  -> user selects or creates a computer
  -> cloud server creates a short-lived access session
  -> client connects to gateway routes
  -> gateway routes traffic through the machine tunnel
  -> machine server exposes filesystem, previews, browser control, and agent runs
```

For the full local stack:

```sh
pnpm dev:local
```

That starts local infrastructure, runs cloud-server migrations, publishes a
local machine-server release, and starts the web and admin dev servers.

## Documentation

- `docs/README.md`: documentation index.
- `docs/packages-and-apps.md`: what each workspace package/app owns.
- `docs/system-wiring.md`: how auth, machines, gateway, and UI fit together.
- `docs/distribution-and-updates.md`: GitHub Actions, releases, and update loops.
- `docs/admin-operations.md`: admin dashboard and operational commands.
- `docs/cloud-server-db.md`: Postgres and Drizzle setup.
- `docs/cloud-server-deploy.md`: hosted cloud-server deployment.
- `docs/cloud-server-vms.md`: EC2 VM provisioning details.
