import { useEffect, useRef } from 'react';
import { Redirect, useRouter } from 'expo-router';
import {
  useCloudAuthStore,
  useCloudMachinesStore,
  useCreateMachineMutation,
  useLogoutMutation,
  useMachinesQuery,
} from '@ank1015-app/ui/cloud-hooks';

import { MobileRemoteMachineCreateScreen } from '@/components/mobile-remote-machine-create-screen';
import { RouteStatusScreen } from '@/components/route-status-screen';

export default function CreateMachineScreen() {
  const router = useRouter();
  const authStatus = useCloudAuthStore((state) => state.status);
  const user = useCloudAuthStore((state) => state.user);
  const hasLoadedMachines = useCloudMachinesStore((state) => state.hasLoaded);
  const machinesError = useCloudMachinesStore((state) => state.error);
  const machinesQuery = useMachinesQuery();
  const createMachineMutation = useCreateMachineMutation();
  const hasResetCreateStateRef = useRef(false);
  const logoutMutation = useLogoutMutation({
    onLogout: () => router.replace('/login'),
  });

  useEffect(() => {
    if (hasResetCreateStateRef.current) {
      return;
    }

    hasResetCreateStateRef.current = true;
    createMachineMutation.reset();
  }, [createMachineMutation]);

  if (authStatus === 'checking') {
    return <RouteStatusScreen route="/machines/create" title="Checking Session" />;
  }

  if (authStatus === 'unauthenticated' || user === null) {
    return <Redirect href="/login" />;
  }

  if (!hasLoadedMachines) {
    return (
      <RouteStatusScreen
        route="/machines/create"
        title={machinesQuery.isFetching ? 'Loading Machines' : 'Preparing Machines'}
      />
    );
  }

  const createMachineError = createMachineMutation.error instanceof Error
    ? createMachineMutation.error.message
    : machinesError;

  return (
    <MobileRemoteMachineCreateScreen
      error={createMachineError}
      isSubmitting={createMachineMutation.isPending}
      onCreateMachine={async (input) => {
        try {
          await createMachineMutation.mutateAsync(input);
          await machinesQuery.refetch();
          router.replace('/machines');
        } catch {
          // The mutation stores the error for the form.
        }
      }}
      onLogout={async () => {
        await logoutMutation.mutateAsync();
      }}
      user={user}
    />
  );
}
