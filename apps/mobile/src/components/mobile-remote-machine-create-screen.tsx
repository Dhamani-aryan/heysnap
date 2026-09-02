import { LogoutSquare01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  ImageStyle,
  Pressable,
  StyleSheet,
  TextStyle,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts } from '@/constants/theme';
import { useResolvedTheme } from '@/hooks/use-resolved-theme';
import type { CloudUser } from '@/lib/auth/auth-api';

type MobileRemoteMachineCreateScreenProps = {
  error: string | null;
  isSubmitting: boolean;
  onCreateMachine: (input: { readonly name: string }) => Promise<void>;
  onLogout: () => Promise<void>;
  user: CloudUser;
};

const macLightImage = require('../../assets/images/mac-light.png');
const macDarkImage = require('../../assets/images/mac.png');
const DOT_COUNT = 23;

export function MobileRemoteMachineCreateScreen({
  error,
  isSubmitting,
  onCreateMachine,
  onLogout,
  user,
}: MobileRemoteMachineCreateScreenProps) {
  const resolvedTheme = useResolvedTheme();
  const { width } = useWindowDimensions();
  const palette = cloudCreatePalettes[resolvedTheme];
  const machineName = createDefaultMachineName(user.username);
  const styles = useMemo(() => createStyles(palette), [palette]);
  const artSize = Math.min(width * 0.78, 280);
  const imageSource = resolvedTheme === 'dark' ? macDarkImage : macLightImage;
  const dots = useMemo(() => createDotGrid(DOT_COUNT), []);

  return (
    <ThemedView style={[styles.shell, { backgroundColor: palette.background }]}>
      <SafeAreaView edges={['top']} style={styles.topbar}>
        <Pressable
          accessibilityLabel="Logout"
          accessibilityRole="button"
          onPress={() => void onLogout()}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <HugeiconsIcon
            icon={LogoutSquare01Icon}
            size={18}
            color={palette.icon}
            strokeWidth={1.8}
          />
        </Pressable>
      </SafeAreaView>

      <View style={styles.onboarding}>
        <View style={styles.content}>
          <ThemedText style={[styles.title, { color: palette.heading }]}>
            Your personal, private, AI computer
          </ThemedText>

          <View
            accessible={false}
            style={[styles.art, { width: artSize, height: artSize }]}>
            <View style={styles.dotField}>
              {dots.map((dot) => (
                <View
                  key={dot.key}
                  style={[
                    styles.dot,
                    {
                      left: `${dot.x}%`,
                      opacity: dot.opacity,
                      top: `${dot.y}%`,
                    },
                  ]}
                />
              ))}
            </View>
            <Image contentFit="contain" source={imageSource} style={styles.machineImage} />
          </View>

          <View accessibilityLabel="Machine name" style={styles.machineName}>
            <ThemedText style={[styles.machineNameText, { color: palette.text }]}>
              {machineName}
            </ThemedText>
          </View>

          {error !== null ? (
            <View accessibilityRole="alert" style={styles.errorBox}>
              <ThemedText style={[styles.errorText, { color: palette.danger }]}>
                {error}
              </ThemedText>
            </View>
          ) : null}

          <Pressable
            accessibilityLabel={isSubmitting ? 'Creating remote machine' : undefined}
            accessibilityRole="button"
            disabled={isSubmitting || machineName.length === 0}
            onPress={() => {
              if (machineName.length === 0 || isSubmitting) {
                return;
              }

              void onCreateMachine({ name: machineName });
            }}
            style={({ pressed }) => [
              styles.createButton,
              { backgroundColor: palette.accent },
              (isSubmitting || machineName.length === 0) && styles.disabled,
              pressed && !isSubmitting ? styles.pressed : null,
            ]}>
            {isSubmitting ? (
              <ButtonLoader color={palette.accentText} />
            ) : (
              <ThemedText style={[styles.createButtonText, { color: palette.accentText }]}>
                Create
              </ThemedText>
            )}
          </Pressable>
        </View>
      </View>
    </ThemedView>
  );
}

function ButtonLoader({ color }: { color: string }) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 720,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    animation.start();
    return () => animation.stop();
  }, [rotation]);

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      style={[
        stylesStatic.loader,
        {
          borderColor: color,
          borderRightColor: 'transparent',
          transform: [{ rotate }],
        },
      ]}
    />
  );
}

const createDefaultMachineName = (username: string): string => {
  const trimmed = username.trim();

  if (trimmed.length === 0) {
    return '';
  }

  return `${trimmed[0]!.toUpperCase()}${trimmed.slice(1)}'s Computer`;
};

const createDotGrid = (count: number) => {
  const center = (count - 1) / 2;
  const maxDistance = Math.sqrt(center ** 2 + center ** 2);

  return Array.from({ length: count * count }, (_, index) => {
    const row = Math.floor(index / count);
    const column = index % count;
    const distance = Math.sqrt((row - center) ** 2 + (column - center) ** 2);
    const falloff = Math.max(0, 1 - distance / maxDistance);

    return {
      key: `${row}:${column}`,
      opacity: 0.24 + falloff * 0.2,
      x: (column / (count - 1)) * 100,
      y: (row / (count - 1)) * 100,
    };
  });
};

const cloudCreatePalettes = {
  light: {
    background: '#fcfcfd',
    heading: '#252629',
    text: '#1b1b1b',
    icon: '#5d5d5f',
    dot: 'rgba(74, 80, 92, 0.52)',
    danger: '#b42318',
    dangerBackground: 'rgba(229, 72, 77, 0.08)',
    accent: '#111111',
    accentText: '#ffffff',
  },
  dark: {
    background: '#0f0f10',
    heading: '#e3e4e6',
    text: '#ffffff',
    icon: '#949496',
    dot: 'rgba(74, 80, 92, 0.52)',
    danger: '#f87171',
    dangerBackground: 'rgba(229, 72, 77, 0.12)',
    accent: '#f5f5f5',
    accentText: '#0f0f11',
  },
} as const;

type CloudCreatePalette = (typeof cloudCreatePalettes)[keyof typeof cloudCreatePalettes];

type CreateScreenStyles = {
  shell: ViewStyle;
  topbar: ViewStyle;
  iconButton: ViewStyle;
  onboarding: ViewStyle;
  content: ViewStyle;
  title: TextStyle;
  art: ViewStyle;
  dotField: ViewStyle;
  dot: ViewStyle;
  machineImage: ImageStyle;
  machineName: ViewStyle;
  machineNameText: TextStyle;
  errorBox: ViewStyle;
  errorText: TextStyle;
  createButton: ViewStyle;
  createButtonText: TextStyle;
  disabled: ViewStyle;
  pressed: ViewStyle;
};

const createStyles = (palette: CloudCreatePalette) =>
  StyleSheet.create<CreateScreenStyles>({
    shell: {
      flex: 1,
    },
    topbar: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      paddingHorizontal: 12,
      backgroundColor: palette.background,
    },
    iconButton: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
      backgroundColor: 'transparent',
    },
    onboarding: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingBottom: 96,
    },
    content: {
      width: '100%',
      maxWidth: 420,
      alignItems: 'center',
      gap: 20,
    },
    title: {
      maxWidth: 420,
      textAlign: 'center',
      fontFamily: Fonts.sans,
      fontSize: 28,
      fontWeight: '300',
      lineHeight: 28,
    },
    art: {
      position: 'relative',
      marginTop: 4,
      marginBottom: -10,
    },
    dotField: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      overflow: 'hidden',
      borderRadius: 10,
    },
    dot: {
      position: 'absolute',
      width: 3,
      height: 3,
      marginTop: -1.5,
      marginLeft: -1.5,
      borderRadius: 999,
      backgroundColor: palette.dot,
    },
    machineImage: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 1,
      width: '100%',
      height: '100%',
      transform: [{ translateY: 14 }],
    },
    machineName: {
      width: '100%',
      maxWidth: 280,
      alignItems: 'center',
      marginTop: -4,
    },
    machineNameText: {
      maxWidth: '100%',
      textAlign: 'center',
      fontFamily: Fonts.sans,
      fontSize: 20,
      fontWeight: '500',
      lineHeight: 24,
    },
    errorBox: {
      width: '100%',
      borderWidth: 1,
      borderColor: 'rgba(180, 35, 24, 0.22)',
      borderRadius: 8,
      backgroundColor: palette.dangerBackground,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    errorText: {
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center',
    },
    createButton: {
      width: '100%',
      maxWidth: 280,
      height: 42,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      marginTop: 18,
      paddingHorizontal: 14,
    },
    createButtonText: {
      fontFamily: Fonts.sans,
      fontSize: 16,
      fontWeight: '400',
      lineHeight: 20,
    },
    disabled: {
      opacity: 0.55,
    },
    pressed: {
      opacity: 0.72,
    },
  });

const stylesStatic = StyleSheet.create({
  loader: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderRadius: 999,
  },
});
