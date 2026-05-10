import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CODEX_USER_INSTRUCTIONS,
  ensureCodexUserConfig,
  renderCodexUserConfig,
} from "../src/agent/harnesses/codex/config.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex user config", () => {
  it("renders the managed cloud machine Codex config", () => {
    expect(renderCodexUserConfig("https://cloud.example.com/")).toBe(`model_provider = "azure"
model = "gpt-5.5"
approval_policy = "never"
sandbox_mode = "danger-full-access"
include_permissions_instructions = false
include_apps_instructions = false
instructions = ${JSON.stringify(CODEX_USER_INSTRUCTIONS)}

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
base_url = "https://cloud.example.com/llm/openai/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false

[model_providers.azure.env_http_headers]
"api-key" = "ANK1015_CODEX_GATEWAY_TOKEN"

[skills]
include_instructions = true

[skills.bundled]
enabled = false
`);
  });

  it("writes config and creates Codex directories for cloud machines", async () => {
    const home = await createTempRoot();
    await ensureCodexUserConfig(cloudMachineEnv(home));

    expect(await readFile(join(home, ".codex", "config.toml"), "utf8"))
      .toBe(renderCodexUserConfig("https://cloud.example.com"));
    expect((await stat(join(home, ".codex"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(home, ".codex", "skills"))).mode & 0o777).toBe(0o755);
    expect((await stat(join(home, ".codex", "config.toml"))).mode & 0o777).toBe(0o600);
  });

  it("does not write local user config when cloud machine env is absent", async () => {
    const home = await createTempRoot();
    await ensureCodexUserConfig({ HOME: home });

    await expect(access(join(home, ".codex", "config.toml"))).rejects.toThrow();
  });

  it("overwrites stale managed config on startup", async () => {
    const home = await createTempRoot();
    await mkdir(join(home, ".codex"), { recursive: true });
    await writeFile(join(home, ".codex", "config.toml"), "stale config");

    await ensureCodexUserConfig(cloudMachineEnv(home));

    expect(await readFile(join(home, ".codex", "config.toml"), "utf8"))
      .toBe(renderCodexUserConfig("https://cloud.example.com"));
  });
});

const createTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ank1015-codex-config-"));
  tempRoots.push(root);
  return root;
};

const cloudMachineEnv = (home: string): NodeJS.ProcessEnv => ({
  HOME: home,
  CLOUD_SERVER_PUBLIC_URL: "https://cloud.example.com",
  ANK1015_MACHINE_TOKEN_FILE: "/opt/ank1015/machine-token",
});
