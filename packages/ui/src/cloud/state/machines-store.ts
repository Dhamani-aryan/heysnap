"use client";

import { createStore, type StoreApi } from "zustand/vanilla";

import type { CloudComputer } from "../cloud-client";

export interface CloudMachinesState {
  readonly computers: readonly CloudComputer[];
  readonly computersById: Record<string, CloudComputer>;
  readonly computerIds: readonly string[];
  readonly hasLoaded: boolean;
  readonly lastLoadedAt: number | null;
  readonly error: string | null;
  readonly startRequestedIds: ReadonlySet<string>;
  readonly replaceComputers: (computers: readonly CloudComputer[]) => void;
  readonly upsertComputer: (computer: CloudComputer) => void;
  readonly removeComputer: (computerId: string) => void;
  readonly setError: (message: string | null) => void;
  readonly markStartRequested: (computerId: string) => void;
  readonly markStartFinished: (computerId: string) => void;
  readonly reset: () => void;
}

export type CloudMachinesStore = StoreApi<CloudMachinesState>;

export const createCloudMachinesStore = (): CloudMachinesStore =>
  createStore<CloudMachinesState>((set) => ({
    ...createEmptyMachinesState(),
    replaceComputers: (computers) => {
      const nextComputers = [...computers];
      const computersById: Record<string, CloudComputer> = {};
      const computerIds: string[] = [];
      const nextStartRequestedIds = new Set<string>();

      for (const computer of nextComputers) {
        computersById[computer.id] = computer;
        computerIds.push(computer.id);
      }

      set((state) => {
        for (const computerId of state.startRequestedIds) {
          const computer = computersById[computerId];
          if (computer?.status === "sleeping") {
            nextStartRequestedIds.add(computerId);
          }
        }

        return {
          computers: nextComputers,
          computersById,
          computerIds,
          hasLoaded: true,
          lastLoadedAt: Date.now(),
          error: null,
          startRequestedIds: nextStartRequestedIds,
        };
      });
    },
    upsertComputer: (computer) => {
      set((state) => {
        const hasComputer = computer.id in state.computersById;
        const startRequestedIds = new Set(state.startRequestedIds);

        if (computer.status !== "sleeping") {
          startRequestedIds.delete(computer.id);
        }

        return {
          ...state,
          computers: hasComputer
            ? state.computers.map((currentComputer) =>
                currentComputer.id === computer.id ? computer : currentComputer
              )
            : [computer, ...state.computers],
          computersById: {
            ...state.computersById,
            [computer.id]: computer,
          },
          computerIds: hasComputer ? state.computerIds : [computer.id, ...state.computerIds],
          error: null,
          startRequestedIds,
        };
      });
    },
    removeComputer: (computerId) => {
      set((state) => {
        const { [computerId]: _removed, ...computersById } = state.computersById;
        const startRequestedIds = new Set(state.startRequestedIds);
        startRequestedIds.delete(computerId);

        return {
          ...state,
          computers: state.computers.filter((computer) => computer.id !== computerId),
          computersById,
          computerIds: state.computerIds.filter((id) => id !== computerId),
          startRequestedIds,
        };
      });
    },
    setError: (message) => {
      set({ error: message, hasLoaded: true });
    },
    markStartRequested: (computerId) => {
      set((state) => {
        const startRequestedIds = new Set(state.startRequestedIds);
        startRequestedIds.add(computerId);
        return { ...state, startRequestedIds };
      });
    },
    markStartFinished: (computerId) => {
      set((state) => {
        const startRequestedIds = new Set(state.startRequestedIds);
        startRequestedIds.delete(computerId);
        return { ...state, startRequestedIds };
      });
    },
    reset: () => {
      set(createEmptyMachinesState());
    },
  }));

export const selectComputers = (state: CloudMachinesState): readonly CloudComputer[] =>
  state.computers;

export const selectHasPendingMachine = (state: CloudMachinesState): boolean =>
  state.computerIds.some((computerId) => {
    const status = state.computersById[computerId]?.status;
    return status === "creating" || status === "starting";
  });

const createEmptyMachinesState = () => ({
  computers: [] as CloudComputer[],
  computersById: {} as Record<string, CloudComputer>,
  computerIds: [] as string[],
  hasLoaded: false,
  lastLoadedAt: null as number | null,
  error: null as string | null,
  startRequestedIds: new Set<string>(),
});
