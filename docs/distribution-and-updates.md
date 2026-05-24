# Distribution And Updates

This repo has three manual GitHub Actions for deployment and releases.

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

## Machine Server Release

Workflow:

```text
.github/workflows/release-machine-server.yml
```

Run when `packages/server` changes should be shipped to cloud VMs.

```sh
gh workflow run release-machine-server.yml --repo ank1015/heysnap --ref main \
  -f version=0.1.1 \
  -f channel=stable \
  -f notes='Release notes'
```

What it does:

- Runs machine-server typecheck and tests.
- Builds `packages/server`.
- Packages a `linux-x64` host artifact tarball with production runtime
  dependencies and any `packages/server/migrations/*.sh` scripts.
- Uploads the tarball to S3.
- Publishes the cloud release manifest through:
  `POST /admin/releases/machine-server`

Runtime update behavior:

- VM bootstrap installs the latest machine-server manifest for its configured
  release channel, `stable` by default.
- VM heartbeat and release checks receive update info from the cloud-server
  release manifest endpoints.
- `ank1015-machine-release` checks the running machine server's `/status`.
- If `safeToRestart` is true, the machine bootstrap downloads the release tarball,
  verifies `metadata.sha256`, switches `/opt/ank1015/machine-server/current`,
  and restarts `ank1015-machine-server.service`.
- Release migrations from `packages/server/migrations/*.sh` run as root once
  per release version before the machine-server restart.
- If sessions are active, the update is deferred to a later heartbeat.

Required GitHub variables/secrets:

- `AWS_REGION`
- `MACHINE_SERVER_ARTIFACT_BUCKET`
- `MACHINE_SERVER_ARTIFACT_BASE_URL`
- `AWS_MACHINE_SERVER_RELEASE_ROLE_ARN`
- `CLOUD_SERVER_ADMIN_TOKEN`

## Machine Image Build

Workflow:

```text
.github/workflows/build-machine-image.yml
```

Run when the base EC2 developer environment should change:

```sh
gh workflow run build-machine-image.yml --repo ank1015/heysnap --ref main \
  -f channel=stable
```

What it does:

- Builds the Ubuntu 24.04 host AMI with Packer from `infra/machine-image`.
- Installs the global developer tools, Python environment, Docker, and Codex.
- Installs `@ank1015-app/machine-bootstrap` commands into `/usr/local/bin`.
- Runs the AMI validation script.
- Publishes the resulting AMI id to `AWS_MACHINE_AMI_SSM_PARAMETER`.

Required GitHub variables/secrets:

- `AWS_REGION`
- `AWS_MACHINE_AMI_SSM_PARAMETER`
- `AWS_MACHINE_IMAGE_BUILD_ROLE_ARN`

## Current Hosted Release Sources

Machine server:

```text
GET https://api.heysnap.xyz/releases/machine-server/latest?channel=stable&currentVersion=...
```

The admin dashboard shows the release inventory from `/admin/overview`.
