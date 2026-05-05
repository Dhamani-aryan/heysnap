# ank1015-app

HeySnap is a multi-machine coding-agent platform. Users log in, see their
machines, and open the same filesystem plus agent workspace against either a
cloud VM or the local machine in the Electron desktop app.

## Workspace

- `apps/web`: Next.js browser app for cloud machines.
- `apps/desktop`: Electron desktop app for cloud machines and the local machine.
- `packages/ui`: shared React UI, cloud client, filesystem UI, and agent UI.
- `packages/server`: machine server that runs on VMs and is embedded by desktop for local work.
- `packages/cloud-server`: hosted Hono control plane, gateway, admin, and release API.

Each app/package has its own README with local commands and responsibilities.

## Common Commands

```sh
pnpm install
pnpm dev
pnpm build
pnpm typecheck
```

`pnpm dev` starts only the web app and desktop app. The desktop app starts the
local machine server in-process, so Docker is not required for local desktop
development.

## Documentation

- `docs/README.md`: documentation index.
- `docs/packages-and-apps.md`: what each workspace package/app owns.
- `docs/system-wiring.md`: how auth, machines, gateway, and UI fit together.
- `docs/distribution-and-updates.md`: GitHub Actions, releases, and update loops.
- `docs/admin-operations.md`: admin dashboard and operational commands.
- `docs/cloud-server-db.md`: Postgres and Drizzle setup.
- `docs/cloud-server-deploy.md`: hosted cloud-server deployment.
- `docs/cloud-server-vms.md`: EC2 VM provisioning details.
