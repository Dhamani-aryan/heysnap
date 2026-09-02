import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { KeyboardProvider, KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import type { FilesystemEntry } from '@/lib/filesystem/types';
import type { FilePalette, FileStyles } from './file-screen-styles';
import { validateFilesystemName } from './file-utils';

export type NameDialogState =
  | {
      mode: 'create-folder';
      initialName: string;
    }
  | {
      mode: 'rename';
      entry: FilesystemEntry;
      initialName: string;
    };

type NameSheetProps = {
  dialog: NameDialogState | null;
  isSubmitting: boolean;
  palette: FilePalette;
  styles: FileStyles;
  onCancel: () => void;
  onDismiss: () => void;
  onSubmit: (name: string) => void;
};

export function NameSheet({
  dialog,
  isSubmitting,
  palette,
  styles,
  onCancel,
  onDismiss,
  onSubmit,
}: NameSheetProps) {
  const inputRef = useRef<TextInput>(null);
  const latestNameRef = useRef(dialog?.initialName ?? '');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const isVisible = dialog !== null;

  const title = dialog?.mode === 'rename' ? 'Rename' : 'New Folder';
  const submitLabel = dialog?.mode === 'rename' ? 'Rename' : 'Create';

  useEffect(() => {
    if (dialog === null) {
      return;
    }

    latestNameRef.current = dialog.initialName;
    setValidationMessage(null);
    inputRef.current?.setNativeProps({ text: dialog.initialName });

    const focusTimer = setTimeout(() => {
      inputRef.current?.focus();
    }, 80);

    return () => {
      clearTimeout(focusTimer);
    };
  }, [dialog]);

  const submitCurrentName = useCallback(() => {
    const cleanName = latestNameRef.current.trim();
    const nextValidationMessage = validateFilesystemName(cleanName);

    if (nextValidationMessage !== null) {
      setValidationMessage(nextValidationMessage);
      return;
    }

    onSubmit(cleanName);
  }, [onSubmit]);

  const handleChangeText = useCallback((nextName: string) => {
    latestNameRef.current = nextName;
    setValidationMessage((current) => (current === null ? current : null));
  }, []);

  const handleBackdropPress = useCallback(() => {
    if (!isSubmitting) {
      onCancel();
    }
  }, [isSubmitting, onCancel]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={isSubmitting ? undefined : onCancel}
      statusBarTranslucent
      transparent
      visible={isVisible}
      onDismiss={onDismiss}>
      <KeyboardProvider>
        <Pressable
          accessibilityLabel="Dismiss"
          onPress={handleBackdropPress}
          style={[styles.nameSheetBackdrop, { backgroundColor: 'rgba(0, 0, 0, 0.36)' }]}>
          <KeyboardStickyView
          collapsable={false}
          offset={{ closed: -Math.max(insets.bottom, 16) - 12, opened: -12 }}
          style={styles.nameSheetStickyContainer}>
          <Pressable
            onPress={() => {}}
            style={[
              styles.nameSheetPanel,
              styles.nameSheetCard,
              { backgroundColor: palette.background },
            ]}>
            <View style={styles.nameSheetHandle}>
              <View style={[styles.nameSheetHandleBar, { backgroundColor: palette.inputPlaceholder }]} />
            </View>
            <ThemedText style={[styles.nameSheetTitle, { color: palette.itemLabelText }]}>
              {title}
            </ThemedText>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              defaultValue={dialog?.initialName ?? ''}
              editable={!isSubmitting}
              onChangeText={handleChangeText}
              onSubmitEditing={submitCurrentName}
              placeholder="Name"
              placeholderTextColor={palette.inputPlaceholder}
              ref={inputRef}
              returnKeyType="done"
              selectTextOnFocus
              style={[
                styles.nameSheetInput,
                {
                  backgroundColor: palette.inputBackground,
                  borderColor:
                    validationMessage === null ? palette.inputBorder : palette.errorText,
                  color: palette.itemLabelText,
                },
              ]}
            />
            <View style={styles.nameSheetHintRow}>
              {validationMessage === null ? null : (
                <ThemedText style={[styles.nameSheetHintText, { color: palette.errorText }]}>
                  {validationMessage}
                </ThemedText>
              )}
            </View>
            <View style={styles.nameSheetActions}>
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={onCancel}
                style={({ pressed }) => [
                  styles.nameSheetButton,
                  styles.nameSheetSecondaryButton,
                  pressed && !isSubmitting ? styles.nameSheetButtonPressed : null,
                  isSubmitting ? styles.nameSheetButtonDisabled : null,
                ]}>
                <ThemedText style={[styles.nameSheetButtonText, { color: palette.itemLabelText }]}>
                  Cancel
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={submitCurrentName}
                style={({ pressed }) => [
                  styles.nameSheetButton,
                  styles.nameSheetPrimaryButton,
                  pressed && !isSubmitting ? styles.nameSheetButtonPressed : null,
                  isSubmitting ? styles.nameSheetButtonDisabled : null,
                ]}>
                {isSubmitting ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <ThemedText style={styles.nameSheetPrimaryButtonText}>
                    {submitLabel}
                  </ThemedText>
                )}
              </Pressable>
            </View>
            </Pressable>
          </KeyboardStickyView>
        </Pressable>
      </KeyboardProvider>
    </Modal>
  );
}
