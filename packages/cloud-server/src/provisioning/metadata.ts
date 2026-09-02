export interface AwsEc2ProviderMetadata {
  readonly provider: "aws-ec2";
  readonly preset: string;
  readonly region: string;
  readonly instanceId?: string;
  readonly instanceType?: string;
  readonly imageId?: string;
  readonly rootVolumeGb?: number;
  readonly lastAction?: string;
  readonly lastActionAt?: string;
  readonly provisioningError?: string;
  readonly [key: string]: unknown;
}

export const asAwsEc2ProviderMetadata = (value: unknown): AwsEc2ProviderMetadata | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (record["provider"] !== "aws-ec2" || typeof record["region"] !== "string") {
    return null;
  }

  return record as unknown as AwsEc2ProviderMetadata;
};
