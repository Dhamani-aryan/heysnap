import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Keyboard, Pressable, StyleSheet, View, useColorScheme } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { PlusSignIcon, WorkHistoryIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MobileAgentThreadDrawer } from '@/components/machine-agent/mobile-agent-thread-drawer';
import { MobileAgentComposer } from '@/components/machine-agent/mobile-agent-composer';
import { MobileAgentTimeline } from '@/components/machine-agent/mobile-agent-timeline';
import {
  mobileAgentPalettes,
  type MobileAgentPalette as Palette,
} from '@/components/machine-agent/mobile-agent-palette';
import { useMobileMachineWorkspace } from '@/components/mobile-machine-workspace-provider';
import { useAgentEditMessage } from '@/hooks/agent/use-agent-edit-message';
import { useAgentRun } from '@/hooks/agent/use-agent-run';
import { useAgentThread } from '@/hooks/agent/use-agent-thread';
import { useAuth } from '@/hooks/auth/use-auth';
import { buildMobileAgentUiContext } from '@/lib/agent/ui-context';
import {
  getNewThreadModelSelection,
  getThreadModelChoice,
} from '@/lib/agent/model-selection';
import type { AgentContent, AgentThreadSummary, AgentUiContext } from '@/lib/agent/types';
import { useAgentChatStore } from '@/stores/agent/agent-chat-store';
import { useAgentModelSelectionStore } from '@/stores/agent/agent-model-selection-store';

export default function MachineAgentScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = mobileAgentPalettes[scheme];
  const { agentBaseUrl, agentIdentity } = useMobileMachineWorkspace();

  if (agentBaseUrl === null || agentIdentity === null) {
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

  return (
    <AgentScreenContent
      agentBaseUrl={agentBaseUrl}
      agentIdentity={agentIdentity}
      scheme={scheme}
      palette={palette}
    />
  );
}

function AgentScreenContent({
  agentBaseUrl,
  agentIdentity,
  scheme,
  palette,
}: {
  agentBaseUrl: string;
  agentIdentity: string;
  scheme: 'light' | 'dark';
  palette: Palette;
}) {
  const router = useRouter();
  const auth = useAuth();
  const {
    computer,
    browserConnected,
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

  useAgentThread(selectedAgentThreadId, {
    agentBaseUrl,
    agentIdentity,
    onThreadResolved: (threadId) => {
      setSelectedAgentThreadId((current) => current ?? threadId);
    },
  });

  const isRunning = useAgentChatStore((state) => state.activeRun !== null);
  const hasMessages = useAgentChatStore((state) => state.messageOrder.length > 0);
  const loadStatus = useAgentChatStore((state) => state.loadStatus);
  const loadError = useAgentChatStore((state) => state.loadError);
  const runError = useAgentChatStore((state) => state.runError ?? state.error);
  const promptModelChoice = useAgentModelSelectionStore((state) => state.promptModelChoice);
  const setPromptModelChoice = useAgentModelSelectionStore((state) => state.setPromptModelChoice);

  const uiContext = useMemo<AgentUiContext>(
    () =>
      buildMobileAgentUiContext({
        browserConnected,
        openFilePath,
        sourceSurface: 'agent',
      }),
    [browserConnected, openFilePath],
  );

  const { cancel, submit, steer } = useAgentRun({
    agentBaseUrl,
    agentIdentity,
    currentPath,
    selectedThreadId: selectedAgentThreadId,
    uiContext,
    onThreadResolved: (threadId) => {
      setSelectedAgentThreadId((current) => current ?? threadId);
    },
  });

  const editMessage = useAgentEditMessage({
    agentBaseUrl,
    agentIdentity,
    currentPath,
    selectedThreadId: selectedAgentThreadId,
    uiContext,
    onThreadResolved: (threadId) => {
      setSelectedAgentThreadId((current) => current ?? threadId);
    },
  });

  const openDrawer = useCallback(() => {
    Keyboard.dismiss();
    setIsDrawerOpen(true);
  }, []);
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
    (input: { content: AgentContent }) => {
      if (isRunning) {
        return steer(input);
      }

      return submit({
        ...input,
        ...getNewThreadModelSelection({
          allowModelSelection: auth.user?.allowPiModels === true,
          selectedThreadId: selectedAgentThreadId,
          promptModelChoice,
        }),
      });
    },
    [auth.user?.allowPiModels, isRunning, promptModelChoice, selectedAgentThreadId, steer, submit],
  );

  const showEmpty = !hasMessages && !isRunning && selectedAgentThreadId === null && runError === null;
  const allowModelSelection = auth.user?.allowPiModels === true;
  const canChangeModel = allowModelSelection && selectedAgentThreadId === null && !isRunning;

  const composer = useMemo(
    () => (
      <MobileAgentComposer
        palette={palette}
        activeFolderName={currentDirectoryName}
        isRunning={isRunning}
        modelPicker={
          allowModelSelection
            ? {
                value:
                  selectedAgentThreadId === null
                    ? promptModelChoice
                    : getThreadModelChoice(selectedAgentThreadId),
                disabled: !canChangeModel,
                onChange: setPromptModelChoice,
              }
            : undefined
        }
        threadId={selectedAgentThreadId}
        onSubmit={composerSubmit}
        onCancel={cancel}
      />
    ),
    [
      allowModelSelection,
      canChangeModel,
      cancel,
      composerSubmit,
      currentDirectoryName,
      isRunning,
      palette,
      promptModelChoice,
      selectedAgentThreadId,
      setPromptModelChoice,
    ],
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
            onSubmitUserMessageEdit={editMessage.submit}
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
