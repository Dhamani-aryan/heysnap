#!/usr/bin/env node
import { dockerAvailable, ensureLocalDirs, inherit, machineImage, run } from "./common.mjs";

if (!dockerAvailable()) {
  console.error("Docker is not available. Start Docker Desktop and try again.");
  process.exit(1);
}

ensureLocalDirs();

inherit("docker", [
  "build",
  "-f",
  "infra/machine-container/Dockerfile",
  "-t",
  machineImage,
  ".",
]);

inherit("docker", ["compose", "-f", "docker-compose.local.yml", "up", "-d"]);
inherit("docker", ["compose", "-f", "docker-compose.local.yml", "up", "-d", "--force-recreate", "artifacts"]);

for (let attempt = 0; attempt < 60; attempt += 1) {
  const containerId = run("docker", [
    "compose",
    "-f",
    "docker-compose.local.yml",
    "ps",
    "-q",
    "postgres",
  ]).stdout.trim();
  const status = containerId.length === 0
    ? "missing"
    : run("docker", ["inspect", "-f", "{{.State.Health.Status}}", containerId]).stdout.trim();

  if (status === "healthy") {
    break;
  }

  if (attempt === 59) {
    throw new Error(`Postgres did not become healthy, last status: ${status}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));
}

console.log("Local Docker infra is running.");
console.log("Postgres:  localhost:5432");
console.log("Artifacts: http://localhost:4101");
console.log(`Machine image: ${machineImage}`);
