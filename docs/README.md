# Documentation Index

Start here when you need to understand or operate the HeySnap repo.

## Product And Architecture

- `architecture.md`: high-level product architecture and machine model.
- `packages-and-apps.md`: what each app and package owns.
- `system-wiring.md`: request flows between UI, cloud server, gateway, and machine servers.
- `browser-control-post-api.md`: machine-server POST API for browser-control CLI callers.

## Cloud Server And Machines

- `cloud-server-db.md`: local Postgres and Drizzle commands.
- `cloud-server-deploy.md`: hosted cloud-server environment and deployment.
- `cloud-server-vms.md`: EC2 provisioning, machine registration, and gateway tunnels.
- `local-docker-machines.md`: local cloud-server plus Docker-provisioned machines.
- `admin-operations.md`: admin dashboard, admin APIs, and common operations.

## Releases And Updates

- `distribution-and-updates.md`: all GitHub Actions, when to run them, and how update checks work.

## Per-Package READMEs

- `../apps/web/README.md`
- `../apps/mobile/README.md`
- `../packages/ui/README.md`
- `../packages/server/README.md`
- `../packages/cloud-server/README.md`
