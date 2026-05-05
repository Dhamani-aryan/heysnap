const STORAGE_KEY = "heysnap:admin-token";

export const getStoredAdminToken = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export const setStoredAdminToken = (token: string): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* noop */
  }
};

export const clearStoredAdminToken = (): void => {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
};

export const maskToken = (token: string): string => {
  if (token.length <= 8) {
    return "•".repeat(token.length);
  }

  return `${token.slice(0, 4)}…${token.slice(-4)}`;
};
