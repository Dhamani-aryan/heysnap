#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { inherit, spawnInherit } from "./common.mjs";

export const createLocalCloudEnv = () => ({
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/ank1015_app",
  SESSION_SECRET: process.env.SESSION_SECRET || "development-session-secret",
  CLOUD_SERVER_PUBLIC_URL: process.env.CLOUD_SERVER_PUBLIC_URL || "http://localhost:4100",
  CLOUD_SERVER_ADMIN_TOKEN: process.env.CLOUD_SERVER_ADMIN_TOKEN || "development-admin-token",
  CLOUD_SERVER_ALLOWED_ORIGINS: process.env.CLOUD_SERVER_ALLOWED_ORIGINS ||
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:5175,http://127.0.0.1:5175",
  COMPUTER_PROVISIONER: process.env.COMPUTER_PROVISIONER || "docker",
  LOCAL_DOCKER_MACHINE_IMAGE: process.env.LOCAL_DOCKER_MACHINE_IMAGE || "ank1015-machine-local:latest",
  LOCAL_DOCKER_NETWORK: process.env.LOCAL_DOCKER_NETWORK || "ank1015-local",
  LOCAL_DOCKER_CLOUD_URL: process.env.LOCAL_DOCKER_CLOUD_URL || "http://host.docker.internal:4100",
  MACHINE_SERVER_CHANNEL: process.env.MACHINE_SERVER_CHANNEL || "local",
  AI_GATEWAY_CAPTURE_BODIES: process.env.AI_GATEWAY_CAPTURE_BODIES || "true",
});

export const runLocalCloudServer = () => {
  const env = createLocalCloudEnv();
  inherit("pnpm", ["--filter", "@ank1015-app/cloud-server", "db:migrate"], { env });
  spawnInherit("pnpm", ["--filter", "@ank1015-app/cloud-server", "dev"], { env });
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalCloudServer();
}
