export interface CloudServerConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly sessionSecret: string;
  readonly sessionTtlSeconds: number;
  readonly computerAccessSessionTtlSeconds: number;
  readonly cloudServerPublicUrl: string;
  readonly awsRegion: string;
  readonly awsEc2InstanceType: string;
  readonly awsEc2RootVolumeGb: number;
  readonly awsMachineAmiSsmParameter: string;
  readonly awsMachineInstanceProfileName: string | undefined;
  readonly computerProvisioner?: "aws" | "docker";
  readonly machineIdleSleepSeconds?: number;
  readonly localDockerMachineImage?: string;
  readonly localDockerNetwork?: string;
  readonly localDockerCloudUrl?: string;
  readonly machineServerChannel: string;
  readonly aiGatewayAzureBaseUrl?: string;
  readonly aiGatewayAzureImagesBaseUrl?: string;
  readonly aiGatewayAzureApiKey?: string;
  readonly aiGatewayCaptureBodies?: boolean;
  readonly aiGatewayCaptureBodyMaxBytes?: number;
  readonly firecrawlBaseUrl?: string;
  readonly firecrawlApiKey?: string;
  readonly feedbackArchiveS3Bucket?: string;
  readonly feedbackArchiveS3Prefix?: string;
  readonly feedbackArchiveLocalDir?: string;
  readonly feedbackArchiveMaxBytes?: number;
  readonly allowedOrigins: readonly string[];
  readonly adminToken: string;
}

const DEFAULT_MACHINE_AMI_SSM_PARAMETER = "/ank1015/machine-images/stable/ami-id";

export const getCloudServerConfig = (
  env: NodeJS.ProcessEnv = process.env,
): CloudServerConfig => ({
  port: parsePositiveInteger(env.PORT, 4100),
  databaseUrl: readRequiredEnv(env, "DATABASE_URL"),
  sessionSecret: readRequiredEnv(env, "SESSION_SECRET"),
  sessionTtlSeconds: parsePositiveInteger(env.SESSION_TTL_SECONDS, 60 * 60 * 24 * 30),
  computerAccessSessionTtlSeconds: parsePositiveInteger(env.COMPUTER_ACCESS_SESSION_TTL_SECONDS, 60 * 10),
  cloudServerPublicUrl: readRequiredEnv(env, "CLOUD_SERVER_PUBLIC_URL"),
  awsRegion: env.AWS_REGION?.trim() || "ap-south-1",
  awsEc2InstanceType: env.AWS_EC2_INSTANCE_TYPE?.trim() || "t3.large",
  awsEc2RootVolumeGb: parsePositiveInteger(env.AWS_EC2_ROOT_VOLUME_GB, 80),
  awsMachineAmiSsmParameter: readOptionalEnv(env, "AWS_MACHINE_AMI_SSM_PARAMETER") ??
    DEFAULT_MACHINE_AMI_SSM_PARAMETER,
  awsMachineInstanceProfileName: readOptionalEnv(env, "AWS_MACHINE_INSTANCE_PROFILE_NAME"),
  computerProvisioner: readComputerProvisioner(env.COMPUTER_PROVISIONER),
  machineIdleSleepSeconds: parseNonNegativeInteger(env.MACHINE_IDLE_SLEEP_SECONDS, 30 * 60),
  localDockerMachineImage: readOptionalEnv(env, "LOCAL_DOCKER_MACHINE_IMAGE"),
  localDockerNetwork: readOptionalEnv(env, "LOCAL_DOCKER_NETWORK"),
  localDockerCloudUrl: readOptionalEnv(env, "LOCAL_DOCKER_CLOUD_URL"),
  machineServerChannel: readOptionalEnv(env, "MACHINE_SERVER_CHANNEL") ?? "stable",
  aiGatewayAzureBaseUrl: readOptionalEnv(env, "AI_GATEWAY_AZURE_BASE_URL"),
  aiGatewayAzureImagesBaseUrl: readOptionalEnv(env, "AI_GATEWAY_AZURE_IMAGES_BASE_URL"),
  aiGatewayAzureApiKey: readOptionalEnv(env, "AI_GATEWAY_AZURE_API_KEY"),
  aiGatewayCaptureBodies: parseBooleanEnv(env.AI_GATEWAY_CAPTURE_BODIES, false),
  aiGatewayCaptureBodyMaxBytes: parsePositiveInteger(env.AI_GATEWAY_CAPTURE_BODY_MAX_BYTES, 262_144),
  firecrawlBaseUrl: readOptionalEnv(env, "FIRECRAWL_BASE_URL"),
  firecrawlApiKey: readOptionalEnv(env, "FIRECRAWL_API_KEY"),
  feedbackArchiveS3Bucket: readOptionalEnv(env, "FEEDBACK_ARCHIVE_S3_BUCKET"),
  feedbackArchiveS3Prefix: readOptionalEnv(env, "FEEDBACK_ARCHIVE_S3_PREFIX"),
  feedbackArchiveLocalDir: readOptionalEnv(env, "FEEDBACK_ARCHIVE_LOCAL_DIR") ?? ".local/feedback-archives",
  feedbackArchiveMaxBytes: parsePositiveInteger(env.FEEDBACK_ARCHIVE_MAX_BYTES, 100 * 1024 * 1024),
  allowedOrigins: parseCsvEnv(env.CLOUD_SERVER_ALLOWED_ORIGINS),
  adminToken: readRequiredEnv(env, "CLOUD_SERVER_ADMIN_TOKEN"),
});

export const getDevelopmentCloudServerConfig = (
  env: NodeJS.ProcessEnv = process.env,
): CloudServerConfig => ({
  port: parsePositiveInteger(env.PORT, 4100),
  databaseUrl: env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ank1015_app",
  sessionSecret: env.SESSION_SECRET ?? "development-session-secret",
  sessionTtlSeconds: parsePositiveInteger(env.SESSION_TTL_SECONDS, 60 * 60 * 24 * 30),
  computerAccessSessionTtlSeconds: parsePositiveInteger(env.COMPUTER_ACCESS_SESSION_TTL_SECONDS, 60 * 10),
  cloudServerPublicUrl: env.CLOUD_SERVER_PUBLIC_URL ?? "http://localhost:4100",
  awsRegion: env.AWS_REGION?.trim() || "ap-south-1",
  awsEc2InstanceType: env.AWS_EC2_INSTANCE_TYPE?.trim() || "t3.large",
  awsEc2RootVolumeGb: parsePositiveInteger(env.AWS_EC2_ROOT_VOLUME_GB, 80),
  awsMachineAmiSsmParameter: env.AWS_MACHINE_AMI_SSM_PARAMETER?.trim() || DEFAULT_MACHINE_AMI_SSM_PARAMETER,
  awsMachineInstanceProfileName: readOptionalEnv(env, "AWS_MACHINE_INSTANCE_PROFILE_NAME"),
  computerProvisioner: readComputerProvisioner(env.COMPUTER_PROVISIONER),
  machineIdleSleepSeconds: parseNonNegativeInteger(env.MACHINE_IDLE_SLEEP_SECONDS, 0),
  localDockerMachineImage: readOptionalEnv(env, "LOCAL_DOCKER_MACHINE_IMAGE"),
  localDockerNetwork: readOptionalEnv(env, "LOCAL_DOCKER_NETWORK"),
  localDockerCloudUrl: readOptionalEnv(env, "LOCAL_DOCKER_CLOUD_URL"),
  machineServerChannel: env.MACHINE_SERVER_CHANNEL?.trim() || "stable",
  aiGatewayAzureBaseUrl: readOptionalEnv(env, "AI_GATEWAY_AZURE_BASE_URL"),
  aiGatewayAzureImagesBaseUrl: readOptionalEnv(env, "AI_GATEWAY_AZURE_IMAGES_BASE_URL"),
  aiGatewayAzureApiKey: readOptionalEnv(env, "AI_GATEWAY_AZURE_API_KEY"),
  aiGatewayCaptureBodies: parseBooleanEnv(env.AI_GATEWAY_CAPTURE_BODIES, true),
  aiGatewayCaptureBodyMaxBytes: parsePositiveInteger(env.AI_GATEWAY_CAPTURE_BODY_MAX_BYTES, 262_144),
  firecrawlBaseUrl: readOptionalEnv(env, "FIRECRAWL_BASE_URL"),
  firecrawlApiKey: readOptionalEnv(env, "FIRECRAWL_API_KEY"),
  feedbackArchiveS3Bucket: readOptionalEnv(env, "FEEDBACK_ARCHIVE_S3_BUCKET"),
  feedbackArchiveS3Prefix: readOptionalEnv(env, "FEEDBACK_ARCHIVE_S3_PREFIX"),
  feedbackArchiveLocalDir: readOptionalEnv(env, "FEEDBACK_ARCHIVE_LOCAL_DIR") ?? ".local/feedback-archives",
  feedbackArchiveMaxBytes: parsePositiveInteger(env.FEEDBACK_ARCHIVE_MAX_BYTES, 100 * 1024 * 1024),
  allowedOrigins: parseCsvEnv(env.CLOUD_SERVER_ALLOWED_ORIGINS, [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]),
  adminToken: env.CLOUD_SERVER_ADMIN_TOKEN?.trim() || "development-admin-token",
});

const readRequiredEnv = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]?.trim();

  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }

  return value;
};

const readOptionalEnv = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name]?.trim();

  return value === undefined || value.length === 0 ? undefined : value;
};

const readComputerProvisioner = (rawValue: string | undefined): "aws" | "docker" | undefined => {
  const value = rawValue?.trim().toLowerCase();

  if (value === undefined || value.length === 0) {
    return undefined;
  }

  if (value === "aws" || value === "docker") {
    return value;
  }

  throw new Error(`Expected COMPUTER_PROVISIONER to be aws or docker, received ${rawValue}`);
};

const parsePositiveInteger = (rawValue: string | undefined, defaultValue: number): number => {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return defaultValue;
  }

  const value = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected positive integer, received ${rawValue}`);
  }

  return value;
};

const parseNonNegativeInteger = (rawValue: string | undefined, defaultValue: number): number => {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return defaultValue;
  }

  const value = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Expected non-negative integer, received ${rawValue}`);
  }

  return value;
};

const parseBooleanEnv = (rawValue: string | undefined, defaultValue: boolean): boolean => {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(rawValue.trim().toLowerCase());
};

const parseCsvEnv = (rawValue: string | undefined, defaultValue: readonly string[] = []): readonly string[] => {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return defaultValue;
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};
