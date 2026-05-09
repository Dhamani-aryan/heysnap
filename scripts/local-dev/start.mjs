#!/usr/bin/env node
import { spawn } from "node:child_process";

import { createLocalCloudEnv } from "./cloud.mjs";
import {
  adminHeaders,
  inherit,
  localCloudUrl,
  repoRoot,
} from "./common.mjs";
import { runLocalReleasePublisher } from "./release-machine-server.mjs";

const DEV_EMAIL = process.env.LOCAL_DEV_EMAIL || "dev@example.com";
const DEV_PASSWORD = process.env.LOCAL_DEV_PASSWORD || "dev123";
const children = [];

const startProcess = (name, command, args, options = {}) => {
  const child = spawn(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: "inherit",
  });

  children.push({ name, child });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`${name} exited with signal ${signal}`);
      return;
    }
    if (code !== 0 && code !== null) {
      console.log(`${name} exited with code ${code}`);
    }
  });
  return child;
};

const stopChildren = () => {
  for (const { child } of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
};

process.on("SIGINT", () => {
  stopChildren();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopChildren();
  process.exit(143);
});

const waitForHttp = async (url, label) => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting while the dev server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`${label} did not become ready at ${url}`);
};

const ensureDevUser = async () => {
  const usersResponse = await fetch(`${localCloudUrl}/admin/users`, {
    headers: adminHeaders(),
  });

  if (!usersResponse.ok) {
    throw new Error(`Could not list local users: ${usersResponse.status} ${await usersResponse.text()}`);
  }

  const usersBody = await usersResponse.json();
  const existing = usersBody.users?.find((user) => user.email === DEV_EMAIL);

  if (existing) {
    const passwordResponse = await fetch(`${localCloudUrl}/admin/users/${existing.id}/password`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ password: DEV_PASSWORD }),
    });
    if (!passwordResponse.ok) {
      throw new Error(`Could not reset local dev user password: ${passwordResponse.status} ${await passwordResponse.text()}`);
    }
    console.log(`Local dev user ready: ${DEV_EMAIL} / ${DEV_PASSWORD}`);
    return;
  }

  const createResponse = await fetch(`${localCloudUrl}/admin/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
    }),
  });

  if (!createResponse.ok) {
    throw new Error(`Could not create local dev user: ${createResponse.status} ${await createResponse.text()}`);
  }

  console.log(`Local dev user ready: ${DEV_EMAIL} / ${DEV_PASSWORD}`);
};

const main = async () => {
  console.log("Starting local Docker infra...");
  inherit("node", ["scripts/local-dev/infra.mjs"]);

  const cloudEnv = createLocalCloudEnv();
  console.log("Running cloud-server migrations...");
  inherit("pnpm", ["--filter", "@ank1015-app/cloud-server", "db:migrate"], { env: cloudEnv });

  console.log("Starting local cloud-server...");
  startProcess("cloud-server", "pnpm", ["--filter", "@ank1015-app/cloud-server", "dev"], { env: cloudEnv });
  await waitForHttp(`${localCloudUrl}/health`, "cloud-server");
  await ensureDevUser();

  console.log("Publishing local machine-server release...");
  await runLocalReleasePublisher();

  console.log("Starting web and admin dev servers...");
  startProcess("web", "pnpm", ["--filter", "@ank1015-app/web", "dev"]);
  startProcess("admin-ui", "pnpm", ["--filter", "@ank1015-app/cloud-server-admin-ui", "dev"]);

  console.log("");
  console.log("Local dev is running.");
  console.log("Web:         http://localhost:3000");
  console.log("Admin UI:    http://localhost:5174/admin-dashboard/");
  console.log(`Cloud API:   ${localCloudUrl}`);
  console.log("Artifacts:   http://localhost:4101");
  console.log(`Login:       ${DEV_EMAIL} / ${DEV_PASSWORD}`);
  console.log("");
  console.log("Press Ctrl+C to stop the dev servers. Use pnpm dev:local:prune to remove Docker state.");
};

main().catch((error) => {
  stopChildren();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
