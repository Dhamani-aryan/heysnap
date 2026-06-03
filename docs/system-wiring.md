# System Wiring

This document explains how the main pieces talk to each other.

## Main Components

```text
apps/web
  -> packages/cloud-server at https://api.heysnap.xyz
  -> gateway WebSockets for remote machines

apps/mobile
  -> packages/cloud-server at https://api.heysnap.xyz
  -> gateway WebSockets for remote machines

packages/server
  -> runs on cloud VMs
  -> exposes filesystem and agent WebSocket protocols
```

## Auth Flow

Users are created by an admin, not by public signup.

```text
Admin
  -> POST /admin/users

User
  -> POST /auth/login
  -> receives opaque bearer session token
  -> calls protected cloud APIs with Authorization: Bearer <token>
```

Browser and mobile clients use bearer tokens. Cookies exist on the cloud
server, but the current UI path uses bearer auth as the primary path.

## Machine Inventory

All machines are `computers` owned by a user.

- `kind: "cloud"`: AWS EC2 VM provisioned by the cloud server.

Users see machines through:

```text
GET /computers
```

The web and mobile apps each own their UI and client state. Both ask for a
selected machine and then get filesystem/agent WebSocket URLs.

## Cloud Machine Flow

```text
User creates machine in UI
  -> POST /computers
  -> cloud server creates DB row and machine identity
  -> cloud server starts EC2 instance
  -> EC2 user-data starts host machine server systemd units
  -> VM registers with POST /machines/register
  -> VM heartbeats with POST /machines/heartbeat
  -> VM opens outbound WS /machines/tunnel
```

When a user opens a cloud machine:

```text
UI
  -> POST /computers/:computerId/access-session
  -> receives short-lived access token and gateway paths
  -> connects to /gateway/computers/:computerId/filesystem
  -> connects to /gateway/computers/:computerId/agent
```

The gateway verifies the access token, checks the selected computer, and routes
traffic through the machine's outbound tunnel.

## Machine Server Protocols

`packages/server` exposes:

- `GET /health`: basic process health.
- `GET /status`: version, active session counts, and `safeToRestart`.
- `WS /filesystem`: filesystem listing and mutations.
- `WS /agent`: agent thread retrieval and run streaming.

The `/status` endpoint is important for VM updates. VM supervisors only replace
the machine-server host artifact when `safeToRestart` is true.

## Admin Flow

Admin access uses `CLOUD_SERVER_ADMIN_TOKEN`.

- Dashboard: `https://api.heysnap.xyz/admin-dashboard`
- API prefix: `/admin`

The dashboard is a static HTML page served by the cloud server. It stores the
admin token in browser `localStorage` and calls the protected admin APIs.
