# Cloud Server VM Provisioning

The first VM preset is `dev-8gb`.

Default AWS settings:

```sh
AWS_REGION=ap-south-1
AWS_EC2_INSTANCE_TYPE=t3.large
AWS_EC2_ROOT_VOLUME_GB=80
```

The provisioner resolves the Ubuntu 24.04 amd64 AMI from this public SSM
parameter:

```sh
/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id
```

`POST /computers` now creates a cloud computer record, creates a one-time
machine bootstrap token, and starts EC2 provisioning. The bootstrap token is
stored only as a hash in Postgres and is passed to the VM through EC2 user-data.

The EC2 instance calls back to:

```text
POST /machines/register
POST /machines/heartbeat
WS /machines/tunnel
```

The cloud server must be deployed at `CLOUD_SERVER_PUBLIC_URL` before a real VM
can register successfully. Do not use `localhost` for real EC2 provisioning.

VM user-data starts two systemd services:

- `ank1015-machine-server.service`: pulls and runs the configured machine-server
  Docker image on the VM. The machine server waits for the machine token file
  and then opens the outbound gateway tunnel.
- `ank1015-machine-heartbeat.service`: exchanges the bootstrap token for a
  machine token, reports heartbeat and capabilities to the cloud server, checks
  release manifests, and restarts the machine-server container only when
  `/status.safeToRestart` is true.

Current v1 behavior:

- machine server ports are not opened publicly
- default VPC/subnet behavior is used
- root EBS volume is encrypted gp3, 80 GB, and not deleted on termination
- EC2 lifecycle routes are available through the protected computer API:
  - `POST /computers/:computerId/start`
  - `POST /computers/:computerId/stop`
  - `POST /computers/:computerId/restart`
  - `DELETE /computers/:computerId`

The initial machine-server image is configured with:

```sh
MACHINE_SERVER_IMAGE=001961766272.dkr.ecr.ap-south-1.amazonaws.com/ank1015-machine-server:stable
MACHINE_SERVER_VERSION=stable
AWS_MACHINE_INSTANCE_PROFILE_NAME=ank1015-machine-profile
```

Machine-server releases are published by `release-machine-server.yml`. After a
release, heartbeats receive the latest manifest and the host-side supervisor
pulls the versioned image when the machine is idle.

For `stable` releases, the same workflow also updates the cloud-server host's
machine-server defaults and recreates the cloud-server container. New VMs then
boot directly from the released versioned image instead of waiting for their
first heartbeat update.

The machine instance profile only needs ECR read access for this step. The
machine server is reached through the cloud gateway, so no public machine-server
inbound port is required.

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
