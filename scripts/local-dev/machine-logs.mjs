#!/usr/bin/env node
import { machineContainerName, readComputerIdArg, spawnInherit } from "./common.mjs";

const computerId = readComputerIdArg("Usage: pnpm dev:local:logs -- <computerId>");

spawnInherit("docker", ["logs", "-f", machineContainerName(computerId)]);
