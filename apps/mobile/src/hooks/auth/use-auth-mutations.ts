import { useMutation } from '@tanstack/react-query';
import {
  login,
  logout,
  type AuthResponse,
} from '@/lib/auth/auth-api';
import { useAuthStore } from '@/stores/auth/auth-store';
import { authKeys, queryClient } from '@/lib/query-client';

export function useLoginMutation() {
  return useMutation({ mutationFn: login });
}

export function applyAuthSession(data: AuthResponse) {
  useAuthStore.getState().setToken(data.session.token);
  queryClient.setQueryData(authKeys.me, data.user);
}

export function useLogoutMutation() {
  return useMutation({
    mutationFn: async () => {
      try {
        await logout();
      } catch {
        // Best-effort: clear locally even if the server call fails.
      }
    },
    onSettled: () => {
      useAuthStore.getState().clear();
      queryClient.clear();
    },
  });
}
