import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const localDir = resolve(repoRoot, ".local");
export const artifactsDir = resolve(localDir, "artifacts");
export const machineImage = process.env.LOCAL_DOCKER_MACHINE_IMAGE || "ank1015-machine-local:latest";
export const machineNetwork = process.env.LOCAL_DOCKER_NETWORK || "ank1015-local";
export const localCloudUrl = process.env.LOCAL_CLOUD_SERVER_URL || "http://localhost:4100";
export const localAdminToken = process.env.LOCAL_CLOUD_ADMIN_TOKEN ||
  process.env.CLOUD_SERVER_ADMIN_TOKEN ||
  "development-admin-token";

export const getLanAddress = () => {
  const interfaces = networkInterfaces();
  const candidates = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        candidates.push({ name, address: entry.address });
      }
    }
  }

  const isVirtual = (name) => /^(awdl|bridge|docker|llw|lo|tailscale|utun|veth|zt)/i.test(name);
  const preferred = candidates.find(({ name }) => !isVirtual(name) && /^(ap|en|eth|usb|wl)/i.test(name));
  const fallback = candidates.find(({ name }) => !isVirtual(name)) ?? candidates[0];

  return preferred?.address ?? fallback?.address ?? null;
};

export const getLocalMobileCloudUrl = (env = process.env) => {
  const override = env.LOCAL_MOBILE_CLOUD_SERVER_URL;

  if (override) {
    return override;
  }

  const lanAddress = getLanAddress();
  const baseUrl = env.LOCAL_CLOUD_SERVER_URL || localCloudUrl;

  if (!lanAddress) {
    return baseUrl;
  }

  try {
    const url = new URL(baseUrl);
    url.hostname = lanAddress;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return `http://${lanAddress}:4100`;
  }
};

export const createLocalMobileEnv = (env = process.env) => ({
  ...env,
  EXPO_PUBLIC_CLOUD_SERVER_URL: getLocalMobileCloudUrl(env),
});

export const machineContainerName = (computerId) => `ank1015-machine-${computerId}`;
export const machineWorkspaceVolume = (computerId) => `ank1015-workspace-${computerId}`;
export const readComputerIdArg = (usage) => {
  const computerId = process.argv.slice(2).filter((arg) => arg !== "--")[0];

  if (!computerId) {
    console.error(usage);
    process.exit(2);
  }

  return computerId;
};

export const ensureLocalDirs = () => {
  mkdirSync(artifactsDir, { recursive: true });
};

export const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${detail ? `\n${detail}` : ""}`);
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

export const inherit = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
};

export const spawnInherit = (command, args, options = {}) => {
  const child = spawn(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
};

export const dockerAvailable = () => {
  try {
    run("docker", ["version", "--format", "{{.Server.Version}}"]);
    return true;
  } catch {
    return false;
  }
};

export const removePath = (path) => {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
};

export const parseJson = (raw, fallback = null) => {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

export const adminHeaders = () => ({
  Authorization: `Bearer ${localAdminToken}`,
  "Content-Type": "application/json",
});
