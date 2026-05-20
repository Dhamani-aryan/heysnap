"use client";

import { createStore, type StoreApi } from "zustand/vanilla";

const BROWSER_WINDOW_ID_STORAGE_KEY = "heysnap:browser-window-id";

export interface BrowserWindowState {
  readonly windowId: number | null;
  readonly isHydrated: boolean;
  readonly isOpening: boolean;
  readonly error: string | null;
  readonly hydrateFromStorage: () => void;
  readonly setWindowId: (windowId: number) => void;
  readonly clearWindowId: () => void;
  readonly setOpening: (isOpening: boolean) => void;
  readonly setError: (message: string | null) => void;
}

export type BrowserWindowStore = StoreApi<BrowserWindowState>;

export const createBrowserWindowStore = (): BrowserWindowStore =>
  createStore<BrowserWindowState>((set) => ({
    windowId: null,
    isHydrated: false,
    isOpening: false,
    error: null,
    hydrateFromStorage: () => {
      set({ windowId: readStoredWindowId(), isHydrated: true, error: null });
    },
    setWindowId: (windowId) => {
      writeStoredWindowId(windowId);
      set({ windowId, isHydrated: true, isOpening: false, error: null });
    },
    clearWindowId: () => {
      removeStoredWindowId();
      set({ windowId: null, isHydrated: true, isOpening: false, error: null });
    },
    setOpening: (isOpening) => {
      set({ isOpening, ...(isOpening ? { error: null } : {}) });
    },
    setError: (message) => {
      set({ error: message, isOpening: false });
    },
  }));

const readStoredWindowId = (): number | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(BROWSER_WINDOW_ID_STORAGE_KEY);
    const parsed = Number.parseInt(value ?? "", 10);

    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
};

const writeStoredWindowId = (windowId: number): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(BROWSER_WINDOW_ID_STORAGE_KEY, String(windowId));
  } catch {
    // The in-memory store still works for this tab when storage is unavailable.
  }
};

const removeStoredWindowId = (): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(BROWSER_WINDOW_ID_STORAGE_KEY);
  } catch {
    // The in-memory store still works for this tab when storage is unavailable.
  }
};
