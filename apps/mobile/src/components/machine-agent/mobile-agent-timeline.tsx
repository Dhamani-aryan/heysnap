import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import * as Clipboard from 'expo-clipboard';
import { ArrowUp02Icon, Cancel01Icon, CopyIcon, Edit03Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native';

import { ThemedText } from '@/components/themed-text';
import {
  getAssistantMarkdown,
  getTextContent,
  type AgentTimelineRow,
} from '@/lib/agent/agent-events';
import { resolveMarkdownFileLinkMeta } from '@/lib/agent/markdown-links';
import type { AgentContent, FileContent, ImageContent } from '@/lib/agent/types';
import { useAgentChatStore } from '@/stores/agent/agent-chat-store';

type Palette = {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  codeBackground: string;
};

type MobileAgentTimelineProps = {
  currentPath: string;
  onSubmitUserMessageEdit?: (input: {
    messageId: string;
    content: AgentContent;
  }) => boolean | void;
  onOpenFilePath?: (path: string) => void;
  palette: Palette;
};

export function MobileAgentTimeline({
  currentPath,
  onSubmitUserMessageEdit,
  onOpenFilePath,
  palette,
}: MobileAgentTimelineProps) {
  const rows = useAgentChatStore((state) => state.timelineRows);
  const listRef = useRef<FlatList<AgentTimelineRow>>(null);
  const hasInitialScrollRef = useRef(false);
  const prevRowCountRef = useRef(0);

  const handleContentSizeChange = useCallback(() => {
    const list = listRef.current;
    if (list === null) {
      return;
    }
    // First batch of rows after mount (or after a thread switch) → snap.
    // Subsequent growth (streaming deltas, new messages) → animate.
    if (!hasInitialScrollRef.current) {
      hasInitialScrollRef.current = true;
      list.scrollToEnd({ animated: false });
      return;
    }
    list.scrollToEnd({ animated: true });
  }, []);

  // Reset the "first scroll" flag when the timeline empties (new chat or
  // thread switch); the next content-size event will snap to bottom again.
  useEffect(() => {
    if (rows.length === 0) {
      hasInitialScrollRef.current = false;
    } else if (prevRowCountRef.current === 0 && rows.length > 0) {
      hasInitialScrollRef.current = false;
    }
    prevRowCountRef.current = rows.length;
  }, [rows.length]);

  // When the keyboard opens, scroll the timeline so the last message sits
  // just above the keyboard instead of being hidden by it.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      listRef.current?.scrollToEnd({ animated: true });
    });
    return () => {
      sub.remove();
    };
  }, []);

  const renderItem = (info: ListRenderItemInfo<AgentTimelineRow>) => (
    <TimelineRow
      currentPath={currentPath}
      row={info.item}
      palette={palette}
      onOpenFilePath={onOpenFilePath}
      onSubmitUserMessageEdit={onSubmitUserMessageEdit}
    />
  );

  return (
    <FlatList
      ref={listRef}
      data={rows as AgentTimelineRow[]}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={styles.listContent}
      ListFooterComponent={<View style={styles.footerSpacer} />}
      onContentSizeChange={handleContentSizeChange}
      keyboardShouldPersistTaps="handled"
      removeClippedSubviews={false}
    />
  );
}

const keyExtractor = (row: AgentTimelineRow): string => row.id;

const TimelineRow = memo(function TimelineRow({
  currentPath,
  onOpenFilePath,
  onSubmitUserMessageEdit,
  row,
  palette,
}: {
  currentPath: string;
  onOpenFilePath?: (path: string) => void;
  onSubmitUserMessageEdit?: (input: {
    messageId: string;
    content: AgentContent;
  }) => boolean | void;
  row: AgentTimelineRow;
  palette: Palette;
}) {
  if (row.kind === 'status') {
    return <StatusRow messageId={row.messageId} palette={palette} />;
  }

  if (row.role === 'user') {
    return (
      <UserBubble
        messageId={row.messageId}
        palette={palette}
        onSubmitUserMessageEdit={onSubmitUserMessageEdit}
      />
    );
  }

  return (
    <AssistantBlock
      currentPath={currentPath}
      messageId={row.messageId}
      palette={palette}
      onOpenFilePath={onOpenFilePath}
    />
  );
});

const StatusRow = memo(function StatusRow({
  messageId,
  palette,
}: {
  messageId: string;
  palette: Palette;
}) {
  const statusLabel = useAgentChatStore((state) => {
    if (state.activeRun === null) {
      return 'Worked';
    }
    const lastUserId = findLastUserMessageKey(state.messageOrder, state.messagesById);
    if (lastUserId !== messageId) {
      return 'Worked';
    }
    return state.activeTurn?.status === 'reconnecting' ? 'Reconnecting…' : 'Working…';
  });

  return (
    <View style={styles.statusRow}>
      <ThemedText style={[styles.statusText, { color: palette.textSecondary }]}>
        {statusLabel}
      </ThemedText>
    </View>
  );
});

const UserBubble = memo(function UserBubble({
  messageId,
  onSubmitUserMessageEdit,
  palette,
}: {
  messageId: string;
  onSubmitUserMessageEdit?: (input: {
    messageId: string;
    content: AgentContent;
  }) => boolean | void;
  palette: Palette;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const message = useAgentChatStore((state) => {
    const current = state.messagesById[messageId];
    return current?.role === 'user' ? current : null;
  });
  const isLatestUserMessage = useAgentChatStore(
    (state) => findLastUserMessageKey(state.messageOrder, state.messagesById) === messageId,
  );
  const isStreaming = useAgentChatStore((state) => state.activeRun !== null);
  const isTurnCompleted = useAgentChatStore((state) => {
    if (state.activeRun === null) {
      return true;
    }
    const lastUserId = findLastUserMessageKey(state.messageOrder, state.messagesById);
    return lastUserId !== messageId;
  });

  if (message === null) {
    return null;
  }

  const text = getTextContent(message.content);
  const attachments = message.content.filter(
    (block): block is ImageContent | FileContent => block.type === 'image' || block.type === 'file',
  );
  const canEdit =
    isLatestUserMessage &&
    !isStreaming &&
    onSubmitUserMessageEdit !== undefined &&
    text.trim().length > 0;

  const handleSubmitEdit = (nextText: string): boolean => {
    const didSubmit = onSubmitUserMessageEdit?.({
      messageId,
      content: [{ type: 'text', content: nextText }],
    });

    if (didSubmit === false) {
      return false;
    }

    setIsEditing(false);
    return true;
  };

  return (
    <View style={styles.userRow}>
      {isEditing ? (
        <UserMessageEditBox
          initialText={text}
          palette={palette}
          onCancel={() => setIsEditing(false)}
          onSubmit={handleSubmitEdit}
        />
      ) : (
        <>
          {attachments.length > 0 ? (
            <View style={styles.userAttachments}>
              {attachments.map((attachment, index) => (
                <UserAttachmentChip key={`${messageId}-${index.toString()}`} attachment={attachment} palette={palette} />
              ))}
            </View>
          ) : null}
          {text.length > 0 ? (
            <View style={[styles.userBubble, { backgroundColor: '#19191B' }]}>
              <ThemedText style={[styles.userBubbleText, { color: palette.textPrimary }]}>{text}</ThemedText>
            </View>
          ) : null}
        </>
      )}
      {!isEditing && (isTurnCompleted || isLatestUserMessage) && text.length > 0 ? (
        <UserMessageActions
          canEdit={canEdit}
          palette={palette}
          text={text}
          onEdit={() => setIsEditing(true)}
        />
      ) : null}
    </View>
  );
});

function UserMessageEditBox({
  initialText,
  onCancel,
  onSubmit,
  palette,
}: {
  initialText: string;
  onCancel: () => void;
  onSubmit: (text: string) => boolean;
  palette: Palette;
}) {
  const [draft, setDraft] = useState(initialText);
  const inputRef = useRef<TextInput>(null);
  const canSubmit = draft.trim().length > 0 && draft.trim() !== initialText.trim();

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  const submit = useCallback(() => {
    if (!canSubmit) {
      return;
    }
    onSubmit(draft.trim());
  }, [canSubmit, draft, onSubmit]);

  return (
    <View
      style={[
        styles.editBox,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}>
      <TextInput
        ref={inputRef}
        multiline
        onChangeText={setDraft}
        onSubmitEditing={submit}
        style={[styles.editInput, { color: palette.textPrimary }]}
        textAlignVertical="top"
        value={draft}
      />
      <View style={styles.editActions}>
        <Pressable
          accessibilityLabel="Cancel edit"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onCancel}
          style={({ pressed }) => [
            styles.editIconButton,
            { backgroundColor: palette.surfaceMuted },
            pressed && { opacity: 0.7 },
          ]}>
          <HugeiconsIcon icon={Cancel01Icon} size={16} color={palette.textSecondary} strokeWidth={2.2} />
        </Pressable>
        <Pressable
          accessibilityLabel="Send edit"
          accessibilityRole="button"
          disabled={!canSubmit}
          hitSlop={8}
          onPress={submit}
          style={({ pressed }) => [
            styles.editIconButton,
            { backgroundColor: canSubmit ? palette.accent : palette.surfaceMuted },
            !canSubmit && { opacity: 0.5 },
            pressed && canSubmit && { opacity: 0.8 },
          ]}>
          <HugeiconsIcon
            icon={ArrowUp02Icon}
            size={16}
            color={canSubmit ? '#ffffff' : palette.textMuted}
            strokeWidth={2.3}
          />
        </Pressable>
      </View>
    </View>
  );
}

function UserMessageActions({
  canEdit,
  onEdit,
  palette,
  text,
}: {
  canEdit: boolean;
  onEdit: () => void;
  palette: Palette;
  text: string;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(() => {
    void Clipboard.setStringAsync(text);
    setCopied(true);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [text]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  return (
    <View style={styles.userActions}>
      <Pressable
        accessibilityLabel={copied ? 'Copied' : 'Copy message'}
        accessibilityRole="button"
        hitSlop={8}
        onPress={copy}
        style={({ pressed }) => [styles.userActionButton, pressed && { opacity: 0.55 }]}>
        <HugeiconsIcon
          icon={copied ? Tick02Icon : CopyIcon}
          size={15}
          color={palette.textMuted}
          strokeWidth={2}
        />
      </Pressable>
      <Pressable
        accessibilityLabel="Edit message"
        accessibilityRole="button"
        disabled={!canEdit}
        hitSlop={8}
        onPress={onEdit}
        style={({ pressed }) => [
          styles.userActionButton,
          !canEdit && { opacity: 0.35 },
          pressed && canEdit && { opacity: 0.55 },
        ]}>
        <HugeiconsIcon icon={Edit03Icon} size={15} color={palette.textMuted} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

function UserAttachmentChip({
  attachment,
  palette,
}: {
  attachment: ImageContent | FileContent;
  palette: Palette;
}) {
  if (attachment.type === 'image' && typeof attachment.data === 'string' && attachment.data.length > 0) {
    return (
      <Image
        source={{ uri: `data:${attachment.mimeType};base64,${attachment.data}` }}
        style={[styles.userImage, { borderColor: palette.border }]}
      />
    );
  }

  const filename =
    attachment.type === 'file'
      ? attachment.filename
      : typeof attachment.metadata?.['filename'] === 'string'
        ? (attachment.metadata['filename'] as string)
        : 'attachment';

  return (
    <View
      style={[
        styles.userFileChip,
        { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
      ]}>
      <ThemedText numberOfLines={1} style={[styles.userFileText, { color: palette.textPrimary }]}>
        {filename}
      </ThemedText>
    </View>
  );
}

const AssistantBlock = memo(function AssistantBlock({
  currentPath,
  messageId,
  onOpenFilePath,
  palette,
}: {
  currentPath: string;
  messageId: string;
  onOpenFilePath?: (path: string) => void;
  palette: Palette;
}) {
  const markdown = useAgentChatStore((state) => {
    const message = state.messagesById[messageId];
    return message?.role === 'assistant' ? getAssistantMarkdown(message) : '';
  });
  const isStreaming = useAgentChatStore((state) =>
    state.streamingMessageIds.includes(messageId),
  );
  const showCompactionStatus = useAgentChatStore((state) =>
    state.activeCompactionItemIds.length > 0 &&
    findLastAssistantMessageKey(state.messageOrder, state.messagesById) === messageId
  );

  const markdownStyles = useMemo(() => buildMarkdownStyles(palette), [palette]);
  const handleLinkPress = useCallback((href: string): boolean => {
    const meta = resolveMarkdownFileLinkMeta(href, currentPath, undefined);

    if (meta === null) {
      return true;
    }

    onOpenFilePath?.(meta.targetPath);
    return false;
  }, [currentPath, onOpenFilePath]);

  if (markdown.length === 0) {
    return null;
  }

  return (
    <View style={styles.assistantRow}>
      <Markdown onLinkPress={handleLinkPress} style={markdownStyles}>{markdown}</Markdown>
      {showCompactionStatus ? (
        <ThemedText style={[styles.compactionStatus, { color: palette.textMuted }]}>
          Compacting conversation and continuing
        </ThemedText>
      ) : null}
      {!isStreaming ? <CopyMessageButton text={markdown} palette={palette} /> : null}
    </View>
  );
});

function CopyMessageButton({ text, palette }: { text: string; palette: Palette }) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    void Clipboard.setStringAsync(text);
    setCopied(true);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <Pressable
      accessibilityLabel={copied ? 'Copied' : 'Copy message'}
      accessibilityRole="button"
      hitSlop={8}
      onPress={handleCopy}
      style={({ pressed }) => [styles.copyButton, pressed && { opacity: 0.5 }]}>
      <HugeiconsIcon
        icon={copied ? Tick02Icon : CopyIcon}
        size={16}
        color={palette.textMuted}
        strokeWidth={2}
      />
    </Pressable>
  );
}

const findLastUserMessageKey = (
  messageOrder: readonly string[],
  messagesById: Readonly<Record<string, { role?: string } | undefined>>,
): string | null => {
  for (let index = messageOrder.length - 1; index >= 0; index -= 1) {
    const id = messageOrder[index];
    if (messagesById[id]?.role === 'user') {
      return id;
    }
  }
  return null;
};

const findLastAssistantMessageKey = (
  messageOrder: readonly string[],
  messagesById: Readonly<Record<string, { role?: string } | undefined>>,
): string | null => {
  for (let index = messageOrder.length - 1; index >= 0; index -= 1) {
    const id = messageOrder[index];
    if (messagesById[id]?.role === 'assistant') {
      return id;
    }
  }
  return null;
};

const buildMarkdownStyles = (palette: Palette) =>
  ({
    body: {
      color: palette.textPrimary,
      fontSize: 15,
      lineHeight: 22,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 8,
      color: palette.textPrimary,
    },
    heading1: { color: palette.textPrimary, fontSize: 22, fontWeight: '700', marginTop: 8, marginBottom: 6 },
    heading2: { color: palette.textPrimary, fontSize: 19, fontWeight: '700', marginTop: 8, marginBottom: 6 },
    heading3: { color: palette.textPrimary, fontSize: 17, fontWeight: '700', marginTop: 6, marginBottom: 4 },
    heading4: { color: palette.textPrimary, fontSize: 16, fontWeight: '600' },
    strong: { color: palette.textPrimary, fontWeight: '700' },
    em: { color: palette.textPrimary, fontStyle: 'italic' },
    link: { color: palette.accent, textDecorationLine: 'underline' },
    bullet_list: { color: palette.textPrimary, marginTop: 0, marginBottom: 8 },
    ordered_list: { color: palette.textPrimary, marginTop: 0, marginBottom: 8 },
    list_item: { color: palette.textPrimary, marginVertical: 2 },
    code_inline: {
      backgroundColor: palette.codeBackground,
      color: palette.textPrimary,
      paddingHorizontal: 4,
      borderRadius: 4,
      fontFamily: 'Menlo',
      fontSize: 13,
    },
    fence: {
      backgroundColor: palette.codeBackground,
      color: palette.textPrimary,
      padding: 12,
      borderRadius: 8,
      fontFamily: 'Menlo',
      fontSize: 13,
      lineHeight: 18,
      marginVertical: 6,
    },
    code_block: {
      backgroundColor: palette.codeBackground,
      color: palette.textPrimary,
      padding: 12,
      borderRadius: 8,
      fontFamily: 'Menlo',
      fontSize: 13,
      lineHeight: 18,
      marginVertical: 6,
    },
    blockquote: {
      backgroundColor: palette.surfaceMuted,
      borderLeftColor: palette.accent,
      borderLeftWidth: 3,
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginVertical: 6,
    },
    hr: {
      backgroundColor: palette.border,
      height: StyleSheet.hairlineWidth,
      marginVertical: 8,
    },
    table: { borderColor: palette.border, borderWidth: StyleSheet.hairlineWidth },
    th: { color: palette.textPrimary, padding: 6, fontWeight: '600' },
    td: { color: palette.textPrimary, padding: 6 },
  }) as Record<string, object>;

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 12,
  },
  footerSpacer: {
    height: 8,
  },
  userRow: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    gap: 6,
  },
  userBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  userBubbleText: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 21,
  },
  userActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    paddingRight: 6,
  },
  userActionButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  editBox: {
    width: '100%',
    minWidth: 260,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },
  editInput: {
    minHeight: 62,
    maxHeight: 180,
    paddingHorizontal: 0,
    paddingVertical: 0,
    fontSize: 15,
    lineHeight: 21,
  },
  editActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editIconButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
  },
  userAttachments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
  },
  userImage: {
    width: 120,
    height: 120,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  userFileChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 240,
  },
  userFileText: {
    fontSize: 12,
    fontWeight: '600',
  },
  assistantRow: {
    alignSelf: 'stretch',
    gap: 6,
  },
  compactionStatus: {
    fontSize: 12,
    lineHeight: 18,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  copyButtonText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
});

export type { Palette as TimelinePalette };
