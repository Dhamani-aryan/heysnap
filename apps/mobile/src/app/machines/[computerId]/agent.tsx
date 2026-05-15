import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Keyboard, Pressable, StyleSheet, View, useColorScheme } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { PlusSignIcon, WorkHistoryIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { useStore } from 'zustand';
import {
  useAgentChatStore,
  useAgentRunMutation,
  useAgentRuntime,
  useAgentThreadQuery,
  useCloseAgentRuntimeRunOnUnmount,
  type AgentThreadSummary,
  type AgentUiContext,
} from '@ank1015-app/ui/agent-hooks';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MobileAgentThreadDrawer } from '@/components/machine-agent/mobile-agent-thread-drawer';
import { MobileAgentComposer } from '@/components/machine-agent/mobile-agent-composer';
import { MobileAgentTimeline } from '@/components/machine-agent/mobile-agent-timeline';
import { useMobileMachineWorkspace } from '@/components/mobile-machine-workspace-provider';

export default function MachineAgentScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = scheme === 'dark' ? darkPalette : lightPalette;
  const { agentBaseUrl } = useMobileMachineWorkspace();

  if (agentBaseUrl === null) {
    return (
      <ThemedView style={[styles.shell, { backgroundColor: palette.background }]}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <View style={styles.center}>
            <ThemedText style={{ color: palette.textMuted }}>
              Connecting to the agent…
            </ThemedText>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return <AgentScreenContent scheme={scheme} palette={palette} />;
}

function AgentScreenContent({
  scheme,
  palette,
}: {
  scheme: 'light' | 'dark';
  palette: Palette;
}) {
  const router = useRouter();
  const {
    computer,
    currentPath,
    currentDirectoryName,
    openFile,
    openFilePath,
    selectedAgentThreadId,
    setSelectedAgentThreadId,
  } = useMobileMachineWorkspace();
  const insets = useSafeAreaInsets();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  useCloseAgentRuntimeRunOnUnmount();
  useAgentThreadQuery(selectedAgentThreadId, {
    onThreadResolved: (threadId) => {
      setSelectedAgentThreadId((current) => current ?? threadId);
    },
  });

  const runtime = useAgentRuntime();
  const isRunning = useStore(runtime.chatStore, (state) => state.activeRun !== null);
  const hasMessages = useAgentChatStore((state) => state.messageOrder.length > 0);
  const loadStatus = useAgentChatStore((state) => state.loadStatus);
  const loadError = useAgentChatStore((state) => state.loadError);
  const runError = useAgentChatStore((state) => state.runError ?? state.error);

  const uiContext = useMemo<AgentUiContext>(
    () => ({
      openFiles:
        openFilePath !== null ? [{ path: openFilePath, isFocused: true }] : [],
    }),
    [openFilePath],
  );

  const { cancel, submit, steer } = useAgentRunMutation({
    currentPath,
    selectedThreadId: selectedAgentThreadId,
    uiContext,
    onThreadResolved: (threadId) => {
      setSelectedAgentThreadId((current) => current ?? threadId);
    },
  });

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);

  const handleSelectThread = useCallback((thread: AgentThreadSummary) => {
    setSelectedAgentThreadId(thread.id);
  }, [setSelectedAgentThreadId]);

  const handleNewThread = useCallback(() => {
    setSelectedAgentThreadId(null);
  }, [setSelectedAgentThreadId]);

  const handleOpenFilePath = useCallback((path: string) => {
    openFile(path);

    if (computer !== null) {
      router.navigate({
        pathname: '/machines/[computerId]',
        params: { computerId: computer.id },
      });
    }
  }, [computer, openFile, router]);

  const composerSubmit = useCallback(
    (input: Parameters<typeof submit>[0]) => (isRunning ? steer(input) : submit(input)),
    [isRunning, steer, submit],
  );

  const showEmpty = !hasMessages && !isRunning && selectedAgentThreadId === null && runError === null;

  const composer = useMemo(
    () => (
      <MobileAgentComposer
        palette={palette}
        activeFolderName={currentDirectoryName}
        isRunning={isRunning}
        onSubmit={composerSubmit}
        onCancel={cancel}
      />
    ),
    [cancel, composerSubmit, currentDirectoryName, isRunning, palette],
  );

  return (
    <ThemedView style={[styles.shell, { backgroundColor: palette.background }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: palette.background }}>
        <View style={[styles.header, { borderBottomColor: palette.border }]}>
          <Pressable
            accessibilityLabel="Chat history"
            accessibilityRole="button"
            hitSlop={12}
            onPress={openDrawer}
            style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.6 }]}>
            <HugeiconsIcon
              icon={WorkHistoryIcon}
              size={22}
              color={palette.textSecondary}
              strokeWidth={2}
            />
          </Pressable>
          <ThemedText numberOfLines={1} style={[styles.title, { color: palette.textPrimary }]}>
            Agent
          </ThemedText>
          <Pressable
            accessibilityLabel="New chat"
            accessibilityRole="button"
            hitSlop={12}
            onPress={handleNewThread}
            style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.6 }]}>
            <HugeiconsIcon
              icon={PlusSignIcon}
              size={22}
              color={palette.textSecondary}
              strokeWidth={2}
            />
          </Pressable>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={-insets.bottom}
        style={[styles.body, { backgroundColor: palette.background }]}>
        {loadError !== null ? (
          <Pressable onPress={dismissKeyboard} style={styles.errorRow}>
            <ThemedText style={{ color: palette.errorText }}>{loadError}</ThemedText>
          </Pressable>
        ) : null}

        {loadStatus === 'loading' && !hasMessages ? (
          <Pressable onPress={dismissKeyboard} style={styles.center}>
            <ThemedText style={{ color: palette.textMuted }}>Loading chat…</ThemedText>
          </Pressable>
        ) : showEmpty ? (
          <Pressable onPress={dismissKeyboard} style={styles.center}>
            <ThemedText
              numberOfLines={1}
              style={[styles.emptyTitle, { color: palette.textPrimary }]}>
              What would you like to do today?
            </ThemedText>
          </Pressable>
        ) : (
          <MobileAgentTimeline
            currentPath={currentPath}
            palette={palette}
            onOpenFilePath={handleOpenFilePath}
          />
        )}

        {runError === null ? null : (
          <View style={styles.errorRow}>
            <ThemedText style={{ color: palette.errorText }}>{runError}</ThemedText>
          </View>
        )}

        <View style={[styles.composerWrap, { paddingBottom: insets.bottom + 8 }]}>
          {composer}
        </View>
      </KeyboardAvoidingView>

      <MobileAgentThreadDrawer
        isOpen={isDrawerOpen}
        scheme={scheme}
        selectedThreadId={selectedAgentThreadId}
        onClose={closeDrawer}
        onSelectThread={handleSelectThread}
      />
    </ThemedView>
  );
}

type Palette = {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  errorText: string;
  codeBackground: string;
};

const lightPalette: Palette = {
  background: '#ffffff',
  surface: '#f7f7f7',
  surfaceMuted: '#eeeeee',
  border: 'rgba(0,0,0,0.08)',
  textPrimary: 'rgba(0,0,0,0.86)',
  textSecondary: 'rgba(0,0,0,0.58)',
  textMuted: 'rgba(0,0,0,0.4)',
  accent: '#0a84ff',
  errorText: '#c13e3e',
  codeBackground: '#f1f3f5',
};

const darkPalette: Palette = {
  background: '#000000',
  surface: '#19191B',
  surfaceMuted: '#262626',
  border: 'rgba(255,255,255,0.08)',
  textPrimary: 'rgba(255,255,255,0.92)',
  textSecondary: 'rgba(255,255,255,0.62)',
  textMuted: 'rgba(255,255,255,0.4)',
  accent: '#0a84ff',
  errorText: '#ff8a8a',
  codeBackground: '#0d0d12',
};

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 4,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorRow: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  composerWrap: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
  },
});
