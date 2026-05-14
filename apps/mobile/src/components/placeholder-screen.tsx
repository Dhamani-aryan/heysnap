import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useCloudAuthStore,
  useCloudComputers,
  useCloudMachinesStore,
  useMachinesQuery,
} from '@ank1015-app/ui/cloud-hooks';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

type PlaceholderScreenProps = {
  route: string;
  title: string;
};

export function PlaceholderScreen({ route, title }: PlaceholderScreenProps) {
  const authStatus = useCloudAuthStore((state) => state.status);
  const user = useCloudAuthStore((state) => state.user);
  const computers = useCloudComputers();
  const hasLoadedMachines = useCloudMachinesStore((state) => state.hasLoaded);
  const machinesError = useCloudMachinesStore((state) => state.error);
  const machinesQuery = useMachinesQuery();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.appName}>
          HeySnap
        </ThemedText>
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="subtitle" style={styles.title}>
            {title}
          </ThemedText>
          <ThemedText type="code" themeColor="textSecondary">
            {route}
          </ThemedText>
          <ThemedView type="backgroundSelected" style={styles.statePanel}>
            <ThemedText type="small">Auth: {authStatus}</ThemedText>
            <ThemedText type="small">
              User: {user?.email ?? 'none'}
            </ThemedText>
            <ThemedText type="small">
              Machines: {hasLoadedMachines ? computers.length : 'not loaded'}
            </ThemedText>
            <ThemedText type="small">
              Query: {machinesQuery.isFetching ? 'fetching' : machinesQuery.status}
            </ThemedText>
            {machinesError !== null ? (
              <ThemedText type="small" themeColor="textSecondary">
                {machinesError}
              </ThemedText>
            ) : null}
          </ThemedView>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  appName: {
    fontSize: 28,
    lineHeight: 34,
  },
  card: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Spacing.two,
  },
  statePanel: {
    gap: Spacing.one,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
  },
});
