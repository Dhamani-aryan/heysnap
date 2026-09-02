#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { AgentCapabilitiesService } from "./service.js";

const DEFAULT_MACHINE_ENV_FILE = "/opt/ank1015/machine.env";

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Capability helper failed");
  process.exit(1);
});

async function main(): Promise<void> {
  loadMachineEnv();
  process.env.ANK1015_CAPABILITIES_HELPER_MODE = "1";
  const [operation, targetId, value] = process.argv.slice(2);
  const service = new AgentCapabilitiesService();
  await service.initialize((progress) => {
    if (progress.message.length > 0) {
      console.error(progress.message);
    }
  });

  switch (operation) {
    case "install-tool":
      await service.installTool(requireTarget(targetId), printProgress);
      return;
    case "update-tool":
      await service.updateTool(requireTarget(targetId), printProgress);
      return;
    case "install-skill":
      await service.installSkill(requireTarget(targetId), printProgress);
      return;
    case "set-skill-active":
      await service.setSkillActive(requireTarget(targetId), value === "true", printProgress);
      return;
    default:
      throw new Error(`Unsupported helper operation: ${operation ?? ""}`);
  }
}

function requireTarget(targetId: string | undefined): string {
  if (targetId === undefined || targetId.length === 0) {
    throw new Error("Capability helper target id is required");
  }

  return targetId;
}

function printProgress(progress: { readonly message: string }): void {
  if (progress.message.length > 0) {
    console.error(progress.message);
  }
}

function loadMachineEnv(): void {
  const envFile = process.env.ANK1015_MACHINE_ENV_FILE?.trim() || DEFAULT_MACHINE_ENV_FILE;
  let contents: string;

  try {
    contents = readFileSync(envFile, "utf8");
  } catch {
    return;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match === null) {
      continue;
    }

    process.env[match[1]] = match[2];
  }
}
