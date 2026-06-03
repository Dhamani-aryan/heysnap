import '@/polyfills';

import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/auth/use-auth';
import { useResolvedTheme } from '@/hooks/use-resolved-theme';
import type { CloudComputer } from '@/lib/machines/machines-api';
import {
  machinesKeys,
  machinesQueryOptions,
} from '@/lib/machines/machines-query';
import { queryClient } from '@/lib/query-client';

void SplashScreen.preventAutoHideAsync().catch(() => {
  // The splash screen can already be hidden during fast refresh or web startup.
});

export default function RootLayout() {
  const resolvedTheme = useResolvedTheme();
  const navigationTheme = useMemo(() => {
    const baseTheme = resolvedTheme === 'dark' ? DarkTheme : DefaultTheme;
    const colors = Colors[resolvedTheme];

    return {
      ...baseTheme,
      colors: {
        ...baseTheme.colors,
        primary: resolvedTheme === 'dark' ? '#408cff' : '#2563eb',
        background: colors.background,
        card: colors.backgroundElement,
        text: colors.heading,
        border: colors.border,
      },
    };
  }, [resolvedTheme]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <NavigationThemeProvider value={navigationTheme}>
          <QueryClientProvider client={queryClient}>
            <InitialRouteGate />
            <Stack
              screenOptions={{
                headerShown: false,
              }}
            />
          </QueryClientProvider>
        </NavigationThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function InitialRouteGate() {
  const router = useRouter();
  const pathname = usePathname();
  const auth = useAuth();
  const userId = auth.user?.id ?? null;

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
    let isActive = true;

    if (pathname !== '/') {
      hideSplash();
      return () => {
        isActive = false;
      };
    }

    if (auth.status === 'checking') {
      return () => {
        isActive = false;
      };
    }

    if (auth.status === 'unauthenticated' || userId === null) {
      router.replace('/login');
      return () => {
        isActive = false;
      };
    }

    void resolveAuthenticatedInitialRoute().then((target) => {
      if (!isActive) {
        return;
      }
      router.replace(target);
    });

    return () => {
      isActive = false;
    };
  }, [auth.status, hideSplash, pathname, router, userId]);

  return null;
}

async function resolveAuthenticatedInitialRoute(): Promise<
  '/machines' | '/machines/create'
> {
  try {
    const cachedMachines = queryClient.getQueryData<CloudComputer[]>(
      machinesKeys.list,
    );
    const machines =
      cachedMachines && cachedMachines.length > 0
        ? await queryClient.ensureQueryData(machinesQueryOptions)
        : await queryClient.fetchQuery(machinesQueryOptions);

    return machines.length === 0 ? '/machines/create' : '/machines';
  } catch {
    return '/machines';
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
