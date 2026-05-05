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
  readonly awsMachineInstanceProfileName: string | undefined;
  readonly machineServerImage: string;
  readonly machineServerVersion: string;
  readonly allowedOrigins: readonly string[];
  readonly adminToken: string;
}

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
  awsMachineInstanceProfileName: readOptionalEnv(env, "AWS_MACHINE_INSTANCE_PROFILE_NAME"),
  machineServerImage: readRequiredEnv(env, "MACHINE_SERVER_IMAGE"),
  machineServerVersion: readOptionalEnv(env, "MACHINE_SERVER_VERSION") ?? "latest",
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
  awsMachineInstanceProfileName: readOptionalEnv(env, "AWS_MACHINE_INSTANCE_PROFILE_NAME"),
  machineServerImage: env.MACHINE_SERVER_IMAGE?.trim() || "ank1015-machine-server:latest",
  machineServerVersion: env.MACHINE_SERVER_VERSION?.trim() || "development",
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

const parseCsvEnv = (rawValue: string | undefined, defaultValue: readonly string[] = []): readonly string[] => {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return defaultValue;
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};
