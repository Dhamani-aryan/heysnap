import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CODEX_DEFAULT_MODEL = "gpt-5.5";
const CODEX_GATEWAY_TOKEN_ENV = "ANK1015_CODEX_GATEWAY_TOKEN";

export const ensureCodexUserConfig = async (
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const cloudServerPublicUrl = env.CLOUD_SERVER_PUBLIC_URL?.trim();
  const machineTokenFile = env.ANK1015_MACHINE_TOKEN_FILE?.trim();

  if (
    cloudServerPublicUrl === undefined ||
    cloudServerPublicUrl.length === 0 ||
    machineTokenFile === undefined ||
    machineTokenFile.length === 0
  ) {
    return;
  }

  const home = env.HOME?.trim() || homedir();
  const codexDir = join(home, ".codex");
  const skillsDir = join(codexDir, "skills");
  await mkdir(skillsDir, { recursive: true });
  await chmod(codexDir, 0o700);
  await chmod(skillsDir, 0o755);
  await writeFile(join(codexDir, "config.toml"), renderCodexUserConfig(cloudServerPublicUrl));
  await chmod(join(codexDir, "config.toml"), 0o600);
};

export const renderCodexUserConfig = (cloudServerPublicUrl: string): string => {
  const baseUrl = cloudServerPublicUrl.trim().replace(/\/+$/, "");

  return `model_provider = "azure"
model = "${CODEX_DEFAULT_MODEL}"
approval_policy = "never"
sandbox_mode = "danger-full-access"
include_permissions_instructions = false
include_apps_instructions = false

[features]
# Disable plugin system and plugin cache/sync behavior.
plugins = false
remote_plugin = false
plugin_hooks = false
apps = false
tool_suggest = false
in_app_browser = false
browser_use = false
browser_use_external = false
computer_use = false

[model_providers.azure]
name = "Azure"
base_url = "${baseUrl}/llm/openai/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false

[model_providers.azure.env_http_headers]
"api-key" = "${CODEX_GATEWAY_TOKEN_ENV}"

[skills]
include_instructions = true

[skills.bundled]
enabled = false
`;
};
