import { Redirect, useRouter } from 'expo-router';
import {
  useCloudAuthStore,
  useCloudComputers,
  useCloudMachinesStore,
  useLogoutMutation,
  useMachinesQuery,
} from '@ank1015-app/ui/cloud-hooks';

import { MobileMachinesScreen } from '@/components/mobile-machines-screen';
import { RouteStatusScreen } from '@/components/route-status-screen';

export default function MachinesScreen() {
  const router = useRouter();
  const authStatus = useCloudAuthStore((state) => state.status);
  const user = useCloudAuthStore((state) => state.user);
  const computers = useCloudComputers();
  const hasLoadedMachines = useCloudMachinesStore((state) => state.hasLoaded);
  const machinesError = useCloudMachinesStore((state) => state.error);
  const machinesQuery = useMachinesQuery();
  const logoutMutation = useLogoutMutation({
    onLogout: () => router.replace('/login'),
  });

  if (authStatus === 'checking') {
    return <RouteStatusScreen route="/machines" title="Checking Session" />;
  }

  if (authStatus === 'unauthenticated' || user === null) {
    return <Redirect href="/login" />;
  }

  if (!hasLoadedMachines) {
    return <RouteStatusScreen route="/machines" title="Loading Machines" />;
  }

  if (computers.length === 0 && machinesError === null) {
    return <Redirect href="/machines/create" />;
  }

  return (
    <MobileMachinesScreen
      computers={computers}
      error={machinesError}
      onCreateMachine={() => router.push('/machines/create')}
      onLogout={async () => {
        await logoutMutation.mutateAsync();
      }}
      onOpenMachine={(computer) => {
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
