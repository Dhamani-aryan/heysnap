# Local Docker Machine Development

This workflow runs the cloud-server on the host and provisions Docker
containers as cloud machines. It keeps the production boundaries intact:
cloud-server owns users, computers, lifecycle, and gateway; machine-bootstrap
owns host setup, registration, heartbeat, and release updates; machine-server
owns filesystem, agent, and capabilities.

## Topology

```text
Host:
  cloud-server dev server        http://localhost:4100
  web dev server                 http://localhost:3000
  desktop dev app                Electron
  artifact publisher             pnpm dev:local:release

Docker:
  postgres                       localhost:5432
  artifact static server         localhost:4101
  machine containers             ank1015-machine-<computerId>
```

Machine containers call the host through `http://host.docker.internal:*`.

## First Run

Run the full local stack with one command:

```sh
pnpm dev:local
```

This starts Docker infra, runs cloud-server migrations, starts cloud-server,
creates or resets `dev@example.com` with password `dev123`, publishes a local
machine-server release, and starts the web and admin dev servers.

The web app is available at:

```text
http://localhost:3000
```

You can also run each long-lived process in its own terminal:

```sh
pnpm dev:local:infra
pnpm dev:local:cloud
pnpm dev:local:release
pnpm dev:local:web
pnpm dev:local:admin
```

Then create a cloud machine in the local web app. The local cloud-server will
create a container with `COMPUTER_PROVISIONER=docker`, pass it the bootstrap
identity/config contract, and the container will install the latest
`machine-server` release from the `local` channel.

Desktop development uses the local cloud URL by default:

```sh
pnpm dev:local:desktop
```

To point web or desktop dev at hosted instead:

```sh
pnpm --filter @ank1015-app/web dev:hosted
pnpm --filter @ank1015-app/desktop dev:hosted
```

## Local Release Loop

After changing `packages/server`, publish a fresh local release:

```sh
pnpm dev:local:release
```

The script builds `packages/server`, creates a Linux tarball with `dist`,
`skills`, `package.json`, and production dependencies, copies it under
`.local/artifacts/machine-server/local/<version>/`, computes `sha256`, and
publishes a `channel=local` manifest to the local cloud-server using
`development-admin-token`.

New machine containers install the latest local release during bootstrap.
Existing local containers pick up release changes through heartbeat/update
checks.

## Observability

```sh
pnpm dev:local:status -- <computerId>
pnpm dev:local:logs -- <computerId>
pnpm dev:local:shell -- <computerId>
```

Useful manual commands:

```sh
docker ps --filter label=ank1015:kind=machine
docker logs -f ank1015-machine-<computerId>
docker exec -it ank1015-machine-<computerId> bash
cat /opt/ank1015/machine.env
cat /opt/ank1015/machine-update-state
curl http://127.0.0.1:4000/status
```

## Cleanup

Stop local infra and machine containers:

```sh
pnpm dev:local:down
```

Remove machine containers, workspace volumes, Postgres volume, and local
artifacts:

```sh
pnpm dev:local:prune
```

## Defaults

- `COMPUTER_PROVISIONER=docker`
- `LOCAL_DOCKER_MACHINE_IMAGE=ank1015-machine-local:latest`
- `LOCAL_DOCKER_NETWORK=ank1015-local`
- `LOCAL_DOCKER_CLOUD_URL=http://host.docker.internal:4100`
- `MACHINE_SERVER_CHANNEL=local`
- `CLOUD_SERVER_ADMIN_TOKEN=development-admin-token`
