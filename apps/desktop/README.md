# @ank1015-app/desktop

Electron desktop app for HeySnap.

The desktop app renders the same shared cloud UI as the web app, but also owns
the local machine integration. The local machine server runs as a Docker
sidecar managed by Electron main, not as an in-process server.

## Responsibilities

- Desktop shell for macOS and Windows.
- Logs in to `https://api.heysnap.xyz` and shows cloud machines.
- Registers the local machine as a cloud inventory record.
- Starts/stops the local machine-server Docker sidecar.
- Opens local workspaces through direct `ws://127.0.0.1:<port>` URLs.
- Opens cloud workspaces through hosted gateway access sessions.
- Checks desktop app updates through cloud release manifests and `electron-updater`.

## Local Development

Docker Desktop must be running. Build the local sidecar image once before
starting Electron:

```sh
pnpm --filter @ank1015-app/server docker:build
pnpm --filter @ank1015-app/desktop dev
```

The sidecar image defaults to `ank1015-machine-server:development`.

## Commands

```sh
pnpm --filter @ank1015-app/desktop dev
pnpm --filter @ank1015-app/desktop build
pnpm --filter @ank1015-app/desktop typecheck
pnpm --filter @ank1015-app/desktop dist:mac:arm64
pnpm --filter @ank1015-app/desktop dist:win:x64
```

## Distribution

Run the manual desktop release action:

```sh
gh workflow run release-desktop.yml --repo ank1015/heysnap --ref main \
  -f version=0.1.1 \
  -f channel=stable \
  -f notes='Release notes'
```

The action builds macOS arm64 and Windows x64 installers, uploads them to S3,
and updates the cloud-server desktop latest-version manifests.
