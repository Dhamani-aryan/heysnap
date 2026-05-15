import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { Redirect, useLocalSearchParams, withLayoutContext } from 'expo-router';
import { useColorScheme } from 'react-native';

import { DebugErrorBoundary } from '@/components/debug-error-boundary';
import { MobileMachineWorkspaceProvider } from '@/components/mobile-machine-workspace-provider';
import { Colors } from '@/constants/theme';

const { Navigator } = createMaterialTopTabNavigator();
// Expo Router wrapper so file-based routes (`index.tsx`, `agent.tsx`) become
// the two pages of a horizontal swipe pager. The tab bar itself is hidden;
// users navigate by swiping the screen left/right.
const SwipeTabs = withLayoutContext(Navigator);

export default function MachineLayout() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const params = useLocalSearchParams<{ computerId?: string | string[] }>();
  const computerIdParam = params.computerId;
  const computerId = Array.isArray(computerIdParam) ? computerIdParam[0] : computerIdParam;

  if (computerId === undefined || computerId.length === 0) {
    return <Redirect href="/machines" />;
  }

  return (
    <DebugErrorBoundary label="machines/[computerId]">
      <MobileMachineWorkspaceProvider computerId={computerId}>
        <SwipeTabs
          tabBar={() => null}
          screenOptions={{
            swipeEnabled: true,
            lazy: false,
            sceneStyle: { backgroundColor: colors.background },
          }}>
          <SwipeTabs.Screen name="index" />
          <SwipeTabs.Screen name="agent" />
        </SwipeTabs>
      </MobileMachineWorkspaceProvider>
    </DebugErrorBoundary>
  );
}
