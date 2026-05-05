# Admin And Operations

The cloud server has an admin dashboard and token-protected admin APIs.

## Dashboard

Open:

```text
https://api.heysnap.xyz/admin-dashboard
```

Enter the admin token. The dashboard stores it in browser `localStorage` on
that browser only.

The dashboard can:

- show user, computer, cloud/local, and active-machine counts
- list all users
- create users
- list all computers with owner, status, version, heartbeat, and provider data
- delete computers
- show release manifests

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
