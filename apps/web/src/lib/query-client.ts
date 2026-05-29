import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from './api-client.ts'
import { useAuthStore } from '../stores/auth/auth-store.ts'

function handleAuthFailure(error: unknown) {
  if (error instanceof ApiError && error.isAuthFailure) {
    useAuthStore.getState().clear()
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleAuthFailure }),
  mutationCache: new MutationCache({ onError: handleAuthFailure }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.isAuthFailure) return false
        return failureCount < 2
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
})

export const authKeys = {
  me: ['auth', 'me'] as const,
}
