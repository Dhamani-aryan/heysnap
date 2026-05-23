# HeySnap Previewer

Standalone and mountable file preview surface for HeySnap.

## Scripts

- `pnpm --filter @ank1015-app/previewer dev` starts a local playground at `http://127.0.0.1:4719/preview`.
- `PREVIEW_PATH=/absolute/path pnpm --filter @ank1015-app/previewer dev` opens directly to a file.
- `pnpm --filter @ank1015-app/previewer build` builds the client and server bundles.

The package is intentionally independent from `packages/server`. The machine server can mount it later with a root-relative path resolver.
