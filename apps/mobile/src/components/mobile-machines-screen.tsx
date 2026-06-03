import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import {
  ImageStyle,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowRight02Icon, LogoutSquare01Icon, PlusSignIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useResolvedTheme } from '@/hooks/use-resolved-theme';
import type { CloudComputer } from '@/lib/machines/machines-api';

type MobileMachinesScreenProps = {
  computers: readonly CloudComputer[];
  error: string | null;
  onCreateMachine: () => void;
  onLogout: () => Promise<void>;
  onOpenMachine: (computer: CloudComputer) => void;
  onRefresh: () => Promise<void>;
};

const macLightImage = require('../../assets/images/mac-light.png');
const macDarkImage = require('../../assets/images/mac.png');
const newMacLightImage = require('../../assets/images/new-mac-light.png');
const newMacDarkImage = require('../../assets/images/new-mac.png');
const DOT_COUNT = 23;

export function MobileMachinesScreen({
  computers,
  error,
  onCreateMachine,
  onLogout,
  onOpenMachine,
  onRefresh,
}: MobileMachinesScreenProps) {
  const resolvedTheme = useResolvedTheme();
  const [isUserRefreshing, setIsUserRefreshing] = useState(false);
  const palette = cloudPalettes[resolvedTheme];
  const sortedComputers = useMemo(() => [...computers].sort(compareMachinesForDisplay), [computers]);
  const canCreateMachine = sortedComputers.length === 0;
  const styles = useMemo(() => createStyles(palette), [palette]);
  const handleRefresh = useCallback(() => {
    setIsUserRefreshing(true);
    void onRefresh().finally(() => setIsUserRefreshing(false));
  }, [onRefresh]);

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

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl
            refreshing={isUserRefreshing}
            tintColor={palette.text}
            onRefresh={handleRefresh}
          />
        )}
        style={styles.scrollView}>
        <View style={styles.header}>
          <ThemedText style={[styles.title, { color: palette.heading }]}>Computers</ThemedText>
          <ThemedText style={[styles.subtitle, { color: palette.subtitle }]}>
            Your personal, private, AI computers.
          </ThemedText>
        </View>

        {error !== null ? (
          <View style={styles.errorBox}>
            <ThemedText style={[styles.errorText, { color: palette.danger }]}>{error}</ThemedText>
          </View>
        ) : null}

        <View style={styles.grid}>
          {sortedComputers.map((computer) => (
            <MachineCard
              key={computer.id}
              computer={computer}
              palette={palette}
              onOpenMachine={onOpenMachine}
            />
          ))}

          {canCreateMachine ? (
            <Pressable
              accessibilityLabel="Create remote machine"
              accessibilityRole="button"
              onPress={onCreateMachine}
              style={({ pressed }) => [
                styles.card,
                styles.addCard,
                pressed && styles.pressed,
              ]}>
              <View style={styles.addArt}>
                <HugeiconsIcon
                  icon={PlusSignIcon}
                  size={34}
                  color={palette.muted}
                  strokeWidth={1.6}
                />
              </View>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function MachineCard({
  computer,
  palette,
  onOpenMachine,
}: {
  computer: CloudComputer;
  palette: CloudPalette;
  onOpenMachine: (computer: CloudComputer) => void;
}) {
  const resolvedTheme = useResolvedTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const isLocal = computer.kind === 'local';
  const displayStatus = getMachineDisplayStatus(computer);
  const canOpenMachine = displayStatus.canOpen;
  const dots = useMemo(() => createDotGrid(DOT_COUNT), []);
  const imageSource =
    resolvedTheme === 'dark'
      ? isLocal ? newMacDarkImage : macDarkImage
      : isLocal ? newMacLightImage : macLightImage;

  return (
    <Pressable
      accessibilityHint={canOpenMachine ? undefined : displayStatus.label}
      accessibilityLabel={`Work on ${computer.name}. Status: ${displayStatus.label}`}
      accessibilityRole="button"
      disabled={!canOpenMachine}
      onPress={() => onOpenMachine(computer)}
      style={({ pressed }) => [
        styles.card,
        styles.deviceCard,
        !canOpenMachine && styles.disabledCard,
        pressed && canOpenMachine ? styles.pressed : null,
      ]}>
      <View style={[styles.statusDot, { backgroundColor: getStatusColor(displayStatus.status) }]} />
      <View style={styles.statusPill}>
        <ThemedText style={[styles.statusText, { color: palette.cardText }]}>
          {displayStatus.label}
        </ThemedText>
      </View>
      <View style={styles.cardArt}>
        <View style={styles.dotPattern}>
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
        <Image
          contentFit="contain"
          source={imageSource}
          style={[styles.machineImage, isLocal && styles.localMachineImage]}
        />
      </View>
      <View style={styles.cardFooter}>
        <ThemedText numberOfLines={2} style={[styles.footerText, { color: palette.cardText }]}>
          Work on {computer.name}
        </ThemedText>
        {canOpenMachine ? (
          <HugeiconsIcon
            icon={ArrowRight02Icon}
            size={18}
            color={palette.cardText}
            strokeWidth={1.65}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const formatMachineStatus = (status: string): string =>
  status
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');

const getMachineDisplayStatus = (
  computer: CloudComputer,
): { status: string; label: string; canOpen: boolean } => {
  if (computer.kind === 'local' && computer.tunnelConnected !== true) {
    return {
      status: 'tunnel-disconnected',
      label: 'Tunnel disconnected',
      canOpen: false,
    };
  }

  return {
    status: computer.status,
    label: formatMachineStatus(computer.status),
    canOpen: computer.status !== 'creating' && computer.status !== 'starting' && computer.status !== 'failed',
  };
};

const compareMachinesForDisplay = (left: CloudComputer, right: CloudComputer): number => {
  const leftRank = left.kind === 'local' ? 1 : 0;
  const rightRank = right.kind === 'local' ? 1 : 0;

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  return left.createdAt.localeCompare(right.createdAt);
};

const getStatusColor = (status: string): string => {
  if (status === 'online' || status === 'idle') {
    return '#22c55e';
  }

  if (status === 'creating' || status === 'starting') {
    return '#f59e0b';
  }

  if (status === 'failed' || status === 'tunnel-disconnected') {
    return '#ef4444';
  }

  return '#9ca3af';
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

const cloudPalettes = {
  light: {
    background: '#fcfcfd',
    surface: '#ffffff',
    surfaceMuted: '#f5f5f5',
    cardBackground: '#fbfbfb',
    addBackground: '#f1f1f1',
    border: '#e5e5e5',
    cardBorder: 'rgba(0, 0, 0, 0.04)',
    text: '#1b1b1b',
    heading: '#252629',
    subtitle: '#6f7073',
    icon: '#5d5d5f',
    muted: 'rgba(0, 0, 0, 0.52)',
    cardText: '#37383b',
    danger: '#b42318',
    dangerBackground: 'rgba(229, 72, 77, 0.08)',
    patternDot: 'rgba(74, 80, 92, 0.55)',
    glowPrimary: 'rgba(143, 153, 178, 0.36)',
    glowSecondary: 'rgba(112, 144, 196, 0.18)',
    statusDotBorder: 'rgba(255, 255, 255, 0.86)',
    statusPillBackground: 'rgba(255, 255, 255, 0.86)',
    statusPillBorder: 'rgba(0, 0, 0, 0.06)',
  },
  dark: {
    background: '#0f0f10',
    surface: '#0f0f10',
    surfaceMuted: '#121214',
    cardBackground: '#111113',
    addBackground: '#171719',
    border: '#1f2021',
    cardBorder: 'rgba(255, 255, 255, 0.06)',
    text: '#ffffff',
    heading: '#e3e4e6',
    subtitle: '#737375',
    icon: '#949496',
    muted: 'rgba(255, 255, 255, 0.62)',
    cardText: '#d0d0d3',
    danger: '#f87171',
    dangerBackground: 'rgba(229, 72, 77, 0.12)',
    patternDot: 'rgba(148, 163, 184, 0.58)',
    glowPrimary: 'rgba(70, 130, 180, 0.24)',
    glowSecondary: 'rgba(153, 159, 222, 0.14)',
    statusDotBorder: 'rgba(17, 17, 19, 0.9)',
    statusPillBackground: 'rgba(24, 24, 27, 0.88)',
    statusPillBorder: 'rgba(255, 255, 255, 0.07)',
  },
} as const;

type CloudPalette = (typeof cloudPalettes)[keyof typeof cloudPalettes];

type MachineScreenStyles = {
  shell: ViewStyle;
  topbar: ViewStyle;
  iconButton: ViewStyle;
  scrollView: ViewStyle;
  content: ViewStyle;
  header: ViewStyle;
  title: TextStyle;
  subtitle: TextStyle;
  errorBox: ViewStyle;
  errorText: TextStyle;
  grid: ViewStyle;
  card: ViewStyle;
  deviceCard: ViewStyle;
  disabledCard: ViewStyle;
  addCard: ViewStyle;
  addArt: ViewStyle;
  statusDot: ViewStyle;
  statusPill: ViewStyle;
  statusText: TextStyle;
  cardArt: ViewStyle;
  dotPattern: ViewStyle;
  dot: ViewStyle;
  machineImage: ImageStyle;
  localMachineImage: ImageStyle;
  cardFooter: ViewStyle;
  footerText: TextStyle;
  pressed: ViewStyle;
};

const createStyles = (palette: CloudPalette) =>
  StyleSheet.create<MachineScreenStyles>({
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
    scrollView: {
      flex: 1,
    },
    content: {
      paddingHorizontal: Spacing.four,
      paddingTop: Spacing.three,
      paddingBottom: 48,
    },
    header: {
      gap: 10,
    },
    title: {
      fontFamily: Fonts.sans,
      fontSize: 28,
      fontWeight: '300',
      lineHeight: 30,
    },
    subtitle: {
      fontFamily: Fonts.sans,
      fontSize: 16,
      fontWeight: '300',
      lineHeight: 20,
    },
    errorBox: {
      marginTop: Spacing.four,
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
    },
    grid: {
      gap: 24,
      marginTop: 64,
    },
    card: {
      width: '100%',
      aspectRatio: 4 / 3,
      overflow: 'hidden',
      borderRadius: 12,
    },
    deviceCard: {
      borderWidth: 1,
      borderColor: palette.cardBorder,
      backgroundColor: palette.cardBackground,
    },
    disabledCard: {
      opacity: 0.82,
    },
    addCard: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.addBackground,
    },
    addArt: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    statusDot: {
      position: 'absolute',
      top: 12,
      left: 12,
      zIndex: 4,
      width: 12,
      height: 12,
      borderWidth: 2,
      borderColor: palette.statusDotBorder,
      borderRadius: 999,
    },
    statusPill: {
      position: 'absolute',
      top: 7,
      left: 31,
      zIndex: 4,
      minHeight: 22,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: palette.statusPillBorder,
      borderRadius: 999,
      backgroundColor: palette.statusPillBackground,
      paddingHorizontal: 8,
    },
    statusText: {
      fontSize: 11,
      fontWeight: '400',
      lineHeight: 14,
    },
    cardArt: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      padding: 28,
    },
    dotPattern: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      overflow: 'hidden',
      borderRadius: 10,
      backgroundColor: 'transparent',
    },
    dot: {
      position: 'absolute',
      width: 3,
      height: 3,
      marginTop: -1.5,
      marginLeft: -1.5,
      borderRadius: 999,
      backgroundColor: palette.patternDot,
    },
    machineImage: {
      zIndex: 2,
      width: '88%',
      height: '120%',
      transform: [{ translateY: 24 }],
    },
    localMachineImage: {
      width: '74%',
      height: '88%',
    },
    cardFooter: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 14,
      paddingHorizontal: 18,
    },
    footerText: {
      flex: 1,
      fontFamily: Fonts.sans,
      fontSize: 16,
      fontWeight: '300',
      lineHeight: 20,
    },
    pressed: {
      opacity: 0.72,
    },
  });
