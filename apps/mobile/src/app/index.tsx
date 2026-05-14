import { Redirect } from 'expo-router';
import {
  useCloudAuthStore,
  useCloudComputers,
  useCloudMachinesStore,
  useMachinesQuery,
} from '@ank1015-app/ui/cloud-hooks';

import { RouteStatusScreen } from '@/components/route-status-screen';

export default function HomeScreen() {
  const authStatus = useCloudAuthStore((state) => state.status);
  const user = useCloudAuthStore((state) => state.user);
  const computers = useCloudComputers();
  const hasLoadedMachines = useCloudMachinesStore((state) => state.hasLoaded);
  const machinesQuery = useMachinesQuery();

  if (authStatus === 'checking') {
    return <RouteStatusScreen route="/" title="Checking Session" />;
  }

  if (authStatus === 'unauthenticated' || user === null) {
    return <Redirect href="/login" />;
  }

  if (!hasLoadedMachines) {
    return (
      <RouteStatusScreen
        route="/"
        title={machinesQuery.isFetching ? 'Loading Machines' : 'Preparing Machines'}
      />
    );
  }

  return <Redirect href={computers.length === 0 ? '/machines/create' : '/machines'} />;
}
