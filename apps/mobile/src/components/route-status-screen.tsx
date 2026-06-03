import { ActivityIndicator, StyleSheet } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';

type RouteStatusScreenProps = {
  route: string;
  title: string;
};

export function RouteStatusScreen({ route, title }: RouteStatusScreenProps) {
  const theme = useTheme();

  return (
    <ThemedView
      accessibilityLabel={`${title} ${route}`}
      accessibilityRole="progressbar"
      style={styles.container}
    >
      <ActivityIndicator color={theme.textSecondary} size="large" />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
