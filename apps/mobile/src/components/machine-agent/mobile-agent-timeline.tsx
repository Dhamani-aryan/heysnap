import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import * as Clipboard from 'expo-clipboard';
import { CopyIcon, Tick02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { useStore } from 'zustand';
import {
  getAssistantMarkdown,
  getTextContent,
  resolveMarkdownFileLinkMeta,
  useAgentRuntime,
  type AgentTimelineRow,
  type FileContent,
  type ImageContent,
} from '@ank1015-app/ui/agent-hooks';

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
  codeBackground: string;
};

type MobileAgentTimelineProps = {
  currentPath: string;
  onOpenFilePath?: (path: string) => void;
  palette: Palette;
};

export function MobileAgentTimeline({
  currentPath,
  onOpenFilePath,
  palette,
}: MobileAgentTimelineProps) {
  const runtime = useAgentRuntime();
  const rows = useStore(runtime.chatStore, (state) => state.timelineRows);
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
  row,
  palette,
}: {
  currentPath: string;
  onOpenFilePath?: (path: string) => void;
  row: AgentTimelineRow;
  palette: Palette;
}) {
  if (row.kind === 'status') {
    return <StatusRow messageId={row.messageId} palette={palette} />;
  }

  if (row.role === 'user') {
    return <UserBubble messageId={row.messageId} palette={palette} />;
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
  const runtime = useAgentRuntime();
  const isWorking = useStore(runtime.chatStore, (state) => {
    if (state.activeRun === null) {
      return false;
    }
    const lastUserId = findLastUserMessageKey(state.messageOrder, state.messagesById);
    return lastUserId === messageId;
  });

  return (
    <View style={styles.statusRow}>
      <ThemedText style={[styles.statusText, { color: palette.textSecondary }]}>
        {isWorking ? 'Working…' : 'Worked'}
      </ThemedText>
    </View>
  );
});

const UserBubble = memo(function UserBubble({
  messageId,
  palette,
}: {
  messageId: string;
  palette: Palette;
}) {
  const runtime = useAgentRuntime();
  const message = useStore(runtime.chatStore, (state) => {
    const current = state.messagesById[messageId];
    return current?.role === 'user' ? current : null;
  });

  if (message === null) {
    return null;
  }

  const text = getTextContent(message.content);
  const attachments = message.content.filter(
    (block): block is ImageContent | FileContent => block.type === 'image' || block.type === 'file',
  );

  return (
    <View style={styles.userRow}>
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
    </View>
  );
});

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
  const runtime = useAgentRuntime();
  const markdown = useStore(runtime.chatStore, (state) => {
    const message = state.messagesById[messageId];
    return message?.role === 'assistant' ? getAssistantMarkdown(message) : '';
  });
  const isStreaming = useStore(runtime.chatStore, (state) =>
    state.streamingMessageIds.includes(messageId),
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
