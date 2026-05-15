import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp02Icon, Cancel01Icon, Mic01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { Orb } from '@/components/orb/orb';
import { OrbLoader } from '@/components/orb/orb-loader';
import { transliterateSpeech } from '@/lib/sarvam-speech';
import type { FilePalette } from './file-screen-styles';

const BUTTON_SIZE = 58;
const ACTIVE_BUTTON_SIZE = 118;
const MIN_TRANSCRIPT_INPUT_HEIGHT = 44;
const MAX_TRANSCRIPT_INPUT_HEIGHT = 154;
const TRANSCRIPT_INPUT_LINE_HEIGHT = 22;
const TRANSCRIPT_INPUT_VERTICAL_PADDING = 8;
const KEYBOARD_OPEN_GAP = 16;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const clampTranscriptInputHeight = (height: number): number =>
  Math.max(MIN_TRANSCRIPT_INPUT_HEIGHT, Math.min(MAX_TRANSCRIPT_INPUT_HEIGHT, Math.ceil(height)));

const estimateTranscriptInputHeight = (text: string, viewportWidth: number): number => {
  const dialogWidth = Math.min(viewportWidth * 0.92, 520);
  const inputWidth = Math.max(120, dialogWidth - 48);
  const averageCharacterWidth = 8.2;
  const charactersPerLine = Math.max(12, Math.floor(inputWidth / averageCharacterWidth));
  const lineCount = text
    .split('\n')
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);

  return clampTranscriptInputHeight(
    lineCount * TRANSCRIPT_INPUT_LINE_HEIGHT + TRANSCRIPT_INPUT_VERTICAL_PADDING,
  );
};

type FilesOrbMicButtonProps = {
  isStreaming?: boolean;
  palette: FilePalette;
  onSendTranscript?: (transcript: string) => boolean | void | Promise<boolean | void>;
};

export function FilesOrbMicButton({
  isStreaming = false,
  palette,
  onSendTranscript,
}: FilesOrbMicButtonProps) {
  const insets = useSafeAreaInsets();
  const windowDimensions = useWindowDimensions();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 50);
  const intensity = useSharedValue(0);
  const buttonProgress = useSharedValue(0);
  const isListeningRef = useRef(false);
  const [isOrbVisible, setIsOrbVisible] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSendingTranscript, setIsSendingTranscript] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState<string | null>(null);
  const [dialogInputHeight, setDialogInputHeight] = useState(MIN_TRANSCRIPT_INPUT_HEIGHT);

  const resetButton = useCallback(() => {
    isListeningRef.current = false;
    buttonProgress.value = withTiming(0, { duration: 180 });
    cancelAnimation(intensity);
    intensity.value = withTiming(0, { duration: 180 });
    setIsOrbVisible(false);
  }, [buttonProgress, intensity]);

  const closeTranscriptDialog = useCallback(() => {
    setTranscriptDraft(null);
    setDialogInputHeight(MIN_TRANSCRIPT_INPUT_HEIGHT);
  }, []);

  const updateTranscriptDraft = useCallback((text: string) => {
    setTranscriptDraft(text);
  }, []);

  const submitTranscript = useCallback(async () => {
    const cleanTranscript = transcriptDraft?.trim();

    if (!cleanTranscript || isSendingTranscript) {
      return;
    }

    setIsSendingTranscript(true);
    try {
      const didSubmit = await onSendTranscript?.(cleanTranscript);

      if (didSubmit === false) {
        return;
      }

      closeTranscriptDialog();
    } finally {
      setIsSendingTranscript(false);
    }
  }, [closeTranscriptDialog, isSendingTranscript, onSendTranscript, transcriptDraft]);

  const stopRecording = useCallback(() => {
    if (!isListeningRef.current) {
      return;
    }

    resetButton();
    setIsTranscribing(true);

    void (async () => {
      try {
        await recorder.stop();
        const recordingUri = recorder.uri ?? recorder.getStatus().url;

        if (recordingUri === null) {
          throw new Error('Recording did not produce an audio file.');
        }

        const transcript = await transliterateSpeech(recordingUri);
        setTranscriptDraft(transcript);
        setDialogInputHeight(MIN_TRANSCRIPT_INPUT_HEIGHT);
      } catch (error) {
        Alert.alert(
          'Speech-to-text',
          error instanceof Error ? error.message : 'Could not transcribe audio.',
        );
      } finally {
        setIsTranscribing(false);
      }
    })();
  }, [recorder, resetButton]);

  const startRecording = useCallback(() => {
    if (isListeningRef.current || isTranscribing || transcriptDraft !== null) {
      return;
    }

    isListeningRef.current = true;
    setIsOrbVisible(true);
    buttonProgress.value = withTiming(1, { duration: 160 });
    intensity.value = withTiming(0.22, { duration: 160 });

    void (async () => {
      try {
        const permission = await requestRecordingPermissionsAsync();

        if (!permission.granted) {
          Alert.alert('Microphone Permission', 'Microphone access is needed for voice input.');
          resetButton();
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

        if (!isListeningRef.current) {
          await recorder.stop().catch(() => undefined);
          return;
        }

        recorder.record();
      } catch (error) {
        Alert.alert(
          'Microphone',
          error instanceof Error ? error.message : 'Could not start microphone input.',
        );
        resetButton();
      }
    })();
  }, [buttonProgress, intensity, isTranscribing, recorder, resetButton, transcriptDraft]);

  const toggleRecording = useCallback(() => {
    if (isTranscribing || transcriptDraft !== null) {
      return;
    }

    if (isListeningRef.current) {
      stopRecording();
      return;
    }

    startRecording();
  }, [isTranscribing, startRecording, stopRecording, transcriptDraft]);

  useEffect(() => {
    if (transcriptDraft === null) {
      return;
    }

    setDialogInputHeight(estimateTranscriptInputHeight(transcriptDraft, windowDimensions.width));
  }, [transcriptDraft, windowDimensions.width]);

  useEffect(() => {
    if (!isOrbVisible) {
      return;
    }

    if (!recorderState.isRecording || typeof recorderState.metering !== 'number') {
      intensity.value = withTiming(0.24, { duration: 120 });
      return;
    }

    const normalized = Math.max(0, Math.min(1, (recorderState.metering + 50) / 40));
    intensity.value = withTiming(Math.max(0.18, normalized), { duration: 90 });
  }, [intensity, isOrbVisible, recorderState.isRecording, recorderState.metering]);

  useEffect(() => {
    return () => {
      isListeningRef.current = false;
      void recorder.stop().catch(() => undefined);
    };
  }, [recorder]);

  const animatedButtonStyle = useAnimatedStyle(() => {
    const size = BUTTON_SIZE + (ACTIVE_BUTTON_SIZE - BUTTON_SIZE) * buttonProgress.value;

    return {
      width: size,
      height: size,
      borderRadius: size / 2,
      transform: [{ scale: 1 + buttonProgress.value * 0.02 }],
    };
  });

  const animatedIconStyle = useAnimatedStyle(() => ({
    opacity: 1 - buttonProgress.value,
    transform: [{ scale: 1 - buttonProgress.value * 0.2 }],
  }));

  if (transcriptDraft !== null) {
    return (
      <FloatingHost bottom={insets.bottom + 20}>
        <View
          style={[
            styles.dialog,
            {
              backgroundColor: palette.navBackground,
              borderColor: palette.navOutline,
              shadowColor: palette.navShadow,
            },
          ]}>
          <TextInput
            multiline
            onChangeText={updateTranscriptDraft}
            onContentSizeChange={(event) => {
              setDialogInputHeight(clampTranscriptInputHeight(event.nativeEvent.contentSize.height));
            }}
            placeholder="Transcript"
            placeholderTextColor={palette.emptyInlineText}
            scrollEnabled={dialogInputHeight >= MAX_TRANSCRIPT_INPUT_HEIGHT}
            style={[
              styles.dialogInput,
              {
                color: palette.directoryText,
                height: dialogInputHeight,
              },
            ]}
            textAlignVertical="top"
            value={transcriptDraft}
          />
          <View style={styles.dialogActions}>
            <Pressable
              accessibilityLabel="Cancel transcript"
              accessibilityRole="button"
              hitSlop={8}
              onPress={closeTranscriptDialog}
              style={({ pressed }) => [
                styles.dialogIconButton,
                { backgroundColor: palette.navBackground, borderColor: palette.navOutline },
                pressed && styles.pressed,
              ]}>
              <HugeiconsIcon icon={Cancel01Icon} size={19} color={palette.navIcon} strokeWidth={2.4} />
            </Pressable>
            <Pressable
              accessibilityLabel="Send transcript"
              accessibilityRole="button"
              disabled={isSendingTranscript || transcriptDraft.trim().length === 0}
              hitSlop={8}
              onPress={() => {
                void submitTranscript();
              }}
              style={({ pressed }) => [
                styles.dialogIconButton,
                { backgroundColor: transcriptDraft.trim().length > 0 ? '#0a84ff' : '#1A2B4A' },
                (isSendingTranscript || transcriptDraft.trim().length === 0) && styles.disabled,
                pressed && !isSendingTranscript && transcriptDraft.trim().length > 0 && styles.pressed,
              ]}>
              {isSendingTranscript ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <HugeiconsIcon
                  icon={ArrowUp02Icon}
                  size={18}
                  color={transcriptDraft.trim().length > 0 ? '#ffffff' : palette.emptyInlineText}
                  strokeWidth={2.4}
                />
              )}
            </Pressable>
          </View>
        </View>
      </FloatingHost>
    );
  }

  return (
    <FloatingHost bottom={insets.bottom + 20}>
      <AnimatedPressable
        accessibilityHint={
          isTranscribing
            ? 'Audio is being transcribed'
            : isOrbVisible
              ? 'Tap to stop voice input'
              : isStreaming
                ? 'Agent is responding; tap to start voice input'
                : 'Tap to start voice input'
        }
        accessibilityLabel={
          isTranscribing
            ? 'Transcribing voice input'
            : isOrbVisible
              ? 'Stop voice input'
              : isStreaming
                ? 'Agent response in progress'
                : 'Start voice input'
        }
        accessibilityRole="button"
        disabled={isTranscribing}
        onPress={toggleRecording}
        style={[
          styles.button,
          {
            backgroundColor: palette.navBackground,
            borderColor: palette.navOutline,
            shadowColor: palette.navShadow,
          },
          animatedButtonStyle,
        ]}>
        {isOrbVisible ? (
          <View pointerEvents="none" style={styles.orbClip}>
            <Orb hue={200} intensity={intensity} width={ACTIVE_BUTTON_SIZE} height={ACTIVE_BUTTON_SIZE} />
          </View>
        ) : null}
        {isTranscribing ? (
          <ActivityIndicator color={palette.navIcon} size="small" />
        ) : isStreaming && !isOrbVisible ? (
          <View pointerEvents="none" style={styles.loaderLayer}>
            <OrbLoader size={44} />
          </View>
        ) : (
          <Animated.View pointerEvents="none" style={[styles.iconLayer, animatedIconStyle]}>
            <HugeiconsIcon icon={Mic01Icon} size={25} color={palette.navIcon} strokeWidth={2.2} />
          </Animated.View>
        )}
      </AnimatedPressable>
    </FloatingHost>
  );
}

function FloatingHost({
  bottom,
  children,
}: {
  bottom: number;
  children: React.ReactNode;
}) {
  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={KEYBOARD_OPEN_GAP - bottom}
      pointerEvents="box-none"
      style={styles.keyboardAvoider}>
      <View pointerEvents="box-none" style={[styles.host, { paddingBottom: bottom }]}>
        {children}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  host: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 8,
  },
  iconLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderLayer: {
    position: 'absolute',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbClip: {
    width: ACTIVE_BUTTON_SIZE,
    height: ACTIVE_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialog: {
    width: '92%',
    maxWidth: 520,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  dialogInput: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 4,
    fontSize: 16,
    lineHeight: TRANSCRIPT_INPUT_LINE_HEIGHT,
    fontWeight: '500',
    letterSpacing: 0,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  dialogIconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  disabled: {
    opacity: 0.42,
  },
  pressed: {
    opacity: 0.74,
  },
});
