# System Wiring

This document explains how the main pieces talk to each other.

## Main Components

```text
apps/web
  -> packages/ui
  -> packages/cloud-server at https://api.heysnap.xyz
  -> gateway WebSockets for remote machines

apps/desktop
  -> packages/ui
  -> packages/cloud-server at https://api.heysnap.xyz
  -> gateway WebSockets for remote machines
  -> embedded packages/server runtime for the local machine

packages/server
  -> runs on cloud VMs
  -> is embedded by Electron for the local machine
  -> exposes the same filesystem and agent WebSocket protocols everywhere
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

Browser and Electron renderer both use bearer tokens. Cookies exist on the
cloud server, but the current UI path uses bearer auth as the primary path.

## Machine Inventory

All machines are `computers` owned by a user.

- `kind: "cloud"`: AWS EC2 VM provisioned by the cloud server.
- `kind: "local"`: user's desktop machine registered by Electron main.

Users see machines through:

```text
GET /computers
```

The shared UI does not branch heavily on local vs cloud. It asks for a selected
machine and then gets filesystem/agent WebSocket URLs.

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

## Local Machine Flow

Electron main owns local machine lifecycle.

```text
Electron starts
  -> starts packages/server in-process from Electron main
  -> local server exposes /filesystem and /agent on 127.0.0.1

User logs in
  -> renderer sends cloud session to Electron main
  -> Electron main calls POST /computers/local
  -> cloud server upserts one local computer for this device
  -> Electron main sends /machines/heartbeat with machine token
```

When the user opens the local machine, the UI uses direct local URLs:

```text
ws://127.0.0.1:<port>/filesystem
ws://127.0.0.1:<port>/agent
```

The local machine is not exposed through the cloud gateway yet.

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
