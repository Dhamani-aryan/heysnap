#!/usr/bin/env node
import { parseJson, run } from "./common.mjs";

const containerIds = run("docker", [
  "ps",
  "-aq",
  "--filter",
  "label=ank1015:kind=machine",
]).stdout.trim().split(/\s+/).filter(Boolean);

if (containerIds.length > 0) {
  run("docker", ["rm", "-f", ...containerIds], { stdio: "inherit" });
}

run("docker", ["compose", "-f", "docker-compose.local.yml", "down"], { stdio: "inherit" });

const summary = parseJson(JSON.stringify({ removedMachineContainers: containerIds.length }), {});
console.log(`Stopped local infra. Removed ${summary.removedMachineContainers} machine container(s).`);
