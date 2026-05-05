# Cloud Server Deployment

The cloud server must be publicly reachable before EC2 machine registration can
work. EC2 user-data calls back to `CLOUD_SERVER_PUBLIC_URL`.

Required production environment:

```sh
NODE_ENV=production
PORT=4100
DATABASE_URL=postgres://...
SESSION_SECRET=...
CLOUD_SERVER_ADMIN_TOKEN=...
CLOUD_SERVER_PUBLIC_URL=https://api.heysnap.xyz
AWS_REGION=ap-south-1
AWS_EC2_INSTANCE_TYPE=t3.large
AWS_EC2_ROOT_VOLUME_GB=80
AWS_MACHINE_INSTANCE_PROFILE_NAME=ank1015-machine-profile
MACHINE_SERVER_IMAGE=001961766272.dkr.ecr.ap-south-1.amazonaws.com/ank1015-machine-server:latest
MACHINE_SERVER_VERSION=latest
```

Build the Docker image from the repo root:

```sh
docker build -f packages/cloud-server/Dockerfile -t ank1015-cloud-server .
docker build -f packages/server/Dockerfile -t ank1015-machine-server .
```

Run migrations before starting a new deployment:

```sh
DATABASE_URL=postgres://... pnpm --filter @ank1015-app/cloud-server db:migrate
```

Run locally with production config:

```sh
docker run --rm -p 4100:4100 \
  -e NODE_ENV=production \
  -e PORT=4100 \
  -e DATABASE_URL=postgres://... \
  -e SESSION_SECRET=... \
  -e CLOUD_SERVER_ADMIN_TOKEN=... \
  -e CLOUD_SERVER_PUBLIC_URL=https://api.heysnap.xyz \
  -e AWS_REGION=ap-south-1 \
  -e AWS_MACHINE_INSTANCE_PROFILE_NAME=ank1015-machine-profile \
  -e MACHINE_SERVER_IMAGE=001961766272.dkr.ecr.ap-south-1.amazonaws.com/ank1015-machine-server:latest \
  ank1015-cloud-server
```

Health check:

```sh
curl https://api.heysnap.xyz/health
```

Create users with the admin token:

```sh
curl -X POST https://api.heysnap.xyz/admin/users \
  -H "authorization: Bearer $CLOUD_SERVER_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"email":"user@example.com","password":"change-me"}'
```

EC2 instances should not expose the machine server publicly. Provisioned
machines use outbound registration, heartbeat, and gateway tunnel connections
from the machine to the cloud server.

## Domain And HTTPS

Use `api.heysnap.xyz` for the cloud-server API. The web app can later use the
apex domain or `app.heysnap.xyz`.

The current AWS deployment can run Caddy on the cloud-server host as the TLS
edge:

```text
api.heysnap.xyz -> Caddy :443 -> cloud server :4100
```

For trusted HTTPS, public DNS must point `api.heysnap.xyz` at the cloud-server
Elastic IP before Caddy can issue a Let's Encrypt certificate. The current
deployment points `api.heysnap.xyz` at `13.205.8.10` and only exposes public
ports `80` and `443`; raw cloud-server port `4100` is private to the host.
