import '@/polyfills';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import {
  useCloudAuthStore,
  useCloudComputers,
  useCloudMachinesStore,
  useMachinesQuery,
} from '@ank1015-app/ui/cloud-hooks';

import { MobileCloudBootstrap, MobileCloudRuntimeProvider } from '@/cloud/mobile-cloud-runtime';

void SplashScreen.preventAutoHideAsync().catch(() => {
  // The splash screen can already be hidden during fast refresh or web startup.
});

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <MobileCloudRuntimeProvider>
            <MobileCloudBootstrap />
            <InitialRouteGate />
            <Stack
              screenOptions={{
                headerShown: false,
              }}
            />
          </MobileCloudRuntimeProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function InitialRouteGate() {
  const router = useRouter();
  const pathname = usePathname();
  const authStatus = useCloudAuthStore((state) => state.status);
  const user = useCloudAuthStore((state) => state.user);
  const computers = useCloudComputers();
  const hasLoadedMachines = useCloudMachinesStore((state) => state.hasLoaded);
  useMachinesQuery();

  const hasHiddenSplashRef = useRef(false);
  const hideSplash = useCallback(() => {
    if (hasHiddenSplashRef.current) {
      return;
    }

    hasHiddenSplashRef.current = true;
    void SplashScreen.hideAsync().catch(() => {
      // Native splash APIs are best-effort on web and during development reloads.
    });
  }, []);

  useEffect(() => {
    if (pathname !== '/') {
      hideSplash();
      return;
    }

    if (authStatus === 'checking') {
      return;
    }

    if (authStatus === 'unauthenticated' || user === null) {
      router.replace('/login');
      return;
    }

    if (!hasLoadedMachines) {
      return;
    }

    router.replace(computers.length === 0 ? '/machines/create' : '/machines');
  }, [authStatus, computers.length, hasLoadedMachines, hideSplash, pathname, router, user]);

  return null;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
