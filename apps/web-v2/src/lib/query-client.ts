import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api-client.ts'

export const queryClient = new QueryClient({
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
