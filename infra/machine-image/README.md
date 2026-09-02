# Machine Image

This folder builds the host-based EC2 developer image used by cloud machines.
The image is a normal Ubuntu 24.04 machine with the global tools Codex should
see from bash. It also installs `@ank1015-app/machine-bootstrap` commands into
`/usr/local/bin`; the cloud server passes only identity/config through
user-data and the bootstrap command owns VM host setup.

## Build

```sh
packer init infra/machine-image
packer build \
  -var "aws_region=${AWS_REGION:-ap-south-1}" \
  -var "channel=stable" \
  infra/machine-image
```

The build runs `scripts/install-dev-tools.sh` and then
`scripts/validate-dev-tools.sh`. The manifest is written to:

```text
infra/machine-image/manifest.json
```

## Publish The AMI ID

```sh
AWS_REGION=ap-south-1 \
AWS_MACHINE_AMI_SSM_PARAMETER=/ank1015/machine-images/stable/ami-id \
infra/machine-image/scripts/publish-ami-ssm.sh
```

`packages/cloud-server` reads `AWS_MACHINE_AMI_SSM_PARAMETER` when provisioning
new cloud computers.
