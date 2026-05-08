#!/usr/bin/env node
import { AgentCapabilitiesService } from "./service.js";

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Capability helper failed");
  process.exit(1);
});

async function main(): Promise<void> {
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
