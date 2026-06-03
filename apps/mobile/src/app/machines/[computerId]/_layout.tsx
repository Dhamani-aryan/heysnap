import { useEffect, useState } from 'react';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { Redirect, useLocalSearchParams, usePathname, withLayoutContext } from 'expo-router';
import { StyleSheet, useColorScheme, View } from 'react-native';

import { DebugErrorBoundary } from '@/components/debug-error-boundary';
import { MobileMachineWorkspaceProvider } from '@/components/mobile-machine-workspace-provider';
import { MobileWorkspaceVoiceOverlay } from '@/components/machine-voice/mobile-workspace-voice-overlay';
import { Colors } from '@/constants/theme';

const { Navigator } = createMaterialTopTabNavigator();
const BROWSER_VOICE_OVERLAY_BOTTOM_OFFSET = 74;
type VoiceSurface = 'filesystem' | 'browser' | 'agent';
// Expo Router wrapper so file-based routes become pages of a horizontal swipe pager.
// The tab bar itself is hidden;
// users navigate by swiping the screen left/right.
const SwipeTabs = withLayoutContext(Navigator);

export default function MachineLayout() {
  const scheme = useColorScheme();
  const pathname = usePathname();
  const [activeVoiceSurface, setActiveVoiceSurface] = useState<VoiceSurface>(
    getVoiceSurfaceFromPathname(pathname),
  );
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const params = useLocalSearchParams<{ computerId?: string | string[] }>();
  const computerIdParam = params.computerId;
  const computerId = Array.isArray(computerIdParam) ? computerIdParam[0] : computerIdParam;

  useEffect(() => {
    setActiveVoiceSurface(getVoiceSurfaceFromPathname(pathname));
  }, [pathname]);

  if (computerId === undefined || computerId.length === 0) {
    return <Redirect href="/machines" />;
  }

  const isAgentTab = activeVoiceSurface === 'agent';
  const isBrowserTab = activeVoiceSurface === 'browser';

  return (
    <DebugErrorBoundary label="machines/[computerId]">
      <MobileMachineWorkspaceProvider computerId={computerId}>
        <View style={styles.shell}>
          <SwipeTabs
            initialRouteName="index"
            tabBar={() => null}
            screenOptions={{
              swipeEnabled: true,
              lazy: false,
              sceneStyle: { backgroundColor: colors.background },
            }}>
            <SwipeTabs.Screen
              name="overview"
              listeners={{
                focus: () => setActiveVoiceSurface('browser'),
              }}
            />
            <SwipeTabs.Screen
              name="index"
              listeners={{
                focus: () => setActiveVoiceSurface('filesystem'),
              }}
            />
            <SwipeTabs.Screen
              name="agent"
              listeners={{
                focus: () => setActiveVoiceSurface('agent'),
              }}
            />
          </SwipeTabs>
          {isAgentTab ? null : (
            <MobileWorkspaceVoiceOverlay
              bottomOffset={isBrowserTab ? BROWSER_VOICE_OVERLAY_BOTTOM_OFFSET : undefined}
              sourceSurface={isBrowserTab ? 'browser' : 'filesystem'}
            />
          )}
        </View>
      </MobileMachineWorkspaceProvider>
    </DebugErrorBoundary>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
});

function getVoiceSurfaceFromPathname(pathname: string): VoiceSurface {
  if (pathname.endsWith('/agent')) return 'agent';
  if (pathname.endsWith('/overview')) return 'browser';
  return 'filesystem';
}
