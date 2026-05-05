# @ank1015-app/cloud-server

Hosted HeySnap control plane, gateway, admin API, and release API.

This is a Hono server backed by Postgres through Drizzle. It is deployed at
`https://api.heysnap.xyz`.

## Responsibilities

- User auth with admin-created users and opaque bearer sessions.
- Computer inventory for cloud and local machines.
- EC2 provisioning and lifecycle operations for cloud machines.
- Machine registration, heartbeat, and release update checks.
- Outbound machine tunnel registry and gateway WebSocket proxying.
- Short-lived computer access sessions for gateway routes.
- Admin dashboard and admin APIs.
- Release manifests for desktop and machine-server updates.

## Local Commands

```sh
pnpm --filter @ank1015-app/cloud-server dev
pnpm --filter @ank1015-app/cloud-server dev:admin-ui
pnpm --filter @ank1015-app/cloud-server build
pnpm --filter @ank1015-app/cloud-server build:admin-ui
pnpm --filter @ank1015-app/cloud-server test
pnpm --filter @ank1015-app/cloud-server typecheck
pnpm --filter @ank1015-app/cloud-server db:migrate
pnpm --filter @ank1015-app/cloud-server test:db
```

`dev:admin-ui` runs Vite on port 5174 and proxies `/admin`, `/auth`, and
`/health` to the cloud server on port 4100. Run `dev` and `dev:admin-ui` in
two terminals to iterate on the React admin SPA.

## Important URLs

- `GET /health`
- `GET /admin-dashboard`
- `POST /auth/login`
- `GET /computers`
- `POST /computers`
- `POST /computers/:computerId/access-session`
- `POST /machines/register`
- `POST /machines/heartbeat`
- `WS /machines/tunnel`
- `WS /gateway/computers/:computerId/filesystem`
- `WS /gateway/computers/:computerId/agent`
- `GET /releases/desktop/latest`
- `GET /releases/machine-server/latest`

## Admin

Admin APIs use `Authorization: Bearer $CLOUD_SERVER_ADMIN_TOKEN`.

```sh
curl -H "authorization: Bearer $CLOUD_SERVER_ADMIN_TOKEN" \
  https://api.heysnap.xyz/admin/overview
```

Open the dashboard SPA:

```text
https://api.heysnap.xyz/admin-dashboard/
```

The admin SPA lives in `packages/cloud-server/admin-ui` (Vite + React + shadcn/ui).
It is built into static assets and served by the Hono server.

## Deployment

Run the manual deploy action:

```sh
gh workflow run deploy-cloud-server.yml --repo ank1015/heysnap --ref main
```

The workflow builds the cloud-server Docker image, pushes it to ECR, runs
Drizzle migrations on the host, and restarts the container through AWS SSM.
