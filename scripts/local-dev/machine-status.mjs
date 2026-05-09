#!/usr/bin/env node
import {
  adminHeaders,
  localCloudUrl,
  machineContainerName,
  parseJson,
  readComputerIdArg,
  run,
} from "./common.mjs";

const computerId = readComputerIdArg("Usage: pnpm dev:local:status -- <computerId>");

const containerName = machineContainerName(computerId);

const fetchComputer = async () => {
  const response = await fetch(`${localCloudUrl}/admin/computers/${computerId}`, {
    headers: adminHeaders(),
  });
  const text = await response.text();
  if (!response.ok) {
    return { error: `${response.status} ${text}` };
  }
  return parseJson(text, { raw: text });
};

const inspectContainer = () => {
  try {
    return parseJson(run("docker", ["inspect", containerName]).stdout, [])[0] ?? null;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

const execText = (command) => {
  try {
    return run("docker", ["exec", containerName, "bash", "-lc", command]).stdout.trim();
  } catch {
    return "";
  }
};

const logs = () => {
  try {
    const result = run("docker", ["logs", "--tail", "80", containerName]);
    return [result.stdout, result.stderr].filter(Boolean).join("\n");
  } catch {
    return "";
  }
};

const computer = await fetchComputer();
const inspect = inspectContainer();
const updateState = execText("cat /opt/ank1015/machine-update-state 2>/dev/null || true");
const updateError = execText("cat /opt/ank1015/machine-update-error 2>/dev/null || true");
const machineStatus = execText("curl -fsS http://127.0.0.1:4000/status 2>/dev/null || true");

console.log(`Computer: ${computerId}`);
console.log(`Cloud API: ${localCloudUrl}`);

if (computer.error) {
  console.log(`Cloud status: unavailable (${computer.error})`);
} else {
  const detail = computer.computer ?? computer;
  console.log(`Cloud status: ${detail.status ?? "unknown"}`);
  console.log(`Last heartbeat: ${detail.lastHeartbeatAt ?? "never"}`);
  console.log(`Machine server version: ${detail.machineServerVersion ?? "unknown"}`);
  console.log("Machine health:");
  console.log(JSON.stringify(detail.machineHealth ?? {}, null, 2));
}

if (inspect?.error) {
  console.log(`Container: unavailable (${inspect.error})`);
} else if (inspect) {
  console.log(`Container: ${inspect.State?.Status ?? "unknown"} (${inspect.Id?.slice(0, 12) ?? "no-id"})`);
  console.log(`Image: ${inspect.Config?.Image ?? "unknown"}`);
  console.log(`Started at: ${inspect.State?.StartedAt ?? "unknown"}`);
} else {
  console.log("Container: not found");
}

console.log(`Update state: ${updateState || "unknown"}`);
if (updateError) {
  console.log(`Last update error: ${updateError}`);
}
if (machineStatus) {
  console.log("Machine /status:");
  console.log(machineStatus);
}

const recentLogs = logs().trim();
if (recentLogs) {
  console.log("Recent container logs:");
  console.log(recentLogs);
}
