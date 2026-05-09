# @ank1015-app/web

Next.js web app for the hosted HeySnap product.

The web app renders the shared cloud UI from `@ank1015-app/ui`. Users log in
against the hosted cloud server, view `My Machines`, create cloud machines, and
open remote machine workspaces through the cloud gateway.

## Responsibilities

- Browser entrypoint for cloud users at `app.heysnap.xyz`.
- Uses `NEXT_PUBLIC_CLOUD_SERVER_URL`; runtime defaults to `https://api.heysnap.xyz`,
  while `dev` points at `http://localhost:4100`.
- Uses bearer session tokens stored in browser `localStorage`.
- Does not talk directly to VM machine servers.
- Opens remote workspaces with gateway WebSocket URLs returned by the cloud server.

## Commands

```sh
pnpm --filter @ank1015-app/web dev
pnpm --filter @ank1015-app/web dev:hosted
pnpm --filter @ank1015-app/web build
pnpm --filter @ank1015-app/web typecheck
```

## Deployment

The web app is hosted on AWS Amplify. Run the manual GitHub Action:

```sh
gh workflow run deploy-web.yml --repo ank1015/heysnap --ref main
```

See `docs/distribution-and-updates.md` for the full deploy flow.
