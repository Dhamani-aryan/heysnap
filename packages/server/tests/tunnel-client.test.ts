import { describe, expect, it } from "vitest";

import { normalizeWebSocketCloseCode } from "../src/tunnel/client.js";

describe("machine tunnel client", () => {
  it("normalizes reserved websocket close codes before forwarding them", () => {
    expect(normalizeWebSocketCloseCode(undefined)).toBe(1000);
    expect(normalizeWebSocketCloseCode(1005)).toBe(1000);
    expect(normalizeWebSocketCloseCode(1006)).toBe(1000);
    expect(normalizeWebSocketCloseCode(1015)).toBe(1000);
    expect(normalizeWebSocketCloseCode(1011)).toBe(1011);
    expect(normalizeWebSocketCloseCode(4000)).toBe(4000);
  });
});
