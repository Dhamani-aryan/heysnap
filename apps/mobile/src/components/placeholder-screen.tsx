import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/auth/use-auth';
import { machinesQueryOptions } from '@/lib/machines/machines-query';

type PlaceholderScreenProps = {
  route: string;
  title: string;
};

export function PlaceholderScreen({ route, title }: PlaceholderScreenProps) {
  const auth = useAuth();
  const machinesQuery = useQuery({
    ...machinesQueryOptions,
    enabled: auth.status === 'authenticated',
  });
  const computers = machinesQuery.data ?? [];
  const machinesError = machinesQuery.error instanceof Error
    ? machinesQuery.error.message
    : null;

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
            <ThemedText type="small">Auth: {auth.status}</ThemedText>
            <ThemedText type="small">
              User: {auth.user?.email ?? 'none'}
            </ThemedText>
            <ThemedText type="small">
              Machines: {machinesQuery.data !== undefined ? computers.length : 'not loaded'}
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
