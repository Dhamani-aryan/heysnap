#!/usr/bin/env node
import { machineContainerName, readComputerIdArg, spawnInherit } from "./common.mjs";

const computerId = readComputerIdArg("Usage: pnpm dev:local:shell -- <computerId>");

spawnInherit("docker", ["exec", "-it", machineContainerName(computerId), "bash"]);
