import { Redirect, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { MobileMachinesScreen } from '@/components/mobile-machines-screen';
import { RouteStatusScreen } from '@/components/route-status-screen';
import { useAuth } from '@/hooks/auth/use-auth';
import { useLogoutMutation } from '@/hooks/auth/use-auth-mutations';
import {
  accessSessionQueryOptions,
  machinesQueryOptions,
} from '@/lib/machines/machines-query';

export default function MachinesScreen() {
  const router = useRouter();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const machinesQuery = useQuery({
    ...machinesQueryOptions,
    enabled: auth.status === 'authenticated',
  });

  const logoutMutation = useLogoutMutation();
  const machinesError = machinesQuery.error instanceof Error ? machinesQuery.error.message : null;
  const computers = machinesQuery.data ?? [];

  useEffect(() => {
    if (auth.status !== 'authenticated' || machinesQuery.data === undefined) {
      return;
    }

    if (machinesQuery.data.length === 0) {
      router.replace('/machines/create');
    }
  }, [auth.status, machinesQuery.data, router]);

  if (auth.status === 'checking') {
    return <RouteStatusScreen route="/machines" title="Checking Session" />;
  }

  if (auth.status === 'unauthenticated' || auth.user === null) {
    return <Redirect href="/login?redirect=%2Fmachines" />;
  }

  if (
    machinesQuery.isPending ||
    (machinesQuery.data === undefined && machinesError === null)
  ) {
    return <RouteStatusScreen route="/machines" title="Loading Machines" />;
  }

  if (computers.length === 0 && machinesError === null) {
    return <RouteStatusScreen route="/machines" title="Loading Machines" />;
  }

  return (
    <MobileMachinesScreen
      computers={computers}
      error={machinesError}
      onCreateMachine={() => router.push('/machines/create')}
      onLogout={async () => {
        await logoutMutation.mutateAsync();
        router.replace('/login');
      }}
      onOpenMachine={(computer) => {
        void queryClient.prefetchQuery(accessSessionQueryOptions(computer.id));
        router.push({
          pathname: '/machines/[computerId]',
          params: { computerId: computer.id },
        });
      }}
      onRefresh={async () => {
        await machinesQuery.refetch();
      }}
    />
  );
}
