#!/usr/bin/env bash
set -euo pipefail

MANIFEST_PATH="${1:-infra/machine-image/manifest.json}"
PARAMETER_NAME="${AWS_MACHINE_AMI_SSM_PARAMETER:-/ank1015/machine-images/stable/ami-id}"
AWS_REGION="${AWS_REGION:-ap-south-1}"

AMI_ID="$(jq -r '.builds[-1].artifact_id | split(":")[-1]' "$MANIFEST_PATH")"

if [ -z "$AMI_ID" ] || [ "$AMI_ID" = "null" ]; then
  echo "Could not read AMI id from $MANIFEST_PATH" >&2
  exit 1
fi

aws ssm put-parameter \
  --region "$AWS_REGION" \
  --name "$PARAMETER_NAME" \
  --type String \
  --value "$AMI_ID" \
  --overwrite

printf 'Published %s to %s in %s\n' "$AMI_ID" "$PARAMETER_NAME" "$AWS_REGION"
