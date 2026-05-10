"use client";

export const readStoredToken = (storageKey: string): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const token = window.localStorage.getItem(storageKey);
    return token === null || token.length === 0 ? null : token;
  } catch {
    return null;
  }
};

export const writeStoredToken = (storageKey: string, token: string): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, token);
  } catch {
    // The in-memory session still works for this tab when storage is unavailable.
  }
};

export const removeStoredToken = (storageKey: string): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nothing else to clear.
  }
};

export const readStoredBoolean = (storageKey: string): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
};

export const writeStoredBoolean = (storageKey: string, value: boolean): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, value ? "true" : "false");
  } catch {
    // Showing the modal again is acceptable when storage is unavailable.
  }
};

export const removeStoredBoolean = (storageKey: string): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nothing else to clear.
  }
};
