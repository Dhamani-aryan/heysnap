import { useEffect, useRef } from 'react';
import { Redirect, useRouter } from 'expo-router';

import { MobileRemoteMachineCreateScreen } from '@/components/mobile-remote-machine-create-screen';
import { RouteStatusScreen } from '@/components/route-status-screen';
import { useAuth } from '@/hooks/auth/use-auth';
import { useLogoutMutation } from '@/hooks/auth/use-auth-mutations';
import { useCreateComputerMutation } from '@/lib/machines/machines-mutations';

export default function CreateMachineScreen() {
  const router = useRouter();
  const auth = useAuth();
  const createMachineMutation = useCreateComputerMutation();
  const hasResetCreateStateRef = useRef(false);
  const logoutMutation = useLogoutMutation();

  useEffect(() => {
    if (hasResetCreateStateRef.current) {
      return;
    }

    hasResetCreateStateRef.current = true;
    createMachineMutation.reset();
  }, [createMachineMutation]);

  if (auth.status === 'checking') {
    return <RouteStatusScreen route="/machines/create" title="Checking Session" />;
  }

  if (auth.status === 'unauthenticated' || auth.user === null) {
    return <Redirect href="/login?redirect=%2Fmachines%2Fcreate" />;
  }

  const createMachineError = createMachineMutation.error instanceof Error
    ? createMachineMutation.error.message
    : null;

  return (
    <MobileRemoteMachineCreateScreen
      error={createMachineError}
      isSubmitting={createMachineMutation.isPending}
      onCreateMachine={async (input) => {
        try {
          await createMachineMutation.mutateAsync(input);
          router.replace('/machines');
        } catch {
          // The mutation stores the error for the form.
        }
      }}
      onLogout={async () => {
        await logoutMutation.mutateAsync();
        router.replace('/login');
      }}
      user={auth.user}
    />
  );
}
