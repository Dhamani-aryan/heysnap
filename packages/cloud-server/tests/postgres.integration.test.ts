import { afterAll, describe, expect, it } from "vitest";

import { getDevelopmentCloudServerConfig } from "../src/config.js";
import { createDbClient } from "../src/db/client.js";
import type { ComputerRecord } from "../src/db/types.js";
import type { ComputerProvisioner } from "../src/provisioning/types.js";
import { createApp } from "../src/server.js";
import { DrizzleCloudStore } from "../src/db/drizzle-store.js";

const shouldRun = process.env.RUN_POSTGRES_TESTS === "true";
const describePostgres = shouldRun ? describe : describe.skip;

describePostgres("cloud server postgres integration", () => {
  const config = getDevelopmentCloudServerConfig({
    ...process.env,
    SESSION_SECRET: process.env.SESSION_SECRET ?? "postgres-test-session-secret",
  });
  const dbClient = createDbClient(config.databaseUrl);
  const app = createApp({
    config,
    store: new DrizzleCloudStore(dbClient.db),
    provisioner: new FakeProvisioner(),
  });

  afterAll(async () => {
    await dbClient.close();
  });

  it("creates a user as admin and creates a computer through the real Drizzle store", async () => {
    const email = `postgres-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const username = email.split("@")[0]!.replace(/[^a-z0-9_-]/g, "-").slice(0, 40);
    const createdUser = await app.request("/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, username, password: "password123" }),
      headers: {
        authorization: `Bearer ${config.adminToken}`,
        "content-type": "application/json",
      },
    });

    expect(createdUser.status).toBe(201);

    const login = await app.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "password123" }),
      headers: { "content-type": "application/json" },
    });
    expect(login.status).toBe(200);
    const auth = await login.json() as {
      readonly session: { readonly token: string };
    };

    const created = await app.request("/computers", {
      method: "POST",
      body: JSON.stringify({ name: "Postgres VM" }),
      headers: {
        authorization: `Bearer ${auth.session.token}`,
        "content-type": "application/json",
      },
    });

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      computer: {
        name: "Postgres VM",
        kind: "cloud",
        status: "creating",
      },
    });
  });
});

class FakeProvisioner implements ComputerProvisioner {
  async provisionComputer(input: { readonly computer: ComputerRecord }) {
    return {
      providerMetadata: {
        provider: "aws-ec2",
        preset: "dev-8gb",
        region: "ap-south-1",
        instanceId: `i-${input.computer.id.slice(0, 8)}`,
      },
    };
  }

  async startComputer(computer: ComputerRecord) {
    return computer.providerMetadata as Record<string, unknown>;
  }

  async stopComputer(computer: ComputerRecord) {
    return computer.providerMetadata as Record<string, unknown>;
  }

  async restartComputer(computer: ComputerRecord) {
    return computer.providerMetadata as Record<string, unknown>;
  }

  async terminateComputer(computer: ComputerRecord) {
    return computer.providerMetadata as Record<string, unknown>;
  }
}
