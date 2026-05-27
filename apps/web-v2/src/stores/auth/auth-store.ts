import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const AUTH_STORAGE_KEY = 'heysnap-auth'

type PersistedAuthState = {
  token: string | null
}

type AuthState = PersistedAuthState & {
  setToken: (token: string | null) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      setToken: (token) => set({ token }),
      clear: () => set({ token: null }),
    }),
    {
      name: AUTH_STORAGE_KEY,
      partialize: (state): PersistedAuthState => ({ token: state.token }),
    },
  ),
)

export const getAuthToken = () => useAuthStore.getState().token
