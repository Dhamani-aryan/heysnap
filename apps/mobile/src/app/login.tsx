import { Redirect, useRouter } from 'expo-router';
import {
  useCloudAuthStore,
  useCloudRuntime,
  useLoginMutation,
} from '@ank1015-app/ui/cloud-hooks';

import { MobileLoginScreen } from '@/components/mobile-login-screen';
import { RouteStatusScreen } from '@/components/route-status-screen';

export default function LoginScreen() {
  const router = useRouter();
  const authStore = useCloudRuntime().authStore;
  const authStatus = useCloudAuthStore((state) => state.status);
  const user = useCloudAuthStore((state) => state.user);
  const loginMutation = useLoginMutation();
  const loginError = loginMutation.error instanceof Error ? loginMutation.error.message : null;

  if (authStatus === 'checking') {
    return <RouteStatusScreen route="/login" title="Checking Session" />;
  }

  if (authStatus === 'authenticated' && user !== null) {
    return <Redirect href="/machines" />;
  }

  return (
    <MobileLoginScreen
      error={loginError}
      isSubmitting={loginMutation.isPending}
      onSuccessComplete={() => {
        authStore.getState().completeLogin();
        router.replace('/machines');
      }}
      onSubmit={async (input) => {
        try {
          await loginMutation.mutateAsync(input);
          return true;
        } catch {
          return false;
        }
      }}
    />
  );
}
