import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CapabilitiesApiError,
  getCapabilities,
  installTool,
  sendCapabilityOperationInput,
} from "./capabilities-client";

describe("capabilities REST client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads capabilities from the base url", async () => {
    const fetch = mockFetch({ capabilities: createCapabilitiesSnapshot() });
    vi.stubGlobal("fetch", fetch);

    await expect(getCapabilities("/gateway/computers/cmp_123/capabilities?accessToken=token"))
      .resolves.toEqual({ capabilities: createCapabilitiesSnapshot() });

    expect(fetch).toHaveBeenCalledWith(
      "/gateway/computers/cmp_123/capabilities?accessToken=token",
      {},
    );
  });

  it("preserves access tokens when appending tool action paths", async () => {
    const fetch = mockFetch({ operation: createOperationSnapshot() });
    vi.stubGlobal("fetch", fetch);

    await installTool("/gateway/computers/cmp_123/capabilities?accessToken=token", "github/tool");

    expect(fetch).toHaveBeenCalledWith(
      "/gateway/computers/cmp_123/capabilities/tools/github%2Ftool/install?accessToken=token",
      { method: "POST" },
    );
  });

  it("posts operation input to the input subresource", async () => {
    const fetch = mockFetch({ operation: createOperationSnapshot() });
    vi.stubGlobal("fetch", fetch);

    await sendCapabilityOperationInput(
      "/gateway/computers/cmp_123/capabilities?accessToken=token",
      "op_123",
      "123456",
    );

    expect(fetch).toHaveBeenCalledWith(
      "/gateway/computers/cmp_123/capabilities/operations/op_123/input?accessToken=token",
      {
        method: "POST",
        body: JSON.stringify({ input: "123456" }),
        headers: { "content-type": "application/json" },
      },
    );
  });

  it("raises client-safe API errors", async () => {
    vi.stubGlobal("fetch", mockFetch(
      { error: { code: "UNKNOWN_TOOL", message: "Unknown tool." } },
      { ok: false, status: 404 },
    ));

    await expect(installTool("/capabilities", "missing"))
      .rejects.toMatchObject(new CapabilitiesApiError(404, "UNKNOWN_TOOL", "Unknown tool."));
  });

  it("wraps non-JSON responses in connector API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "ank1015 server",
    })));

    await expect(getCapabilities("/capabilities"))
      .rejects.toMatchObject({
        name: "CapabilitiesApiError",
        code: "INVALID_CAPABILITIES_RESPONSE",
        message: "Connectors API returned a non-JSON response. The machine server may need to be restarted or updated.",
      });
  });
});

const mockFetch = (
  body: unknown,
  response: { readonly ok?: boolean; readonly status?: number } = {},
) => vi.fn(async () => ({
  ok: response.ok ?? true,
  status: response.status ?? 200,
  text: async () => JSON.stringify(body),
}));

const createCapabilitiesSnapshot = () => ({
  catalogVersion: "test",
  codexBin: null,
  tools: [],
  skills: [],
});

const createOperationSnapshot = () => ({
  id: "op_123",
  operation: "installTool",
  targetId: "github",
  status: "running",
  messages: [],
  createdAt: "2026-05-11T00:00:00.000Z",
  updatedAt: "2026-05-11T00:00:00.000Z",
});
