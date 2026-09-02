import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export const AUTH_STORAGE_KEY = 'heysnap-auth';
const LEGACY_TOKEN_STORAGE_KEY = 'ank1015:mobile-session-token';

type PersistedAuthState = {
  token: string | null;
};

type AuthState = PersistedAuthState & {
  hasHydrated: boolean;
  setHasHydrated: (hasHydrated: boolean) => void;
  setToken: (token: string | null) => void;
  clear: () => void;
};

const authStorage: StateStorage = {
  getItem: async (name) => {
    const value = await readValue(name);
    if (value !== null) return value;

    const legacyToken = await readValue(LEGACY_TOKEN_STORAGE_KEY);
    if (legacyToken === null) return null;

    return JSON.stringify({
      state: { token: legacyToken },
      version: 0,
    });
  },
  setItem: async (name, value) => {
    await writeValue(name, value);
    await removeValue(LEGACY_TOKEN_STORAGE_KEY);
  },
  removeItem: async (name) => {
    await removeValue(name);
    await removeValue(LEGACY_TOKEN_STORAGE_KEY);
  },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      hasHydrated: false,
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setToken: (token) => set({ token }),
      clear: () => set({ token: null }),
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => authStorage),
      partialize: (state): PersistedAuthState => ({ token: state.token }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

export const getAuthToken = () => useAuthStore.getState().token;

async function readValue(storageKey: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(storageKey) ?? null;
  }

  return SecureStore.getItemAsync(toSecureStoreKey(storageKey));
}

async function writeValue(storageKey: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(storageKey, value);
    return;
  }

  await SecureStore.setItemAsync(toSecureStoreKey(storageKey), value);
}

async function removeValue(storageKey: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(storageKey);
    return;
  }

  await SecureStore.deleteItemAsync(toSecureStoreKey(storageKey));
}

function toSecureStoreKey(storageKey: string): string {
  return storageKey.replace(/[^A-Za-z0-9._-]/g, '.');
}
