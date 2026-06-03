import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';

import { MobileAgentComposer } from '@/components/machine-agent/mobile-agent-composer';
import { mobileAgentPalettes } from '@/components/machine-agent/mobile-agent-palette';
import { useMobileMachineWorkspace } from '@/components/mobile-machine-workspace-provider';
import { ThemedText } from '@/components/themed-text';
import { useAgentRun } from '@/hooks/agent/use-agent-run';
import { useAuth } from '@/hooks/auth/use-auth';
import { getAssistantMarkdown } from '@/lib/agent/agent-events';
import {
  buildMobileAgentUiContext,
  type MobileAgentUiContextSurface,
} from '@/lib/agent/ui-context';
import { resolveMarkdownFileLinkMeta } from '@/lib/agent/markdown-links';
import { getNewThreadModelSelection, getThreadModelChoice } from '@/lib/agent/model-selection';
import type { AgentContent, AgentMessage, AgentUiContext } from '@/lib/agent/types';
import { appendPromptTranscript, transliterateSpeech } from '@/lib/sarvam-speech';
import { useAgentChatStore } from '@/stores/agent/agent-chat-store';
import { useAgentModelSelectionStore } from '@/stores/agent/agent-model-selection-store';
import { useAgentPromptFocusStore } from '@/stores/agent/agent-prompt-focus-store';
import {
  selectPromptDraft,
  useAgentPromptDraftStore,
} from '@/stores/agent/agent-prompt-draft-store';

const GRIP_COLLAPSED_WIDTH = 42;
const GRIP_COLLAPSED_HEIGHT = 10;
const GRIP_EXPANDED_WIDTH = 92;
const GRIP_EXPANDED_HEIGHT = 30;
const DEFAULT_BOTTOM_OFFSET = 20;
const KEYBOARD_OPEN_GAP = 16;

type VoiceRecordingState = 'idle' | 'starting' | 'recording' | 'transcribing';

type MobileWorkspaceVoiceOverlayProps = {
  bottomOffset?: number;
  sourceSurface: Extract<MobileAgentUiContextSurface, 'filesystem' | 'browser'>;
};

type AgentStatusResponse = {
  id: string;
  markdown: string;
  isStreaming: boolean;
};

type OverlayPalette = (typeof mobileAgentPalettes)['light'];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function MobileWorkspaceVoiceOverlay({
  bottomOffset = DEFAULT_BOTTOM_OFFSET,
  sourceSurface,
}: MobileWorkspaceVoiceOverlayProps) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = mobileAgentPalettes[scheme];
  const insets = useSafeAreaInsets();
  const windowDimensions = useWindowDimensions();
  const auth = useAuth();
  const {
    agentBaseUrl,
    agentIdentity,
    browserConnected,
    currentDirectoryName,
    currentPath,
    openFile,
    openFilePath,
    selectedAgentThreadId,
    setSelectedAgentThreadId,
  } = useMobileMachineWorkspace();
  const activeRun = useAgentChatStore((state) => state.activeRun);
  const promptModelChoice = useAgentModelSelectionStore((state) => state.promptModelChoice);
  const setPromptModelChoice = useAgentModelSelectionStore((state) => state.setPromptModelChoice);
  const draft = useAgentPromptDraftStore(selectPromptDraft(selectedAgentThreadId));
  const promptFocusToken = useAgentPromptFocusStore((state) => state.focusToken);
  const requestPromptFocus = useAgentPromptFocusStore((state) => state.requestFocus);
  const isRunning = activeRun !== null;
  const allowModelSelection = auth.user?.allowPiModels === true;
  const canChangeModel = allowModelSelection && selectedAgentThreadId === null && !isRunning;
  const canUseAgent = agentBaseUrl !== null && agentIdentity !== null;
  const hasPromptContent = draft.text.length > 0 || draft.attachments.length > 0;

  const uiContext = useMemo<AgentUiContext>(
    () =>
      buildMobileAgentUiContext({
        browserConnected,
        openFilePath,
        sourceSurface,
      }),
    [browserConnected, openFilePath, sourceSurface],
  );

  const { cancel, submit, steer } = useAgentRun({
    agentBaseUrl: agentBaseUrl ?? '',
    agentIdentity: agentIdentity ?? '',
    currentPath,
    selectedThreadId: selectedAgentThreadId,
    uiContext,
    onThreadResolved: (threadId) => {
      setSelectedAgentThreadId((current) => current ?? threadId);
    },
  });

  const handleSubmit = useCallback(
    (input: { content: AgentContent }) => {
      if (!canUseAgent) {
        return false;
      }

      if (isRunning) {
        return steer(input);
      }

      return submit({
        ...input,
        ...getNewThreadModelSelection({
          allowModelSelection,
          selectedThreadId: selectedAgentThreadId,
          promptModelChoice,
        }),
      });
    },
    [
      allowModelSelection,
      canUseAgent,
      isRunning,
      promptModelChoice,
      selectedAgentThreadId,
      steer,
      submit,
    ],
  );

  const handleTranscript = useCallback(
    (transcript: string) => {
      const draftState = useAgentPromptDraftStore.getState();
      const currentText = selectPromptDraft(selectedAgentThreadId)(draftState).text;
      draftState.setText(
        selectedAgentThreadId,
        appendPromptTranscript(currentText, transcript),
      );
      requestPromptFocus();
    },
    [requestPromptFocus, selectedAgentThreadId],
  );

  if (!canUseAgent) {
    return null;
  }

  const bottom = insets.bottom + bottomOffset;
  const stackWidth = Math.min(420, Math.max(0, windowDimensions.width - 32));

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={KEYBOARD_OPEN_GAP - bottom}
      pointerEvents="box-none"
      style={styles.keyboardAvoider}>
      <View pointerEvents="box-none" style={[styles.host, { paddingBottom: bottom }]}>
        <MobileWorkspaceAgentStatus
          currentPath={currentPath}
          palette={palette}
          width={stackWidth}
          onOpenFilePath={openFile}
        />
        {hasPromptContent ? (
          <View pointerEvents="box-none" style={[styles.promptWrap, { width: stackWidth }]}>
            <MobileAgentComposer
              activeFolderName={currentDirectoryName}
              autoFocus
              autoFocusToken={promptFocusToken}
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
              palette={palette}
              threadId={selectedAgentThreadId}
              onCancel={cancel}
              onSubmit={handleSubmit}
            />
          </View>
        ) : null}
        <VoiceGripButton
          disabled={!canUseAgent}
          dotColor={scheme === 'dark' ? 'rgba(166,166,166,0.82)' : 'rgba(0,0,0,0.56)'}
          paletteMode={scheme}
          onTranscript={handleTranscript}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function MobileWorkspaceAgentStatus({
  currentPath,
  onOpenFilePath,
  palette,
  width,
}: {
  currentPath: string;
  onOpenFilePath: (path: string) => void;
  palette: OverlayPalette;
  width: number;
}) {
  const activeRun = useAgentChatStore((state) => state.activeRun);
  const messageOrder = useAgentChatStore((state) => state.messageOrder);
  const messagesById = useAgentChatStore((state) => state.messagesById);
  const streamingMessageIds = useAgentChatStore((state) => state.streamingMessageIds);
  const latestAssistantResponse = useMemo<AgentStatusResponse | null>(() => {
    if (activeRun === null) return null;

    const lastUserMessageIndex = findLastUserMessageIndex(messageOrder, messagesById);
    let latestResponse: AgentStatusResponse | null = null;

    for (const messageId of messageOrder.slice(lastUserMessageIndex + 1)) {
      const message = messagesById[messageId];
      if (message?.role !== 'assistant') continue;

      const markdown = getAssistantMarkdown(message);
      if (markdown.length === 0) continue;

      latestResponse = {
        id: messageId,
        markdown,
        isStreaming: streamingMessageIds.includes(messageId),
      };
    }

    return latestResponse;
  }, [activeRun, messageOrder, messagesById, streamingMessageIds]);

  const isAgentRunning = activeRun !== null;
  const [retainedAssistantResponse, setRetainedAssistantResponse] =
    useState<AgentStatusResponse | null>(null);
  const latestAssistantResponseRef = useRef<AgentStatusResponse | null>(null);
  const wasAgentRunningRef = useRef(isAgentRunning);
  const markdownStyles = useMemo(() => buildStatusMarkdownStyles(palette), [palette]);

  useEffect(() => {
    if (!isAgentRunning || latestAssistantResponse === null) return;

    latestAssistantResponseRef.current = latestAssistantResponse;
    const timeoutId = setTimeout(() => {
      setRetainedAssistantResponse(null);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [isAgentRunning, latestAssistantResponse]);

  useEffect(() => {
    if (isAgentRunning) {
      wasAgentRunningRef.current = true;
      return;
    }

    if (!wasAgentRunningRef.current) return;

    wasAgentRunningRef.current = false;
    const finalResponse = latestAssistantResponse ?? latestAssistantResponseRef.current;

    if (finalResponse === null) return;

    let clearTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const retainTimeoutId = setTimeout(() => {
      setRetainedAssistantResponse({ ...finalResponse, isStreaming: false });
      clearTimeoutId = setTimeout(() => {
        setRetainedAssistantResponse(null);
      }, 10_000);
    }, 0);

    return () => {
      clearTimeout(retainTimeoutId);
      if (clearTimeoutId !== null) {
        clearTimeout(clearTimeoutId);
      }
    };
  }, [isAgentRunning, latestAssistantResponse]);

  const visibleAssistantResponse = isAgentRunning
    ? latestAssistantResponse
    : retainedAssistantResponse;

  if (!isAgentRunning && retainedAssistantResponse === null) return null;

  const handleLinkPress = (href: string): boolean => {
    const meta = resolveMarkdownFileLinkMeta(href, currentPath, undefined);

    if (meta === null) {
      return true;
    }

    onOpenFilePath(meta.targetPath);
    return false;
  };

  return (
    <View
      accessibilityLiveRegion="polite"
      pointerEvents="auto"
      style={[
        styles.statusDialog,
        {
          width: visibleAssistantResponse === null ? undefined : width,
          maxWidth: width,
          backgroundColor: palette.surface,
          borderColor: palette.border,
        },
        visibleAssistantResponse === null && styles.statusDialogWorking,
      ]}>
      {visibleAssistantResponse === null ? (
        <ThemedText style={[styles.statusWorkingText, { color: palette.textMuted }]}>
          Working
        </ThemedText>
      ) : (
        <ScrollView
          bounces={false}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          style={styles.statusScroll}>
          <Markdown onLinkPress={handleLinkPress} style={markdownStyles}>
            {visibleAssistantResponse.markdown}
          </Markdown>
        </ScrollView>
      )}
    </View>
  );
}

function VoiceGripButton({
  disabled,
  dotColor,
  paletteMode,
  onTranscript,
}: {
  disabled?: boolean;
  dotColor: string;
  paletteMode: 'light' | 'dark';
  onTranscript: (transcript: string) => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recordingStateRef = useRef<VoiceRecordingState>('idle');
  const recordingStartedAtRef = useRef<number | null>(null);
  const progress = useSharedValue(0);
  const [recordingState, setRecordingState] = useState<VoiceRecordingState>('idle');

  const setState = useCallback((state: VoiceRecordingState) => {
    recordingStateRef.current = state;
    setRecordingState(state);
  }, []);

  useEffect(() => {
    progress.value = withTiming(recordingState === 'idle' ? 0 : 1, {
      duration: 170,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, recordingState]);

  const buttonStyle = useAnimatedStyle(() => {
    const width =
      GRIP_COLLAPSED_WIDTH +
      (GRIP_EXPANDED_WIDTH - GRIP_COLLAPSED_WIDTH) * progress.value;
    const height =
      GRIP_COLLAPSED_HEIGHT +
      (GRIP_EXPANDED_HEIGHT - GRIP_COLLAPSED_HEIGHT) * progress.value;

    return {
      width,
      height,
      borderRadius: height / 2,
    };
  });

  const dotsStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.76 + progress.value * 0.24 }],
  }));

  const resetRecording = useCallback(() => {
    recordingStartedAtRef.current = null;
    setState('idle');
  }, [setState]);

  const stopRecording = useCallback(() => {
    if (recordingStateRef.current !== 'recording') {
      return;
    }

    const durationSeconds = getRecordingDurationSeconds({
      currentTime: recorder.currentTime,
      durationMillis: recorder.getStatus().durationMillis,
      startedAt: recordingStartedAtRef.current,
    });

    setState('transcribing');

    void (async () => {
      try {
        await recorder.stop();
        const recordingUri = recorder.uri ?? recorder.getStatus().url;

        if (recordingUri === null) {
          throw new Error('Recording did not produce an audio file.');
        }

        const transcript = await transliterateSpeech(recordingUri, { durationSeconds });
        onTranscript(transcript);
      } catch (error) {
        Alert.alert(
          'Speech-to-text',
          error instanceof Error ? error.message : 'Could not transcribe audio.',
        );
      } finally {
        resetRecording();
      }
    })();
  }, [onTranscript, recorder, resetRecording, setState]);

  const startRecording = useCallback(() => {
    if (disabled || recordingStateRef.current !== 'idle') {
      return;
    }

    setState('starting');

    void (async () => {
      try {
        const permission = await requestRecordingPermissionsAsync();

        if (!permission.granted) {
          Alert.alert('Microphone Permission', 'Microphone access is needed for voice input.');
          resetRecording();
          return;
        }

        await setAudioModeAsync({
          allowsRecording: true,
          interruptionMode: 'doNotMix',
          interruptionModeAndroid: 'doNotMix',
          playsInSilentMode: true,
          shouldPlayInBackground: false,
        });
        await recorder.prepareToRecordAsync({ isMeteringEnabled: true });

        if (recordingStateRef.current !== 'starting') {
          await recorder.stop().catch(() => undefined);
          return;
        }

        recorder.record();
        recordingStartedAtRef.current = Date.now();
        setState('recording');
      } catch (error) {
        Alert.alert(
          'Microphone',
          error instanceof Error ? error.message : 'Could not start microphone input.',
        );
        resetRecording();
      }
    })();
  }, [disabled, recorder, resetRecording, setState]);

  const handlePress = useCallback(() => {
    if (recordingState === 'recording') {
      stopRecording();
      return;
    }

    if (recordingState === 'idle') {
      startRecording();
    }
  }, [recordingState, startRecording, stopRecording]);

  useEffect(() => {
    return () => {
      recordingStartedAtRef.current = null;
      void recorder.stop().catch(() => undefined);
    };
  }, [recorder]);

  const isRecording = recordingState === 'recording';
  const isLoading = recordingState === 'starting' || recordingState === 'transcribing';
  const backgroundColor =
    paletteMode === 'dark' ? 'rgba(6,6,6,0.96)' : 'rgba(232,232,234,0.97)';
  const collapsedBackgroundColor =
    paletteMode === 'dark' ? 'rgba(8,8,8,0.94)' : 'rgba(218,218,220,0.95)';
  const borderColor =
    paletteMode === 'dark' ? 'rgba(150,150,150,0.58)' : 'rgba(0,0,0,0.14)';

  return (
    <AnimatedPressable
      accessibilityLabel={getVoiceGripAccessibilityLabel(recordingState)}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: isLoading }}
      disabled={disabled || isLoading}
      onPress={handlePress}
      style={[
        styles.grip,
        {
          backgroundColor: recordingState === 'idle' ? collapsedBackgroundColor : backgroundColor,
          borderColor,
          opacity: disabled ? 0.46 : 1,
        },
        buttonStyle,
      ]}>
      {isLoading ? (
        <View pointerEvents="none" style={styles.loadingDots}>
          {[0, 1, 2].map((index) => (
            <LoadingDot key={index} color={dotColor} index={index} />
          ))}
        </View>
      ) : (
        <Animated.View
          pointerEvents="none"
          style={[
            isRecording ? styles.recordingDots : styles.idleDots,
            dotsStyle,
          ]}>
          {Array.from({ length: 8 }, (_, index) => (
            <VoiceDot
              key={index}
              color={dotColor}
              index={index}
              isRecording={isRecording}
            />
          ))}
        </Animated.View>
      )}
    </AnimatedPressable>
  );
}

function VoiceDot({
  color,
  index,
  isRecording,
}: {
  color: string;
  index: number;
  isRecording: boolean;
}) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!isRecording) {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 120 });
      return;
    }

    pulse.value = withDelay(
      getRecordingDelay(index),
      withRepeat(
        withSequence(
          withTiming(1, { duration: 520, easing: Easing.inOut(Easing.cubic) }),
          withTiming(0, { duration: 660, easing: Easing.inOut(Easing.cubic) }),
        ),
        -1,
        false,
      ),
    );

    return () => {
      cancelAnimation(pulse);
    };
  }, [index, isRecording, pulse]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: 1 + pulse.value * 3.2 }],
  }));

  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

function LoadingDot({ color, index }: { color: string; index: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      index * 140,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 475, easing: Easing.inOut(Easing.cubic) }),
          withTiming(0, { duration: 475, easing: Easing.inOut(Easing.cubic) }),
        ),
        -1,
        false,
      ),
    );

    return () => {
      cancelAnimation(progress);
    };
  }, [index, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.48 + progress.value * 0.48,
    transform: [{ translateY: 3 - progress.value * 6 }],
  }));

  return <Animated.View style={[styles.loadingDot, { backgroundColor: color }, style]} />;
}

const getRecordingDelay = (index: number): number => {
  const delays = [0, 120, 240, 360, 180, 60, 300, 420];
  return delays[index] ?? 0;
};

const getVoiceGripAccessibilityLabel = (state: VoiceRecordingState): string => {
  if (state === 'recording') return 'Stop voice input';
  if (state === 'starting') return 'Starting voice input';
  if (state === 'transcribing') return 'Transcribing voice input';
  return 'Start voice input';
};

const getRecordingDurationSeconds = ({
  currentTime,
  durationMillis,
  startedAt,
}: {
  currentTime: number;
  durationMillis: number;
  startedAt: number | null;
}): number | undefined => {
  const candidates = [
    Number.isFinite(currentTime) ? currentTime : 0,
    Number.isFinite(durationMillis) ? durationMillis / 1000 : 0,
    startedAt === null ? 0 : (Date.now() - startedAt) / 1000,
  ].filter((value) => value > 0);

  if (candidates.length === 0) {
    return undefined;
  }

  return Math.max(...candidates);
};

const findLastUserMessageIndex = (
  messageOrder: readonly string[],
  messagesById: Readonly<Record<string, AgentMessage>>,
): number => {
  for (let index = messageOrder.length - 1; index >= 0; index -= 1) {
    const messageId = messageOrder[index];
    const message = messageId === undefined ? undefined : messagesById[messageId];

    if (message?.role === 'user') {
      return index;
    }
  }

  return -1;
};

const buildStatusMarkdownStyles = (palette: OverlayPalette) =>
  ({
    body: {
      color: palette.textPrimary,
      fontSize: 12,
      lineHeight: 17,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 6,
      color: palette.textPrimary,
    },
    strong: {
      color: palette.textPrimary,
      fontWeight: '700',
    },
    em: {
      color: palette.textPrimary,
      fontStyle: 'italic',
    },
    link: {
      color: palette.accent,
      textDecorationLine: 'underline',
    },
    bullet_list: {
      marginTop: 0,
      marginBottom: 6,
    },
    ordered_list: {
      marginTop: 0,
      marginBottom: 6,
    },
    list_item: {
      color: palette.textPrimary,
      marginVertical: 1,
    },
    code_inline: {
      backgroundColor: palette.codeBackground,
      color: palette.textPrimary,
      borderRadius: 4,
      fontFamily: 'Menlo',
      fontSize: 11,
      paddingHorizontal: 3,
    },
    fence: {
      backgroundColor: palette.codeBackground,
      color: palette.textPrimary,
      borderRadius: 6,
      fontFamily: 'Menlo',
      fontSize: 11,
      lineHeight: 15,
      marginVertical: 4,
      padding: 8,
    },
    code_block: {
      backgroundColor: palette.codeBackground,
      color: palette.textPrimary,
      borderRadius: 6,
      fontFamily: 'Menlo',
      fontSize: 11,
      lineHeight: 15,
      marginVertical: 4,
      padding: 8,
    },
    blockquote: {
      backgroundColor: palette.surfaceMuted,
      borderLeftColor: palette.accent,
      borderLeftWidth: 3,
      marginVertical: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
  }) as Record<string, object>;

const styles = StyleSheet.create({
  keyboardAvoider: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
  },
  host: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
  },
  promptWrap: {
    maxWidth: 420,
  },
  statusDialog: {
    maxHeight: 150,
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  statusDialogWorking: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusScroll: {
    maxHeight: 132,
  },
  statusWorkingText: {
    fontSize: 11,
    fontWeight: '400',
    lineHeight: 15,
  },
  grip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 8,
  },
  idleDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  recordingDots: {
    height: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 2,
  },
  loadingDots: {
    height: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  loadingDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
});
