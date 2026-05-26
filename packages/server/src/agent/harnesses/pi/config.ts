import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { PI_SYSTEM_PROMPT } from "./system-prompt.js";

export const PI_DEFAULT_PROVIDER = "anthropic";
export const PI_DEFAULT_MODEL = "claude-sonnet-4-6";
export const PI_ALLOWED_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-7",
] as const;

export interface PiUserConfigInput {
  readonly home: string;
  readonly anthropicBaseUrl: string;
  readonly anthropicApiKey: string;
  readonly model?: string;
}

export const ensurePiUserConfig = async (
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

  await writePiUserConfig({
    home: env.HOME?.trim() || homedir(),
    anthropicBaseUrl: renderPiAnthropicGatewayBaseUrl(cloudServerPublicUrl),
    anthropicApiKey: `!cat ${shellQuote(machineTokenFile)}`,
  });
};

export const writePiUserConfig = async (input: PiUserConfigInput): Promise<void> => {
  const piRootDir = join(input.home, ".pi");
  const agentDir = join(piRootDir, "agent");
  const sessionsDir = join(agentDir, "sessions");

  await mkdir(sessionsDir, { recursive: true });
  await chmod(piRootDir, 0o700);
  await chmod(agentDir, 0o700);
  await chmod(sessionsDir, 0o700);
  await writeFile(join(agentDir, "settings.json"), renderPiSettings(input.model));
  await chmod(join(agentDir, "settings.json"), 0o600);
  await writeFile(join(agentDir, "models.json"), renderPiModels(input.anthropicBaseUrl));
  await chmod(join(agentDir, "models.json"), 0o600);
  await writeFile(join(agentDir, "auth.json"), renderPiAuth(input.anthropicApiKey));
  await chmod(join(agentDir, "auth.json"), 0o600);
  await writeFile(join(agentDir, "SYSTEM.md"), PI_SYSTEM_PROMPT);
  await chmod(join(agentDir, "SYSTEM.md"), 0o600);
};

export const renderPiSettings = (model = PI_DEFAULT_MODEL): string =>
  `${JSON.stringify({
    defaultProvider: PI_DEFAULT_PROVIDER,
    defaultModel: model,
    defaultThinkingLevel: "medium",
    enabledModels: [...PI_ALLOWED_MODELS],
    sessionDir: "sessions",
    enableInstallTelemetry: false,
    quietStartup: true,
    warnings: {
      anthropicExtraUsage: false,
    },
    compaction: {
      enabled: true,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000,
    },
  }, null, 2)}\n`;

export const renderPiModels = (anthropicBaseUrl: string): string =>
  `${JSON.stringify({
    providers: {
      anthropic: {
        baseUrl: normalizePiAnthropicBaseUrl(anthropicBaseUrl),
        api: "anthropic-messages",
      },
    },
  }, null, 2)}\n`;

export const renderPiAuth = (anthropicApiKey: string): string =>
  `${JSON.stringify({
    anthropic: {
      type: "api_key",
      key: anthropicApiKey,
    },
  }, null, 2)}\n`;

export const renderPiAnthropicGatewayBaseUrl = (cloudServerPublicUrl: string): string =>
  `${cloudServerPublicUrl.trim().replace(/\/+$/, "")}/llm/anthropic`;

export const normalizePiAnthropicBaseUrl = (anthropicBaseUrl: string): string => {
  const baseUrl = anthropicBaseUrl.trim().replace(/\/+$/, "");

  return baseUrl.endsWith("/llm/anthropic")
    ? baseUrl
    : `${baseUrl}/llm/anthropic`;
};

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;
