#!/usr/bin/env node
import { artifactsDir, parseJson, removePath, run } from "./common.mjs";

const containerIds = run("docker", [
  "ps",
  "-aq",
  "--filter",
  "label=ank1015:kind=machine",
]).stdout.trim().split(/\s+/).filter(Boolean);

if (containerIds.length > 0) {
  run("docker", ["rm", "-f", ...containerIds], { stdio: "inherit" });
}

const volumeNames = run("docker", [
  "volume",
  "ls",
  "-q",
  "--filter",
  "name=ank1015-workspace-",
]).stdout.trim().split(/\s+/).filter(Boolean);

if (volumeNames.length > 0) {
  run("docker", ["volume", "rm", "-f", ...volumeNames], { stdio: "inherit" });
}

run("docker", ["compose", "-f", "docker-compose.local.yml", "down", "-v"], { stdio: "inherit" });
removePath(artifactsDir);
removePath(".local/release-stage");

const summary = parseJson(JSON.stringify({
  removedMachineContainers: containerIds.length,
  removedWorkspaceVolumes: volumeNames.length,
}), {});

console.log(`Pruned local dev state. Removed ${summary.removedMachineContainers} machine container(s) and ${summary.removedWorkspaceVolumes} workspace volume(s).`);
