import { describe, expect, it, vi } from "vitest";

import { hashToken } from "../src/auth/tokens.js";
import type { CloudServerConfig } from "../src/config.js";
import { createApp } from "../src/server.js";
import { InMemoryCloudStore } from "./in-memory-store.js";

const baseConfig: CloudServerConfig = {
  port: 4100,
  databaseUrl: "postgres://test",
  sessionSecret: "test-session-secret",
  sessionTtlSeconds: 60 * 60,
  computerAccessSessionTtlSeconds: 60,
  cloudServerPublicUrl: "https://cloud.example.com",
  awsRegion: "ap-south-1",
  awsEc2InstanceType: "t3.large",
  awsEc2RootVolumeGb: 80,
  awsMachineInstanceProfileName: "ank1015-machine-profile",
  awsMachineAmiSsmParameter: "/ank1015/machine-images/test/ami-id",
  machineServerChannel: "stable",
  aiGatewayAzureBaseUrl: "https://azure.example.com/openai/v1",
  aiGatewayAzureImagesBaseUrl: "https://images.azure.example.com/openai/deployments/gpt-image-2",
  aiGatewayAzureApiKey: "azure-real-key",
  firecrawlBaseUrl: "https://firecrawl.example.com",
  firecrawlApiKey: "firecrawl-real-key",
  allowedOrigins: ["https://app.example.com"],
  adminToken: "test-admin-token",
};

describe("Firecrawl gateway", () => {
  it("rejects missing machine api-key headers", async () => {
    const { app } = await createTestApp();

    const response = await app.request("/firecrawl/v1/scrape", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com" }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(401);
  });

  it("proxies authenticated requests to Firecrawl without AI usage logging", async () => {
    const { app, store, machineToken } = await createTestApp();
    const upstreamBody = JSON.stringify({ success: true, data: { markdown: "# Example" } });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(upstreamBody, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": "999",
        "x-firecrawl": "ok",
      },
    }));

    try {
      const requestBody = JSON.stringify({
        url: "https://example.com",
        formats: ["markdown"],
      });
      const response = await app.request("/firecrawl/v2/scrape?timeout=120", {
        method: "POST",
        body: requestBody,
        headers: {
          "authorization": `Bearer ${machineToken}`,
          "content-type": "application/json",
          "x-client": "kept",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBeNull();
      expect(response.headers.get("x-firecrawl")).toBe("ok");
      expect(await response.text()).toBe(upstreamBody);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://firecrawl.example.com/v2/scrape?timeout=120");

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const headers = new Headers(init.headers);
      expect(init.method).toBe("POST");
      expect(await new Response(init.body).text()).toBe(requestBody);
      expect(headers.get("authorization")).toBe("Bearer firecrawl-real-key");
      expect(headers.get("api-key")).toBeNull();
      expect(headers.get("x-client")).toBe("kept");
      expect(headers.get("content-length")).toBeNull();
      expect(store.aiUsageRequests.size).toBe(0);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("also accepts gateway-style machine api-key headers", async () => {
    const { app, machineToken } = await createTestApp();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    try {
      const response = await app.request("/firecrawl/v2/scrape", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com" }),
        headers: {
          "api-key": machineToken,
          "content-type": "application/json",
        },
      });

      expect(response.status).toBe(200);
      await response.text();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer firecrawl-real-key");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("honors a configured Firecrawl API path without appending it twice", async () => {
    const { app, machineToken } = await createTestApp({
      firecrawlBaseUrl: "https://firecrawl.example.com/v1",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    try {
      const response = await app.request("/firecrawl/v1/scrape", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com" }),
        headers: {
          "api-key": machineToken,
          "content-type": "application/json",
        },
      });

      expect(response.status).toBe(200);
      await response.text();
      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://firecrawl.example.com/v1/scrape");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("requires a Firecrawl API key", async () => {
    const { app, machineToken } = await createTestApp({ firecrawlApiKey: undefined });

    const response = await app.request("/firecrawl/v1/scrape", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com" }),
      headers: {
        "api-key": machineToken,
        "content-type": "application/json",
      },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: "FIRECRAWL_GATEWAY_NOT_CONFIGURED",
        message: "Firecrawl gateway is not configured",
      },
    });
  });
});

const createTestApp = async (configOverrides: Partial<CloudServerConfig> = {}) => {
  const store = new InMemoryCloudStore();
  const config = { ...baseConfig, ...configOverrides };
  const app = createApp({ config, store });
  const user = await store.createUser({
    email: "owner@example.com",
    username: "owner",
    passwordHash: "hash",
  });
  const computer = await store.createComputer({
    ownerUserId: user.id,
    name: "Owner VM",
    kind: "cloud",
    status: "online",
    providerMetadata: {},
    capabilities: [],
  });
  const identity = await store.createMachineIdentity({
    computerId: computer.id,
    bootstrapTokenHash: "bootstrap-hash",
  });
  const machineToken = "machine-token";
  const activated = await store.activateMachineIdentity({
    identityId: identity.id,
    tokenHash: hashToken(machineToken, config.sessionSecret),
    activatedAt: new Date(),
  });

  if (activated === null) {
    throw new Error("Failed to activate test machine identity");
  }

  return {
    app,
    store,
    machineToken,
  };
};
