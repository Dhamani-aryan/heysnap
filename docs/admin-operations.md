# Admin And Operations

The cloud server has an admin dashboard and token-protected admin APIs.

## Dashboard

Open:

```text
https://api.heysnap.xyz/admin-dashboard/
```

The dashboard is a React SPA built from
`packages/cloud-server/admin-ui` and served as static assets by the cloud
server. On first load it shows a login page that takes the cloud-server admin
token. The token is stored in browser `localStorage` on that browser only and
sent as `Authorization: Bearer …` on every `/admin/*` request.

The dashboard can:

- show user, machine, cloud/local, active, idle, and failed counts
- list all users with computer counts; create users; reset a user's password;
  revoke all of a user's sessions; delete a user (terminates their cloud
  machines and removes the record)
- drill into a user to see their machines and active sessions
- list all machines with kind, status, owner, heartbeat, version, region, and
  live-tunnel state
- drill into a machine to see provider metadata, capabilities, machine
  identities (with revoke), and recent gateway access sessions; rename, start,
  stop, restart, or delete the machine
- publish and delete release manifests for desktop and machine-server

## Admin Token

Admin APIs require:

```text
Authorization: Bearer <CLOUD_SERVER_ADMIN_TOKEN>
```

Local secret file used during development and automation:

```text
.secrets/cloud-server-admin-token
```

This file is ignored by git.

## Create A User

```sh
ADMIN_TOKEN="$(cat .secrets/cloud-server-admin-token)"

curl -X POST https://api.heysnap.xyz/admin/users \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"email":"user@example.com","password":"change-me"}'
```

## Inspect Admin Overview

```sh
ADMIN_TOKEN="$(cat .secrets/cloud-server-admin-token)"

curl https://api.heysnap.xyz/admin/overview \
  -H "authorization: Bearer $ADMIN_TOKEN"
```

## Delete A Computer

```sh
ADMIN_TOKEN="$(cat .secrets/cloud-server-admin-token)"

curl -X DELETE https://api.heysnap.xyz/admin/computers/<computer-id> \
  -H "authorization: Bearer $ADMIN_TOKEN"
```

For EC2-backed computers, deletion first calls the provisioner terminate path
and then removes the DB record. Local computer records are removed from the DB.

## Create A Cloud Computer As A User

```sh
TOKEN="user-session-token"

curl -X POST https://api.heysnap.xyz/computers \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"Dev VM"}'
```

## Check Service Health

```sh
curl https://api.heysnap.xyz/health
```

## Common GitHub Actions

Deploy cloud server:

```sh
gh workflow run deploy-cloud-server.yml --repo ank1015/heysnap --ref main
```

Deploy web app:

```sh
gh workflow run deploy-web.yml --repo ank1015/heysnap --ref main
```

Release desktop app:

```sh
gh workflow run release-desktop.yml --repo ank1015/heysnap --ref main \
  -f version=0.1.1 \
  -f channel=stable \
  -f notes='Release notes'
```

Release machine server:

```sh
gh workflow run release-machine-server.yml --repo ank1015/heysnap --ref main \
  -f version=0.1.1 \
  -f channel=stable \
  -f notes='Release notes'
```
