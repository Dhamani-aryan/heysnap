import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {
  ArrowUp02Icon,
  AttachmentIcon,
  Cancel01Icon,
  Folder01Icon,
  ImageAdd02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import type { AgentContent } from '@ank1015-app/ui/agent-hooks';

import { ThemedText } from '@/components/themed-text';

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
};

type ComposerAttachment = {
  id: string;
  kind: 'image' | 'file';
  fileName: string;
  mimeType: string;
  size: number;
  base64: string;
};

type MobileAgentComposerProps = {
  palette: Palette;
  activeFolderName?: string;
  isRunning: boolean;
  onSubmit: (input: { content: AgentContent }) => boolean | void | Promise<boolean | void>;
  onCancel: () => void;
};

const guessMime = (uri: string, fallback: string): string => {
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    pdf: 'application/pdf',
  };
  return map[ext] ?? fallback;
};

const newAttachmentId = (): string =>
  `${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}`;

const buildAgentContent = (
  text: string,
  attachments: readonly ComposerAttachment[],
): AgentContent => {
  const trimmed = text.trim();
  const content: AgentContent = [
    ...(trimmed.length > 0 ? [{ type: 'text' as const, content: trimmed }] : []),
    ...attachments.map((attachment) =>
      attachment.kind === 'image'
        ? {
            type: 'image' as const,
            data: attachment.base64,
            mimeType: attachment.mimeType,
            metadata: { filename: attachment.fileName, size: attachment.size },
          }
        : {
            type: 'file' as const,
            data: attachment.base64,
            mimeType: attachment.mimeType,
            filename: attachment.fileName,
            metadata: { size: attachment.size },
          },
    ),
  ];
  return content;
};

export function MobileAgentComposer({
  palette,
  activeFolderName,
  isRunning,
  onSubmit,
  onCancel,
}: MobileAgentComposerProps) {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const inputRef = useRef<TextInput>(null);

  const canSubmit = draft.trim().length > 0 || attachments.length > 0;

  const handleAddImage = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow photo library access to attach images.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 0.85,
        allowsMultipleSelection: true,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const nextAttachments: ComposerAttachment[] = [];
      for (const asset of result.assets) {
        if (asset.base64 === null || asset.base64 === undefined) {
          continue;
        }
        nextAttachments.push({
          id: newAttachmentId(),
          kind: 'image',
          fileName: asset.fileName ?? 'image',
          mimeType: asset.mimeType ?? guessMime(asset.uri, 'image/jpeg'),
          size: asset.fileSize ?? 0,
          base64: asset.base64,
        });
      }
      setAttachments((current) => [...current, ...nextAttachments]);
    } catch (error) {
      Alert.alert('Attach image', error instanceof Error ? error.message : 'Failed to attach.');
    }
  }, []);

  const handleAddFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const nextAttachments: ComposerAttachment[] = [];
      for (const asset of result.assets) {
        const base64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        nextAttachments.push({
          id: newAttachmentId(),
          kind: 'file',
          fileName: asset.name,
          mimeType: asset.mimeType ?? guessMime(asset.uri, 'application/octet-stream'),
          size: asset.size ?? 0,
          base64,
        });
      }
      setAttachments((current) => [...current, ...nextAttachments]);
    } catch (error) {
      Alert.alert('Attach file', error instanceof Error ? error.message : 'Failed to attach.');
    }
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }, []);

  const handleSend = useCallback(async () => {
    if (!canSubmit || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const didSubmit = await onSubmit({ content: buildAgentContent(draft, attachments) });

      if (didSubmit === false) {
        return;
      }

      setDraft('');
      setAttachments([]);
      setResetKey((current) => current + 1);
    } finally {
      setIsSubmitting(false);
    }
  }, [attachments, canSubmit, draft, isSubmitting, onSubmit]);

  const isStopAction = isRunning && !canSubmit;

  const handlePrimaryAction = useCallback(() => {
    if (isStopAction) {
      onCancel();
      return;
    }
    void handleSend();
  }, [handleSend, isStopAction, onCancel]);

  return (
    <View
      style={[
        styles.shell,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}>
      {attachments.length > 0 ? (
        <View style={styles.attachmentsRow}>
          {attachments.map((attachment) => (
            <AttachmentChip
              key={attachment.id}
              attachment={attachment}
              palette={palette}
              onRemove={() => handleRemoveAttachment(attachment.id)}
            />
          ))}
        </View>
      ) : null}

      <Pressable onPress={() => inputRef.current?.focus()} style={styles.inputArea}>
        <TextInput
          key={resetKey}
          ref={inputRef}
          editable={!isSubmitting}
          multiline
          onChangeText={setDraft}
          placeholder="What's next…"
          placeholderTextColor={palette.textMuted}
          style={[styles.input, { color: palette.textPrimary }]}
          value={draft}
        />
      </Pressable>

      <View style={styles.actionsRow}>
        <View style={styles.leftActions}>
          <ComposerIconButton
            accessibilityLabel="Add photo"
            disabled={isSubmitting}
            icon={ImageAdd02Icon}
            onPress={handleAddImage}
            palette={palette}
          />
          <ComposerIconButton
            accessibilityLabel="Add file"
            disabled={isSubmitting}
            icon={AttachmentIcon}
            onPress={handleAddFile}
            palette={palette}
          />
          {activeFolderName === undefined ? null : (
            <View style={styles.folderChip}>
              <HugeiconsIcon icon={Folder01Icon} size={16} color="#8AA7D6" strokeWidth={2.1} />
              <ThemedText numberOfLines={1} style={styles.folderText}>
                {activeFolderName}
              </ThemedText>
            </View>
          )}
        </View>

        <Pressable
          accessibilityLabel={isStopAction ? 'Stop response' : 'Send'}
          accessibilityRole="button"
          disabled={isSubmitting || (!isStopAction && !canSubmit)}
          onPress={handlePrimaryAction}
          style={({ pressed }) => [
            styles.sendButton,
            {
              backgroundColor: isStopAction
                ? palette.errorText
                : canSubmit
                  ? palette.accent
                  : '#1A2B4A',
            },
            pressed && { opacity: 0.8 },
          ]}>
          {isSubmitting ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : isStopAction ? (
            <View style={styles.stopSquare} />
          ) : (
            <HugeiconsIcon
              icon={ArrowUp02Icon}
              size={18}
              color={canSubmit ? '#ffffff' : palette.textMuted}
              strokeWidth={2.4}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}

function ComposerIconButton({
  accessibilityLabel,
  disabled,
  icon,
  onPress,
  palette,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  icon: typeof ArrowUp02Icon;
  onPress: () => void;
  palette: Palette;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && !disabled && { opacity: 0.6 },
        disabled && { opacity: 0.35 },
      ]}>
      <HugeiconsIcon icon={icon} size={20} color={palette.textSecondary} strokeWidth={2} />
    </Pressable>
  );
}

function AttachmentChip({
  attachment,
  palette,
  onRemove,
}: {
  attachment: ComposerAttachment;
  palette: Palette;
  onRemove: () => void;
}) {
  if (attachment.kind === 'image') {
    return (
      <View style={[styles.imageChip, { borderColor: palette.border }]}>
        <Image
          source={{ uri: `data:${attachment.mimeType};base64,${attachment.base64}` }}
          style={styles.imageChipImage}
        />
        <Pressable
          accessibilityLabel={`Remove ${attachment.fileName}`}
          accessibilityRole="button"
          hitSlop={6}
          onPress={onRemove}
          style={[styles.removeButton, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
          <HugeiconsIcon icon={Cancel01Icon} size={12} color="#ffffff" strokeWidth={2.4} />
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.fileChip,
        { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
      ]}>
      <View style={styles.fileChipText}>
        <ThemedText numberOfLines={1} style={[styles.fileChipName, { color: palette.textPrimary }]}>
          {attachment.fileName}
        </ThemedText>
        <ThemedText style={[styles.fileChipMeta, { color: palette.textMuted }]}>
          {formatBytes(attachment.size)}
        </ThemedText>
      </View>
      <Pressable
        accessibilityLabel={`Remove ${attachment.fileName}`}
        accessibilityRole="button"
        hitSlop={6}
        onPress={onRemove}
        style={[styles.removeButton, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
        <HugeiconsIcon icon={Cancel01Icon} size={12} color="#ffffff" strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

const INPUT_MIN_HEIGHT = 32;
const INPUT_MAX_HEIGHT = 122;

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) {
    return 'File';
  }
  if (bytes < 1024) {
    return `${bytes.toString()} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const styles = StyleSheet.create({
  shell: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },
  inputArea: {
    width: '100%',
    paddingBottom: 6,
  },
  input: {
    fontSize: 16,
    lineHeight: 22,
    paddingVertical: 4,
    paddingHorizontal: 0,
    minHeight: INPUT_MIN_HEIGHT,
    maxHeight: INPUT_MAX_HEIGHT,
    textAlignVertical: 'top',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  folderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 5,
    maxWidth: 196,
  },
  folderText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
    color: '#8AA7D6',
  },
  sendButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  stopSquare: {
    width: 12,
    height: 12,
    backgroundColor: '#ffffff',
    borderRadius: 2,
  },
  attachmentsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  imageChip: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    position: 'relative',
  },
  imageChipImage: {
    width: '100%',
    height: '100%',
  },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 220,
  },
  fileChipText: {
    flex: 1,
    minWidth: 0,
  },
  fileChipName: {
    fontSize: 12,
    fontWeight: '600',
  },
  fileChipMeta: {
    fontSize: 10,
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export type { Palette as ComposerPalette };
