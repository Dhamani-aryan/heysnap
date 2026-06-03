import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth/auth-store';
import { me, type CloudUser } from '@/lib/auth/auth-api';
import { ApiError } from '@/lib/api-client';
import { authKeys, queryClient } from '@/lib/query-client';

export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

export type AuthSnapshot = {
  status: AuthStatus;
  token: string | null;
  user: CloudUser | null;
};

export function useAuth(): AuthSnapshot {
  const token = useAuthStore((state) => state.token);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);

  const query = useQuery({
    queryKey: authKeys.me,
    queryFn: ({ signal }) => me(signal),
    enabled: hasHydrated && Boolean(token),
    staleTime: 60_000,
  });

  const isAuthFailure =
    query.isError &&
    query.error instanceof ApiError &&
    query.error.isAuthFailure;

  useEffect(() => {
    if (!isAuthFailure) return;
    useAuthStore.getState().clear();
    queryClient.removeQueries({ queryKey: authKeys.me });
  }, [isAuthFailure]);

  if (!hasHydrated) {
    return { status: 'checking', token: null, user: null };
  }

  if (!token) {
    return { status: 'unauthenticated', token: null, user: null };
  }

  if (isAuthFailure) {
    return { status: 'unauthenticated', token: null, user: null };
  }

  if (query.data) {
    return { status: 'authenticated', token, user: query.data };
  }

  return { status: 'checking', token, user: null };
}
