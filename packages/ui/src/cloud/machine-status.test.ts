import { describe, expect, it, vi } from "vitest";

import type { ComputerAccessSessionResponse } from "./cloud-client";
import {
  ACCESS_SESSION_REFRESH_BUFFER_MS,
  getRemoteMachineUnavailableMessage,
  isAccessSessionUsable,
  isRemoteMachineConnectable,
  isRemoteMachinePendingStartup,
  isRemoteMachineTerminal,
} from "./machine-status";

describe("machine status helpers", () => {
  it("identifies connectable machine statuses", () => {
    expect(isRemoteMachineConnectable("online")).toBe(true);
    expect(isRemoteMachineConnectable("idle")).toBe(true);
    expect(isRemoteMachineConnectable("sleeping")).toBe(false);
  });

  it("identifies pending startup statuses", () => {
    expect(isRemoteMachinePendingStartup("creating")).toBe(true);
    expect(isRemoteMachinePendingStartup("starting")).toBe(true);
    expect(isRemoteMachinePendingStartup("online")).toBe(false);
  });

  it("identifies terminal statuses", () => {
    expect(isRemoteMachineTerminal("failed")).toBe(true);
    expect(isRemoteMachineTerminal("offline")).toBe(true);
    expect(isRemoteMachineTerminal("deleted")).toBe(true);
    expect(isRemoteMachineTerminal("idle")).toBe(false);
  });

  it("formats unavailable messages", () => {
    expect(getRemoteMachineUnavailableMessage("failed")).toBe("Machine failed to start.");
    expect(getRemoteMachineUnavailableMessage("offline")).toBe("Machine is offline.");
    expect(getRemoteMachineUnavailableMessage("deleted")).toBe("Machine not found.");
    expect(getRemoteMachineUnavailableMessage("sleeping")).toBe("Machine is sleeping.");
    expect(getRemoteMachineUnavailableMessage("paused")).toBe("Machine is paused.");
  });
});

describe("isAccessSessionUsable", () => {
  it("accepts matching sessions that expire after the refresh buffer", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    expect(isAccessSessionUsable(createAccessSession({
      computerId: "machine",
      expiresAt: new Date(Date.now() + ACCESS_SESSION_REFRESH_BUFFER_MS + 1000).toISOString(),
    }), "machine")).toBe(true);

    vi.useRealTimers();
  });

  it("rejects mismatched, expired, and soon-to-expire sessions", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    expect(isAccessSessionUsable(createAccessSession({
      computerId: "other",
      expiresAt: new Date(Date.now() + ACCESS_SESSION_REFRESH_BUFFER_MS + 1000).toISOString(),
    }), "machine")).toBe(false);
    expect(isAccessSessionUsable(createAccessSession({
      computerId: "machine",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }), "machine")).toBe(false);
    expect(isAccessSessionUsable(createAccessSession({
      computerId: "machine",
      expiresAt: new Date(Date.now() + ACCESS_SESSION_REFRESH_BUFFER_MS - 1000).toISOString(),
    }), "machine")).toBe(false);

    vi.useRealTimers();
  });
});

const createAccessSession = (input: {
  readonly computerId: string;
  readonly expiresAt: string;
}): ComputerAccessSessionResponse => ({
  accessSession: {
    id: "session",
    computerId: input.computerId,
    token: "token",
    expiresAt: input.expiresAt,
  },
  routes: {
    filesystemWebSocketUrl: "/filesystem",
    browserControlWebSocketUrl: "/browser-control",
    agentBaseUrl: "/agent",
    capabilitiesBaseUrl: "/capabilities",
  },
});
