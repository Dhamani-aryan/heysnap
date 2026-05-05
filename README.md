# ank1015-app

Simple pnpm monorepo with:

- `apps/web`: Next.js app
- `apps/desktop`: Electron app with a Vite React renderer
- `packages/ui`: shared React components
- `packages/server`: small Node server package
- `packages/cloud-server`: hosted Hono control-plane and gateway server skeleton

## Commands

```sh
pnpm install
pnpm dev
pnpm build
pnpm typecheck
```

Cloud server database setup is documented in `docs/cloud-server-db.md`.
Cloud server deployment setup is documented in `docs/cloud-server-deploy.md`.
Cloud VM provisioning is documented in `docs/cloud-server-vms.md`.
