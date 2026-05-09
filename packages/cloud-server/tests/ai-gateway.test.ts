import { describe, expect, it, vi } from "vitest";

import { hashToken } from "../src/auth/tokens.js";
import type { CloudServerConfig } from "../src/config.js";
import type { ComputerRecord, MachineIdentityRecord, UserRecord } from "../src/db/types.js";
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
  allowedOrigins: ["https://app.example.com"],
  adminToken: "test-admin-token",
};

describe("AI gateway", () => {
  it("rejects missing machine api-key headers", async () => {
    const { app } = await createTestApp();

    const response = await app.request("/llm/openai/v1/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.5" }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(401);
  });

  it("proxies Codex requests to Azure and logs streamed usage by user and computer", async () => {
    const { app, store, machineToken, user, computer, identity } = await createTestApp();
    const upstreamText = [
      "event: response.completed",
      `data: ${JSON.stringify({
        response: {
          model: "gpt-5.5",
          usage: {
            input_tokens: 3,
            output_tokens: 4,
            total_tokens: 7,
            input_tokens_details: { cached_tokens: 1 },
            output_tokens_details: { reasoning_tokens: 2 },
          },
        },
      })}`,
      "",
      "",
    ].join("\n");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(upstreamText, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-upstream": "ok",
        "content-length": "999",
      },
    }));

    try {
      const response = await app.request("/llm/openai/v1/responses?api-version=2025-04-01-preview", {
        method: "POST",
        body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
        headers: {
          "api-key": machineToken,
          "content-type": "application/json",
          "x-codex-header": "kept",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("x-upstream")).toBe("ok");
      expect(response.headers.get("content-length")).toBeNull();
      expect(await response.text()).toBe(upstreamText);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://azure.example.com/openai/v1/responses?api-version=2025-04-01-preview",
      );

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const headers = new Headers(init.headers);
      expect(init.method).toBe("POST");
      expect(await new Response(init.body).text()).toBe(JSON.stringify({ model: "gpt-5.5", input: "hi" }));
      expect(headers.get("api-key")).toBe("azure-real-key");
      expect(headers.get("x-codex-header")).toBe("kept");
      expect(headers.get("content-length")).toBeNull();

      const [usage] = await store.listAiUsageRequests();
      expect(usage).toMatchObject({
        userId: user.id,
        computerId: computer.id,
        machineIdentityId: identity.id,
        provider: "azure",
        model: "gpt-5.5",
        method: "POST",
        upstreamPath: "/responses?api-version=2025-04-01-preview",
        status: "succeeded",
        httpStatus: 200,
        inputTokens: 3,
        outputTokens: 4,
        cachedInputTokens: 1,
        reasoningOutputTokens: 2,
        totalTokens: 7,
      });
      expect(store.aiUsagePayloads.size).toBe(0);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("honors a configured full Azure responses endpoint without appending responses twice", async () => {
    const { app, machineToken } = await createTestApp({
      aiGatewayAzureBaseUrl: "https://azure.example.com/openai/responses?api-version=2025-04-01-preview",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    try {
      const response = await app.request("/llm/openai/v1/responses", {
        method: "POST",
        body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
        headers: {
          "api-key": machineToken,
          "content-type": "application/json",
        },
      });

      expect(response.status).toBe(200);
      await response.text();
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://azure.example.com/openai/responses?api-version=2025-04-01-preview",
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("proxies image generation requests to the Azure images endpoint", async () => {
    const { app, store, machineToken, user, computer, identity } = await createTestApp();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: "ZmFrZS1pbWFnZQ==" }],
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": "999",
      },
    }));

    try {
      const response = await app.request("/llm/openai/v1/images/generations?api-version=2024-02-01", {
        method: "POST",
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt: "A photograph of a red fox in an autumn forest",
          size: "1024x1024",
          quality: "low",
          output_compression: 100,
          output_format: "png",
          n: 1,
        }),
        headers: {
          "api-key": machineToken,
          "content-type": "application/json",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBeNull();
      expect(await response.json()).toEqual({ data: [{ b64_json: "ZmFrZS1pbWFnZQ==" }] });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://images.azure.example.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01",
      );

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const headers = new Headers(init.headers);
      expect(init.method).toBe("POST");
      expect(JSON.parse(await new Response(init.body).text())).toEqual({
        prompt: "A photograph of a red fox in an autumn forest",
        size: "1024x1024",
        quality: "low",
        output_compression: 100,
        output_format: "png",
        n: 1,
      });
      expect(headers.get("authorization")).toBe("Bearer azure-real-key");
      expect(headers.get("api-key")).toBeNull();
      expect(headers.get("content-type")).toBe("application/json");

      const [usage] = await store.listAiUsageRequests();
      expect(usage).toMatchObject({
        userId: user.id,
        computerId: computer.id,
        machineIdentityId: identity.id,
        provider: "azure",
        model: "gpt-image-2",
        method: "POST",
        upstreamPath: "/images/generations?api-version=2024-02-01",
        status: "succeeded",
        httpStatus: 200,
        metadata: {
          gatewayPath: "/llm/openai/v1/images/generations",
          gatewayRouteKind: "images",
        },
      });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("proxies image edit requests to the Azure images endpoint", async () => {
    const { app, machineToken } = await createTestApp({
      aiGatewayAzureImagesBaseUrl:
        "https://images.azure.example.com/openai/deployments/gpt-image-2/images/edits?api-version=2024-02-01",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: "ZWRpdGVkLWltYWdl" }],
    }), { status: 200 }));
    const form = new FormData();
    form.set("prompt", "Make this black and white");
    form.set("image", new Blob(["image-bytes"], { type: "image/png" }), "image_to_edit.png");
    form.set("mask", new Blob(["mask-bytes"], { type: "image/png" }), "mask.png");

    try {
      const response = await app.request("/llm/openai/v1/images/edits", {
        method: "POST",
        body: form,
        headers: {
          "api-key": machineToken,
        },
      });

      expect(response.status).toBe(200);
      await response.text();
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://images.azure.example.com/openai/deployments/gpt-image-2/images/edits?api-version=2024-02-01",
      );

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe("Bearer azure-real-key");
      expect(headers.get("api-key")).toBeNull();
      expect(headers.get("content-type")).toBeNull();
      expect(init.body).toBeInstanceOf(FormData);
      const upstreamForm = init.body as FormData;
      expect(upstreamForm.get("prompt")).toBe("Make this black and white");
      expect(upstreamForm.get("image")).toBeInstanceOf(Blob);
      expect(upstreamForm.get("image[]")).toBeNull();
      expect(upstreamForm.get("mask")).toBeInstanceOf(Blob);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("requires a dedicated Azure images base URL for image routes", async () => {
    const { app, machineToken } = await createTestApp({
      aiGatewayAzureImagesBaseUrl: undefined,
    });

    const response = await app.request("/llm/openai/v1/images/generations", {
      method: "POST",
      body: JSON.stringify({ prompt: "hi" }),
      headers: {
        "api-key": machineToken,
        "content-type": "application/json",
      },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: "AI_GATEWAY_NOT_CONFIGURED",
        message: "AI image gateway is not configured",
      },
    });
  });

  it("logs token usage from non-stream JSON responses", async () => {
    const { app, store, machineToken } = await createTestApp();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      model: "gpt-5.5",
      usage: {
        input_tokens: 25,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens: 9,
        output_tokens_details: { reasoning_tokens: 2 },
        total_tokens: 34,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    try {
      const response = await app.request("/llm/openai/v1/responses", {
        method: "POST",
        body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
        headers: {
          "api-key": machineToken,
          "content-type": "application/json",
        },
      });

      expect(response.status).toBe(200);
      await response.text();

      const [usage] = await store.listAiUsageRequests();
      expect(usage).toMatchObject({
        status: "succeeded",
        httpStatus: 200,
        model: "gpt-5.5",
        inputTokens: 25,
        outputTokens: 9,
        cachedInputTokens: 3,
        reasoningOutputTokens: 2,
        totalTokens: 34,
      });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("stores redacted payloads only when body capture is enabled", async () => {
    const { app, store, machineToken } = await createTestApp({
      aiGatewayCaptureBodies: true,
      aiGatewayCaptureBodyMaxBytes: 1024,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    try {
      const response = await app.request("/llm/openai/v1/responses", {
        method: "POST",
        body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
        headers: {
          "api-key": machineToken,
          "authorization": "Bearer secret",
          "content-type": "application/json",
        },
      });

      expect(response.status).toBe(200);
      await response.text();

      const [usage] = await store.listAiUsageRequests();
      const payload = await store.getAiUsagePayloadByRequestId(usage?.id ?? "");
      expect(payload).toMatchObject({
        requestBody: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
        requestBodyTruncated: false,
        responseBody: "{}",
        responseBodyTruncated: false,
      });
      expect(payload?.requestHeaders).toMatchObject({
        "api-key": "[redacted]",
        authorization: "[redacted]",
      });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("exposes admin usage list, detail, and summary APIs", async () => {
    const { app, store, user, computer, identity } = await createTestApp();
    const usage = await store.createAiUsageRequest({
      userId: user.id,
      computerId: computer.id,
      machineIdentityId: identity.id,
      provider: "azure",
      model: "gpt-5.5",
      method: "POST",
      upstreamPath: "/responses",
      status: "started",
    });
    await store.updateAiUsageRequest({
      id: usage.id,
      status: "succeeded",
      inputTokens: 5,
      outputTokens: 6,
      totalTokens: 11,
      completedAt: new Date(),
    });

    const list = await app.request("/admin/ai-usage?limit=5", {
      headers: adminHeaders(),
    });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      usage: [
        {
          id: usage.id,
          userEmail: user.email,
          computerName: computer.name,
          totalTokens: 11,
        },
      ],
    });

    const detail = await app.request(`/admin/ai-usage/${usage.id}`, {
      headers: adminHeaders(),
    });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      usage: {
        id: usage.id,
        payload: null,
      },
    });

    const summary = await app.request(`/admin/ai-usage/summary?userId=${user.id}`, {
      headers: adminHeaders(),
    });
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({
      summary: {
        requestCount: 1,
        inputTokens: 5,
        outputTokens: 6,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 11,
        successCount: 1,
        failedCount: 0,
        abortedCount: 0,
        startedCount: 0,
        distinctUsers: 1,
        distinctComputers: 1,
        distinctModels: 1,
      },
    });
  });
});

const createTestApp = async (configOverrides: Partial<CloudServerConfig> = {}): Promise<{
  readonly app: ReturnType<typeof createApp>;
  readonly store: InMemoryCloudStore;
  readonly user: UserRecord;
  readonly computer: ComputerRecord;
  readonly identity: MachineIdentityRecord;
  readonly machineToken: string;
}> => {
  const store = new InMemoryCloudStore();
  const config = { ...baseConfig, ...configOverrides };
  const app = createApp({ config, store });
  const user = await store.createUser({
    email: "owner@example.com",
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
    user,
    computer,
    identity: activated,
    machineToken,
  };
};

const adminHeaders = () => ({
  authorization: `Bearer ${baseConfig.adminToken}`,
  "content-type": "application/json",
});
