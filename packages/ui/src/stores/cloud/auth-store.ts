"use client";

import { createStore, type StoreApi } from "zustand/vanilla";

import type { CloudUser } from "../../cloud/cloud-client";

export type CloudAuthStatus = "checking" | "authenticated" | "unauthenticated";

export interface CloudAuthState {
  readonly token: string | null;
  readonly user: CloudUser | null;
  readonly status: CloudAuthStatus;
  readonly setChecking: (token?: string | null) => void;
  readonly setAuthenticatedSession: (input: { readonly token: string; readonly user: CloudUser }) => void;
  readonly setPendingLoginSession: (input: { readonly token: string; readonly user: CloudUser }) => void;
  readonly completeLogin: () => void;
  readonly clear: () => void;
}

export type CloudAuthStore = StoreApi<CloudAuthState>;

export const createCloudAuthStore = (): CloudAuthStore =>
  createStore<CloudAuthState>((set, get) => ({
    token: null,
    user: null,
    status: "checking",
    setChecking: (token = null) => {
      set({ token, user: null, status: "checking" });
    },
    setAuthenticatedSession: ({ token, user }) => {
      set({ token, user, status: "authenticated" });
    },
    setPendingLoginSession: ({ token, user }) => {
      set({ token, user, status: "unauthenticated" });
    },
    completeLogin: () => {
      if (get().token !== null && get().user !== null) {
        set({ status: "authenticated" });
      }
    },
    clear: () => {
      set({ token: null, user: null, status: "unauthenticated" });
    },
  }));
