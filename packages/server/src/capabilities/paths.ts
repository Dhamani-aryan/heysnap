import { dirname, join } from "node:path";
import { homedir } from "node:os";

import type { CapabilityPaths } from "./types.js";

export const resolveCapabilityPaths = (env: NodeJS.ProcessEnv = process.env): CapabilityPaths => {
  const isCloudMachine = env.ANK1015_COMPUTER_ID !== undefined || env.ANK1015_MACHINE_TOKEN_FILE !== undefined;
  const userPaths = resolveUserCapabilityPaths(env);
  const capabilitiesRoot = env.ANK1015_CAPABILITIES_ROOT?.trim() ||
    (isCloudMachine ? "/opt/ank1015/agent-capabilities" : dirname(userPaths.stateFile));
  const toolsRoot = env.ANK1015_AGENT_TOOLS_ROOT?.trim() ||
    (isCloudMachine ? "/opt/ank1015/agent-tools" : userPaths.toolsRoot);
  const skillsCatalogDir = env.ANK1015_AGENT_SKILLS_CATALOG_DIR?.trim() ||
    (isCloudMachine ? "/opt/ank1015/agent-skills/catalog" : userPaths.skillsCatalogDir);

  return {
    stateFile: env.ANK1015_CAPABILITIES_STATE_FILE?.trim() || join(capabilitiesRoot, "state.json"),
    toolsRoot,
    toolsBinDir: env.ANK1015_AGENT_TOOLS_BIN_DIR?.trim() || join(toolsRoot, "bin"),
    skillsCatalogDir,
  };
};

export const resolveUserCapabilityPaths = (env: NodeJS.ProcessEnv = process.env): CapabilityPaths => {
  const home = env.HOME?.trim() || homedir();
  const localRoot = join(home, ".ank1015");
  const capabilitiesRoot = join(localRoot, "agent-capabilities");
  const toolsRoot = join(localRoot, "agent-tools");

  return {
    stateFile: join(capabilitiesRoot, "state.json"),
    toolsRoot,
    toolsBinDir: join(toolsRoot, "bin"),
    skillsCatalogDir: join(localRoot, "agent-skills", "catalog"),
  };
};
