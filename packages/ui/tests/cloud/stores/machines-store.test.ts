import { describe, expect, it } from "vitest";

import type { CloudComputer } from "../../../src/cloud/cloud-client";
import { createCloudMachinesStore, selectComputers } from "../../../src/stores/cloud/machines-store";

describe("createCloudMachinesStore", () => {
  it("normalizes replaced machines and preserves response order", () => {
    const store = createCloudMachinesStore();
    const first = createComputer({ id: "first", createdAt: "2026-01-01T00:00:00.000Z" });
    const second = createComputer({ id: "second", createdAt: "2026-01-02T00:00:00.000Z" });

    store.getState().replaceComputers([first, second]);

    expect(store.getState().computerIds).toEqual(["first", "second"]);
    expect(store.getState().computersById).toEqual({ first, second });
    expect(selectComputers(store.getState())).toEqual([first, second]);
    expect(store.getState().hasLoaded).toBe(true);
    expect(store.getState().error).toBeNull();
  });

  it("upserts existing machines and prepends new machines", () => {
    const store = createCloudMachinesStore();
    const first = createComputer({ id: "first", name: "First" });
    const second = createComputer({ id: "second", name: "Second" });
    const updatedFirst = createComputer({ id: "first", name: "Updated First" });

    store.getState().replaceComputers([first]);
    store.getState().upsertComputer(second);
    store.getState().upsertComputer(updatedFirst);

    expect(store.getState().computerIds).toEqual(["second", "first"]);
    expect(store.getState().computersById["first"]).toBe(updatedFirst);
    expect(store.getState().computersById["second"]).toBe(second);
  });

  it("reset clears machines and start request tracking", () => {
    const store = createCloudMachinesStore();
    const computer = createComputer({ id: "sleeping", status: "sleeping" });

    store.getState().replaceComputers([computer]);
    store.getState().markStartRequested(computer.id);
    store.getState().reset();

    expect(store.getState().computerIds).toEqual([]);
    expect(store.getState().computersById).toEqual({});
    expect(store.getState().hasLoaded).toBe(false);
    expect(store.getState().startRequestedIds.size).toBe(0);
  });

  it("keeps sleeping start requests until the machine leaves sleeping", () => {
    const store = createCloudMachinesStore();
    const sleeping = createComputer({ id: "machine", status: "sleeping" });
    const starting = createComputer({ id: "machine", status: "starting" });

    store.getState().replaceComputers([sleeping]);
    store.getState().markStartRequested(sleeping.id);
    store.getState().replaceComputers([sleeping]);

    expect(store.getState().startRequestedIds.has(sleeping.id)).toBe(true);

    store.getState().replaceComputers([starting]);

    expect(store.getState().startRequestedIds.has(sleeping.id)).toBe(false);
  });
});

const createComputer = (overrides: Partial<CloudComputer>): CloudComputer => ({
  id: "computer",
  ownerUserId: "user",
  name: "Machine",
  kind: "cloud",
  status: "online",
  providerMetadata: {},
  capabilities: [],
  machineServerVersion: null,
  lastHeartbeatAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});
