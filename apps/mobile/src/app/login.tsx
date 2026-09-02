import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';

import { MobileLoginScreen } from '@/components/mobile-login-screen';
import { RouteStatusScreen } from '@/components/route-status-screen';
import { useAuth } from '@/hooks/auth/use-auth';
import {
  applyAuthSession,
  useLoginMutation,
} from '@/hooks/auth/use-auth-mutations';
import type { AuthResponse } from '@/lib/auth/auth-api';

export default function LoginScreen() {
  const router = useRouter();
  const search = useLocalSearchParams<{ redirect?: string | string[] }>();
  const auth = useAuth();
  const loginMutation = useLoginMutation();
  const pendingAuthRef = useRef<AuthResponse | null>(null);
  const loginError = loginMutation.error instanceof Error ? loginMutation.error.message : null;

  if (auth.status === 'checking') {
    return <RouteStatusScreen route="/login" title="Checking Session" />;
  }

  if (auth.status === 'authenticated' && auth.user !== null) {
    return <Redirect href="/machines" />;
  }

  return (
    <MobileLoginScreen
      error={loginError}
      isSubmitting={loginMutation.isPending}
      onSuccessComplete={() => {
        const pendingAuth = pendingAuthRef.current;
        pendingAuthRef.current = null;
        if (pendingAuth !== null) {
          applyAuthSession(pendingAuth);
        }
        router.replace(normalizeRedirect(search.redirect) ?? '/machines');
      }}
      onSubmit={async (input) => {
        try {
          pendingAuthRef.current = await loginMutation.mutateAsync(input);
          return true;
        } catch {
          return false;
        }
      }}
    />
  );
}

function normalizeRedirect(
  value: string | string[] | undefined,
): '/machines' | '/machines/create' | null {
  const redirect = Array.isArray(value) ? value[0] : value;
  if (redirect === '/machines' || redirect === '/machines/create') {
    return redirect;
  }
  return null;
}
