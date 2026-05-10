# @ank1015-app/desktop

Electron desktop app for HeySnap.

The desktop app renders the same shared cloud UI as the web app inside an
Electron shell.

## Responsibilities

- Desktop shell for macOS and Windows.
- Logs in to the configured cloud server and shows cloud machines.
- Opens workspaces through hosted gateway access sessions.
- Checks desktop app updates through cloud release manifests and `electron-updater`.

## Local Development

```sh
pnpm --filter @ank1015-app/desktop dev
```

## Commands

```sh
pnpm --filter @ank1015-app/desktop dev
pnpm --filter @ank1015-app/desktop dev:hosted
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
