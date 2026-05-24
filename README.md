# ank1015-app

HeySnap is a multi-machine coding-agent platform. Users log in, see their
machines, and open the same filesystem plus agent workspace against a cloud VM.

## Workspace

- `apps/web`: Next.js browser app for cloud machines.
- `apps/mobile`: Expo mobile app for cloud machines.
- `packages/ui`: shared React UI, cloud client, filesystem UI, and agent UI.
- `packages/server`: machine server that runs on provisioned machines.
- `packages/cloud-server`: hosted Hono control plane, gateway, admin, and release API.

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

## Documentation

- `docs/README.md`: documentation index.
- `docs/packages-and-apps.md`: what each workspace package/app owns.
- `docs/system-wiring.md`: how auth, machines, gateway, and UI fit together.
- `docs/distribution-and-updates.md`: GitHub Actions, releases, and update loops.
- `docs/admin-operations.md`: admin dashboard and operational commands.
- `docs/cloud-server-db.md`: Postgres and Drizzle setup.
- `docs/cloud-server-deploy.md`: hosted cloud-server deployment.
- `docs/cloud-server-vms.md`: EC2 VM provisioning details.
