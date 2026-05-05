# Distribution And Updates

This repo has four manual GitHub Actions for deployment and releases.

## Web App Deploy

Workflow:

```text
.github/workflows/deploy-web.yml
```

Run when `apps/web` or shared UI changes should be published to
`app.heysnap.xyz`.

```sh
gh workflow run deploy-web.yml --repo ank1015/heysnap --ref main
```

What it does:

- Assumes `AWS_WEB_DEPLOY_ROLE_ARN`.
- Starts an AWS Amplify release job.
- Waits for the Amplify job to finish.

Required GitHub variables/secrets:

- `AWS_REGION`
- `AMPLIFY_WEB_APP_ID`
- `AMPLIFY_WEB_BRANCH`
- `AWS_WEB_DEPLOY_ROLE_ARN`

## Cloud Server Deploy

Workflow:

```text
.github/workflows/deploy-cloud-server.yml
```

Run when `packages/cloud-server` changes should be published to
`https://api.heysnap.xyz`.

```sh
gh workflow run deploy-cloud-server.yml --repo ank1015/heysnap --ref main
```

What it does:

- Installs dependencies.
- Runs cloud-server typecheck and tests.
- Builds the cloud-server Docker image.
- Pushes the image to ECR with `$GITHUB_SHA` and `latest` tags.
- Uses AWS SSM to run migrations on the cloud-server host.
- Replaces the `ank1015-cloud-server` container.

Required GitHub variables/secrets:

- `AWS_REGION`
- `CLOUD_SERVER_IMAGE_URI`
- `CLOUD_SERVER_INSTANCE_ID`
- `AWS_CLOUD_SERVER_DEPLOY_ROLE_ARN`

## Desktop App Release

Workflow:

```text
.github/workflows/release-desktop.yml
```

Run when a new installable Electron app version should be published.

```sh
gh workflow run release-desktop.yml --repo ank1015/heysnap --ref main \
  -f version=0.1.1 \
  -f channel=stable \
  -f notes='Release notes'
```

What it does:

- Builds macOS arm64 on `macos-latest`.
- Builds Windows x64 on `windows-latest`.
- Uploads artifacts to S3 under:
  `desktop/<channel>/<version>/<platform>/`
- Publishes cloud release manifests through:
  `POST /admin/releases/desktop`

Runtime update behavior:

- Electron checks `GET /releases/desktop/latest`.
- If a newer version exists, the app shows the update prompt.
- In packaged builds, `electron-updater` downloads from the generic feed URL.
- In dev mode, the update action opens the release download URL.

Required GitHub variables/secrets:

- `AWS_REGION`
- `DESKTOP_DOWNLOAD_BUCKET`
- `DESKTOP_DOWNLOAD_BASE_URL`
- `AWS_DESKTOP_RELEASE_ROLE_ARN`
- `CLOUD_SERVER_ADMIN_TOKEN`

## Machine Server Release

Workflow:

```text
.github/workflows/release-machine-server.yml
```

Run when `packages/server` changes should be shipped to cloud VMs and Electron
local sidecars.

```sh
gh workflow run release-machine-server.yml --repo ank1015/heysnap --ref main \
  -f version=0.1.1 \
  -f channel=stable \
  -f notes='Release notes'
```

What it does:

- Runs machine-server typecheck and tests.
- Builds a multi-arch Docker image for `linux/amd64` and `linux/arm64`.
- Pushes the image to ECR with `<version>` and `<channel>` tags.
- Publishes the cloud release manifest through:
  `POST /admin/releases/machine-server`

Runtime update behavior:

- VM heartbeat loop receives update info from `POST /machines/heartbeat`.
- Electron main receives update info from local-machine heartbeat responses.
- Both check the running machine server's `/status`.
- If `safeToRestart` is true, the supervisor pulls the new Docker image and
  restarts the container.
- If sessions are active, the update is deferred to a later heartbeat.

Required GitHub variables/secrets:

- `AWS_REGION`
- `MACHINE_SERVER_IMAGE_URI`
- `AWS_MACHINE_SERVER_RELEASE_ROLE_ARN`
- `CLOUD_SERVER_ADMIN_TOKEN`

## Current Hosted Release Sources

Desktop:

```text
GET https://api.heysnap.xyz/releases/desktop/latest?platform=darwin-arm64&channel=stable&currentVersion=...
GET https://api.heysnap.xyz/releases/desktop/latest?platform=win32-x64&channel=stable&currentVersion=...
```

Machine server:

```text
GET https://api.heysnap.xyz/releases/machine-server/latest?channel=stable&currentVersion=...
```

The admin dashboard shows the release inventory from `/admin/overview`.
