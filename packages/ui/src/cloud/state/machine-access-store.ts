"use client";

import { createStore, type StoreApi } from "zustand/vanilla";

import type { ComputerAccessSessionResponse } from "../cloud-client";

export interface MachineAccessEntry {
  readonly response: ComputerAccessSessionResponse | null;
  readonly isLoading: boolean;
  readonly error: string | null;
}

export interface MachineAccessState {
  readonly sessionsByComputerId: Record<string, MachineAccessEntry>;
  readonly setLoading: (computerId: string, isLoading: boolean) => void;
  readonly setSession: (computerId: string, response: ComputerAccessSessionResponse) => void;
  readonly setError: (computerId: string, message: string | null) => void;
  readonly clearSession: (computerId: string) => void;
  readonly reset: () => void;
}

export type MachineAccessStore = StoreApi<MachineAccessState>;

export const createMachineAccessStore = (): MachineAccessStore =>
  createStore<MachineAccessState>((set) => ({
    sessionsByComputerId: {},
    setLoading: (computerId, isLoading) => {
      set((state) => ({
        sessionsByComputerId: {
          ...state.sessionsByComputerId,
          [computerId]: {
            ...emptyEntry,
            ...state.sessionsByComputerId[computerId],
            isLoading,
            ...(isLoading ? { error: null } : {}),
          },
        },
      }));
    },
    setSession: (computerId, response) => {
      set((state) => ({
        sessionsByComputerId: {
          ...state.sessionsByComputerId,
          [computerId]: { response, isLoading: false, error: null },
        },
      }));
    },
    setError: (computerId, message) => {
      set((state) => ({
        sessionsByComputerId: {
          ...state.sessionsByComputerId,
          [computerId]: {
            ...emptyEntry,
            ...state.sessionsByComputerId[computerId],
            isLoading: false,
            error: message,
          },
        },
      }));
    },
    clearSession: (computerId) => {
      set((state) => {
        const { [computerId]: _removed, ...sessionsByComputerId } = state.sessionsByComputerId;
        return { sessionsByComputerId };
      });
    },
    reset: () => {
      set({ sessionsByComputerId: {} });
    },
  }));

export const emptyEntry: MachineAccessEntry = {
  response: null,
  isLoading: false,
  error: null,
};
