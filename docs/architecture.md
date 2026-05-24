# Architecture

This application is a cloud-machine coding-agent platform. A computer is a
cloud VM/EC2 instance created by the control plane and running the machine
server.

The UI selects a computer, receives an authenticated connection for that
computer, and then talks to the filesystem and agent protocols exposed by the
machine server.

## System Shape

```text
Web app / mobile app
  -> Cloud server
       -> control plane
       -> gateway
  -> selected machine server
       -> filesystem
       -> agent harness
       -> execution environment
```

The cloud server is one deployed service at first, but it has two separate
logical responsibilities:

- **Control plane:** users, auth, computer inventory, VM provisioning, lifecycle
  state, ownership checks, and access decisions.
- **Gateway:** authenticated routing from clients to machine servers, including
  WebSocket proxying and tunnel management.

The machine server is the same server on every provisioned computer. It runs on
cloud VMs as a host systemd service.

## Packages

The intended repo boundaries are:

- `apps/web`: browser UI for cloud computers.
- `apps/mobile`: mobile UI for cloud computers.
- `packages/ui`: shared React UI and client-side filesystem/agent protocol
  clients.
- `packages/server`: machine server that runs on each computer.
- `packages/cloud-server`: hosted control-plane and gateway server.

Over time, shared protocol types and API clients can move into a dedicated
shared package if duplication starts to appear.

## Computers

A computer is a persistent environment owned by a user.

Cloud computers are VMs/EC2 instances created by the control plane. They have
persistent disk, a machine identity, a machine server, and an agent harness.
Clients open them through hosted gateway access sessions.

Example computer states:

- `creating`
- `starting`
- `online`
- `idle`
- `sleeping`
- `offline`
- `failed`

The control plane stores the computer record, ownership, status, region, VM
provider metadata, machine-server version, capabilities, and last heartbeat.

## Authentication

The cloud server is the main auth layer.

Users log in to the cloud server. The cloud server issues user sessions or
access tokens. All control-plane operations use this user identity:

- list computers
- create computer
- start, stop, or delete computer
- request access to a computer
- open a gateway session

Machine servers also authenticate to the cloud server, but with machine
identity instead of user identity. A machine identity should be created during
provisioning and installed into the VM as a secret.

There are two important token types:

- **User token:** proves who is using the web or mobile app.
- **Machine token:** proves which machine server is registering, heartbeating,
  or opening a tunnel.

When a user selects a computer, the cloud server checks ownership and returns a
short-lived computer access session. That session is then used by the gateway to
route filesystem and agent traffic to the selected machine.

## VM Creation

Creating a cloud computer should follow this flow:

```text
User requests a new computer
  -> control plane authenticates the user
  -> control plane creates a computer record
  -> provisioning creates the VM/EC2 instance
  -> provisioning installs or starts the machine server
  -> machine server registers with the cloud server
  -> machine server runs setup for its harness/environment
  -> computer becomes online
```

The first version can use predefined machine types, images, regions, and disk
sizes. The control plane should own those defaults so the UI only asks for a
simple computer name and maybe a size preset.

The machine server `setup` step is where the selected harness prepares the
computer. That can include checking the filesystem root, loading auth state,
configuring tools, initializing agent history, and reporting capabilities.

## VM Operations

The control plane should provide operations for the computer lifecycle:

- create a VM
- start a stopped VM
- sleep or stop an idle VM
- restart a VM
- delete a VM and its cloud resources
- refresh status
- rotate machine credentials
- upgrade or restart the machine server

Cloud computers should heartbeat back to the control plane. Heartbeats let the
control plane know whether a machine is online, idle, unhealthy, or disconnected.

Sleep/stop behavior can be based on metrics such as:

- no active gateway sessions
- no active agent runs
- no filesystem or terminal activity
- no heartbeat for a threshold
- user-configured idle timeout

## Machine Server

The machine server is the per-computer runtime. It owns local access to that
computer's filesystem, process execution, agent harness, and workspace state.

The current machine-server protocol starts with:

- `/filesystem`: WebSocket filesystem listing and mutation protocol.
- `/agent`: WebSocket agent thread and run protocol.

Cloud machines should expose the same protocol surface so the UI can switch
between computers without changing behavior.

The machine server should report capabilities to the cloud server. Examples:

- filesystem
- agent
- shell or terminal
- browser automation
- desktop/display control
- port forwarding
- file upload/download
- secrets

Capabilities let the UI and control plane know what a computer can do without
hardcoding cloud-vs-local differences.

## Gateway And Tunneling

The web app should not connect directly to random public ports on VMs. The
gateway should be the single public entrypoint for remote computer access.

Preferred remote shape:

```text
Machine server
  -> opens outbound tunnel to cloud gateway

Browser / mobile client
  -> connects to cloud gateway
  -> gateway authenticates user
  -> gateway checks computer ownership
  -> gateway routes to selected machine tunnel
```

An outbound tunnel means cloud VMs do not need to expose public machine-server
ports. It also gives the product one TLS surface, one auth layer, and one place
to enforce routing rules.

The gateway should proxy WebSocket traffic for:

- filesystem sessions
- agent run streams
- future terminal sessions
- future browser/display streams

The current implementation uses one outbound machine tunnel:

```text
Machine server
  -> wss://api.heysnap.xyz/machines/tunnel

Client
  -> wss://api.heysnap.xyz/gateway/computers/:computerId/filesystem
  -> wss://api.heysnap.xyz/gateway/computers/:computerId/agent
```

Gateway client routes use short-lived access session tokens created by
`POST /computers/:computerId/access-session`.

Each gateway connection should be scoped to:

- user id
- computer id
- session id
- route type, such as filesystem or agent
- short-lived access token or signed claim

If a machine is offline or sleeping, the gateway can ask the control plane to
wake the computer before accepting a routed session.

## Web App Flow

```text
User opens web app
  -> logs in through cloud server
  -> app lists user's computers
  -> user selects a computer
  -> cloud server checks ownership
  -> cloud server creates a computer access session
  -> UI connects to gateway WebSocket routes
  -> gateway routes traffic to the selected machine server
```

From the UI's perspective, selecting a remote VM just provides active
filesystem and agent WebSocket URLs. The shared UI continues using the same
protocol clients.

## Data Ownership

The control plane owns product-level state:

- users
- auth sessions
- computer records
- VM provider metadata
- computer status
- machine identities
- gateway sessions
- billing and quotas later

The machine server owns machine-local state:

- filesystem contents
- local workspace state
- agent runtime state
- machine-local credentials
- process/session state
- logs that should stay on the machine

Some data may be mirrored into the control plane for product UX, such as
computer names, status, last active time, and high-level capability metadata.
The control plane should not need full filesystem contents or agent internals to
route the product.

## Security Rules

Core rules:

- Every control-plane request must authenticate the user.
- Every computer access request must check ownership.
- Every gateway session must be scoped to one user and one computer.
- Machine servers should authenticate with machine identity, not user passwords.
- Cloud machine-server ports should not be publicly exposed.
- Gateway tokens should be short-lived and revocable.
- Machine credentials should be rotatable.
The gateway is the enforcement point for remote access. The machine server is
the enforcement point for machine-local operations.

## Initial Implementation Plan

Start with one hosted `packages/cloud-server` deployment that contains both the
control plane and gateway modules.

The early version can support:

- user login
- list computers
- manually or programmatically create a VM
- machine registration
- machine heartbeat
- gateway WebSocket proxying to one online machine
- short-lived computer access sessions

Keep the control-plane and gateway code separate inside the package so they can
split into different services later if traffic, deployment, or regional routing
requires it.

## Future Split Points

The single cloud server can be split later when there is a concrete reason:

- WebSocket gateway traffic needs independent scaling.
- Long-lived tunnels make deploys disruptive.
- multiple regions are needed.
- provisioning jobs need a worker queue.
- stricter isolation is needed between auth/control APIs and gateway routing.

Until then, one hosted cloud server with clean internal boundaries is the right
starting point.
