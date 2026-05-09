# Cloud Server VM Provisioning

The first VM preset is `dev-8gb`.

Default AWS settings:

```sh
AWS_REGION=ap-south-1
AWS_EC2_INSTANCE_TYPE=t3.large
AWS_EC2_ROOT_VOLUME_GB=80
AWS_MACHINE_AMI_SSM_PARAMETER=/ank1015/machine-images/stable/ami-id
```

The provisioner resolves the machine AMI from `AWS_MACHINE_AMI_SSM_PARAMETER`.
That AMI is built from Ubuntu 24.04 by `infra/machine-image` and contains the
global developer tools Codex should see from bash plus the
`ank1015-machine-bootstrap`, `ank1015-machine-release`, and
`ank1015-machine-heartbeat` commands.

`POST /computers` creates a cloud computer record, creates a one-time machine
bootstrap token, and starts EC2 provisioning. The bootstrap token is stored only
as a hash in Postgres and is passed to the VM through EC2 user-data.

The EC2 instance calls back to:

```text
POST /machines/register
POST /machines/heartbeat
WS /machines/tunnel
```

The cloud server must be deployed at `CLOUD_SERVER_PUBLIC_URL` before a real VM
can register successfully. Do not use `localhost` for real EC2 provisioning.

VM user-data only writes cloud URL, computer id, bootstrap token, release
channel, and machine defaults, then delegates to `ank1015-machine-bootstrap`.
The bootstrap command owns the host paths, systemd units, machine-server
artifact installation, heartbeat, and release updates.

The bootstrap starts two systemd services:

- `ank1015-machine-server.service`: runs the host-installed machine-server
  artifact with Node. It starts Codex directly on the EC2 host, with
  `/workspace` as the filesystem root and `/home/agent` as `HOME`.
- `ank1015-machine-heartbeat.service`: exchanges the bootstrap token for a
  machine token, reports heartbeat and capabilities to the cloud server, checks
  release manifests, and updates the machine-server artifact only when
  `/status.safeToRestart` is true.

Current v1 behavior:

- machine server ports are not opened publicly
- default VPC/subnet behavior is used
- root EBS volume is encrypted gp3, 80 GB, and not deleted on termination
- Docker is installed on the host for developer workflows, but the machine
  server itself does not run in Docker
- EC2 lifecycle routes are available through the protected computer API:
  - `POST /computers/:computerId/start`
  - `POST /computers/:computerId/stop`
  - `POST /computers/:computerId/restart`
  - `DELETE /computers/:computerId`

Machine-server releases are published by `release-machine-server.yml`. The
workflow uploads a tarball to S3 and publishes a release manifest containing
`downloadUrl` and `metadata.sha256`. New VMs install the latest manifest for
their configured release channel. Running VMs receive update state through
heartbeat/release checks, download and verify the tarball, atomically move
`/opt/ank1015/machine-server/current`, and restart the host systemd service
when idle. If the health check fails, the updater rolls back to the previous
release.

The machine instance profile needs permissions for EC2 lifecycle operations,
SSM AMI parameter reads, and any artifact bucket access required by deployment.
The machine server is reached through the cloud gateway, so no public
machine-server inbound port is required.

Gateway access flow:

```text
machine server -> wss://api.heysnap.xyz/machines/tunnel
client         -> wss://api.heysnap.xyz/gateway/computers/:id/filesystem
client         -> wss://api.heysnap.xyz/gateway/computers/:id/agent
```

The gateway routes require a short-lived access session token from:

```text
POST /computers/:computerId/access-session
```
