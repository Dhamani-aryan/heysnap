#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  adminHeaders,
  artifactsDir,
  inherit,
  localCloudUrl,
  repoRoot,
  run,
} from "./common.mjs";

export const createLocalReleasePlan = (env = process.env, now = new Date()) => {
  const timestamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  const version = env.LOCAL_MACHINE_SERVER_VERSION || `0.0.0-local.${timestamp}`;
  const channel = env.MACHINE_SERVER_CHANNEL || "local";
  const platform = env.LOCAL_MACHINE_SERVER_MANIFEST_PLATFORM || "default";
  const artifactPlatform = env.LOCAL_MACHINE_SERVER_PLATFORM || "linux-x64";
  const artifactName = `machine-server-${version}-${artifactPlatform}.tar.gz`;
  const artifactRelativeDir = join("machine-server", channel, version);
  const artifactDir = join(artifactsDir, artifactRelativeDir);
  const stageDir = resolve(repoRoot, ".local", "release-stage", version);
  const archivePath = join(artifactDir, artifactName);
  const artifactBaseUrl = env.LOCAL_ARTIFACT_BASE_URL || "http://host.docker.internal:4101";
  const downloadUrl = `${artifactBaseUrl}/machine-server/${channel}/${version}/${artifactName}`;

  return {
    version,
    channel,
    platform,
    artifactPlatform,
    artifactName,
    artifactDir,
    stageDir,
    archivePath,
    downloadUrl,
  };
};

export const createManifestPayload = (plan, artifact) => ({
  channel: plan.channel,
  platform: plan.platform,
  version: plan.version,
  downloadUrl: plan.downloadUrl,
  notes: "Local machine-server development release",
  metadata: {
    sha256: artifact.sha256,
    artifactName: plan.artifactName,
    sizeBytes: artifact.sizeBytes,
    local: true,
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const publishManifestWithRetry = async (payload) => {
  let lastError;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`${localCloudUrl}/admin/releases/machine-server`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify(payload),
      });
      const body = await response.text();

      if (response.ok) {
        return body;
      }

      lastError = new Error(`Failed to publish local release (${response.status}): ${body}`);
      if (response.status < 500) {
        throw lastError;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(500 * attempt);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

export const runLocalReleasePublisher = async () => {
  const plan = createLocalReleasePlan();

  inherit("pnpm", ["--filter", "@ank1015-app/server", "build"]);

  rmSync(plan.stageDir, { recursive: true, force: true });
  mkdirSync(plan.stageDir, { recursive: true });
  mkdirSync(plan.artifactDir, { recursive: true });

  cpSync(resolve(repoRoot, "packages/server/package.json"), join(plan.stageDir, "package.json"));
  cpSync(resolve(repoRoot, "packages/server/dist"), join(plan.stageDir, "dist"), { recursive: true });
  cpSync(resolve(repoRoot, "packages/server/skills"), join(plan.stageDir, "skills"), { recursive: true });
  const migrationsDir = resolve(repoRoot, "packages/server/migrations");
  if (existsSync(migrationsDir)) {
    cpSync(migrationsDir, join(plan.stageDir, "migrations"), { recursive: true });
  }

  run("npm", ["install", "--omit=dev", "--ignore-scripts", "--prefix", plan.stageDir], { stdio: "inherit" });
  run("tar", ["-czf", plan.archivePath, "-C", plan.stageDir, "."], { stdio: "inherit" });

  const archive = readFileSync(plan.archivePath);
  const artifact = {
    sha256: createHash("sha256").update(archive).digest("hex"),
    sizeBytes: archive.byteLength,
  };
  const payload = createManifestPayload(plan, artifact);

  const body = await publishManifestWithRetry(payload);

  console.log(`Published ${plan.version} to ${localCloudUrl} (${plan.channel})`);
  console.log(`Artifact: ${plan.archivePath}`);
  console.log(`Download URL inside containers: ${plan.downloadUrl}`);
  console.log(body);
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalReleasePublisher().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
