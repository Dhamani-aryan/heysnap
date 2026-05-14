import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Folder01Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native';
import {
  selectHasThreads,
  useAgentThreadGroupsQuery,
  useAgentThreadListStore,
  type AgentThreadGroup,
  type AgentThreadSummary,
} from '@ank1015-app/ui/agent-hooks';

import { ThemedText } from '@/components/themed-text';

type Palette = {
  background: string;
  pressed: string;
  selected: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  errorText: string;
};

const lightPalette: Palette = {
  background: '#ffffff',
  pressed: 'rgba(0,0,0,0.05)',
  selected: '#ECECEE',
  textPrimary: 'rgba(0,0,0,0.86)',
  textSecondary: 'rgba(0,0,0,0.6)',
  textMuted: 'rgba(0,0,0,0.42)',
  accent: '#0a84ff',
  errorText: '#ff6363',
};

const darkPalette: Palette = {
  background: '#000000',
  pressed: 'rgba(255,255,255,0.06)',
  selected: '#1D1D1F',
  textPrimary: 'rgba(255,255,255,0.9)',
  textSecondary: 'rgba(255,255,255,0.62)',
  textMuted: 'rgba(255,255,255,0.42)',
  accent: '#0a84ff',
  errorText: '#ff6363',
};

type MobileAgentThreadDrawerProps = {
  isOpen: boolean;
  selectedThreadId: string | null;
  scheme: 'light' | 'dark';
  onClose: () => void;
  onSelectThread: (thread: AgentThreadSummary) => void;
  onNewThread: () => void;
};

export function MobileAgentThreadDrawer({
  isOpen,
  selectedThreadId,
  scheme,
  onClose,
  onSelectThread,
  onNewThread,
}: MobileAgentThreadDrawerProps) {
  const palette = scheme === 'dark' ? darkPalette : lightPalette;

  useAgentThreadGroupsQuery({ enabled: isOpen });
  const groups = useAgentThreadListStore((state) => state.groups);
  const isLoading = useAgentThreadListStore((state) => state.isLoading);
  const error = useAgentThreadListStore((state) => state.error);
  const hasThreads = useAgentThreadListStore(selectHasThreads);

  const nonEmptyGroups = useMemo(
    () => groups.filter((group) => group.threads.length > 0),
    [groups],
  );

  // Track which groups are expanded. Default: first group (workspace) open.
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (nonEmptyGroups.length === 0) {
      return;
    }
    setExpandedGroups((current) => {
      if (Object.keys(current).length > 0) {
        return current;
      }
      return { [nonEmptyGroups[0].path]: true };
    });
  }, [nonEmptyGroups]);

  const toggleGroup = useCallback((path: string) => {
    setExpandedGroups((current) => ({ ...current, [path]: !(current[path] ?? false) }));
  }, []);

  const handleSelect = useCallback(
    (thread: AgentThreadSummary) => {
      onSelectThread(thread);
      onClose();
    },
    [onClose, onSelectThread],
  );

  const handleNew = useCallback(() => {
    onNewThread();
    onClose();
  }, [onClose, onNewThread]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent={false}
      visible={isOpen}>
      <SafeAreaProvider style={{ backgroundColor: palette.background }}>
        <SafeAreaView edges={['top']} style={[styles.shell, { backgroundColor: palette.background }]}>
          <View style={styles.header}>
            <Pressable
              accessibilityLabel="Close history"
              accessibilityRole="button"
              hitSlop={12}
              onPress={onClose}
              style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.5 }]}>
              <HugeiconsIcon icon={Cancel01Icon} size={24} color={palette.textSecondary} strokeWidth={2.2} />
            </Pressable>
            <ThemedText style={[styles.title, { color: palette.textPrimary }]}>History</ThemedText>
            <View style={styles.headerButton} />
          </View>

          <ScrollView
            style={{ flex: 1, backgroundColor: palette.background }}
            contentContainerStyle={styles.scrollContent}>
            <Pressable
              accessibilityLabel="Start a new chat"
              accessibilityRole="button"
              onPress={handleNew}
              style={({ pressed }) => [
                styles.row,
                styles.topRow,
                pressed && { backgroundColor: palette.pressed },
              ]}>
              <HugeiconsIcon
                icon={PlusSignIcon}
                size={20}
                color={palette.textPrimary}
                strokeWidth={1.8}
              />
              <ThemedText style={[styles.rowText, { color: palette.textPrimary }]}>
                New Chat
              </ThemedText>
            </Pressable>

            {error !== null ? (
              <DrawerState text={error} variant="error" palette={palette} />
            ) : isLoading && !hasThreads ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={palette.textSecondary} />
              </View>
            ) : !hasThreads ? (
              <DrawerState text="No previous chats." palette={palette} />
            ) : (
              <View style={styles.chatsSection}>
                <ThemedText style={[styles.sectionLabel, { color: palette.textMuted }]}>
                  Chats
                </ThemedText>
                {nonEmptyGroups.map((group) => (
                  <ThreadGroupSection
                    key={group.path}
                    group={group}
                    palette={palette}
                    isExpanded={expandedGroups[group.path] ?? false}
                    selectedThreadId={selectedThreadId}
                    onToggle={toggleGroup}
                    onSelectThread={handleSelect}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const ThreadGroupSection = memo(function ThreadGroupSection({
  group,
  palette,
  isExpanded,
  selectedThreadId,
  onToggle,
  onSelectThread,
}: {
  group: AgentThreadGroup;
  palette: Palette;
  isExpanded: boolean;
  selectedThreadId: string | null;
  onToggle: (path: string) => void;
  onSelectThread: (thread: AgentThreadSummary) => void;
}) {
  const groupLabel = group.path.trim().length === 0 ? 'workspace' : group.path.split('/').pop() ?? group.path;

  return (
    <View style={styles.groupSection}>
      <Pressable
        accessibilityLabel={`${isExpanded ? 'Collapse' : 'Expand'} ${groupLabel}`}
        accessibilityRole="button"
        onPress={() => onToggle(group.path)}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: palette.pressed },
        ]}>
        <HugeiconsIcon
          icon={Folder01Icon}
          size={20}
          color={palette.textSecondary}
          strokeWidth={1.8}
        />
        <ThemedText numberOfLines={1} style={[styles.rowText, { color: palette.textPrimary }]}>
          {groupLabel}
        </ThemedText>
        <HugeiconsIcon
          icon={isExpanded ? ArrowDown01Icon : ArrowRight01Icon}
          size={18}
          color={palette.textMuted}
          strokeWidth={2}
        />
      </Pressable>

      {isExpanded
        ? group.threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              palette={palette}
              isSelected={thread.id === selectedThreadId}
              onSelectThread={onSelectThread}
            />
          ))
        : null}
    </View>
  );
});

const ThreadRow = memo(function ThreadRow({
  thread,
  palette,
  isSelected,
  onSelectThread,
}: {
  thread: AgentThreadSummary;
  palette: Palette;
  isSelected: boolean;
  onSelectThread: (thread: AgentThreadSummary) => void;
}) {
  const timeLabel = useMemo(() => formatRelative(thread.updatedAt), [thread.updatedAt]);
  const title = thread.title.trim().length > 0 ? thread.title : 'Untitled chat';

  return (
    <Pressable
      accessibilityLabel={`Open chat: ${title}`}
      accessibilityRole="button"
      onPress={() => onSelectThread(thread)}
      style={({ pressed }) => [
        styles.threadRow,
        isSelected && { backgroundColor: palette.selected },
        !isSelected && pressed && { backgroundColor: palette.pressed },
      ]}>
      <ThemedText numberOfLines={1} style={[styles.threadTitle, { color: palette.textSecondary }]}>
        {title}
      </ThemedText>
      <ThemedText numberOfLines={1} style={[styles.threadTime, { color: palette.textMuted }]}>
        {timeLabel}
      </ThemedText>
      {thread.isStreaming === true ? (
        <View style={[styles.streamingDot, { backgroundColor: palette.accent }]} />
      ) : null}
    </Pressable>
  );
});

function DrawerState({
  text,
  variant = 'muted',
  palette,
}: {
  text: string;
  variant?: 'muted' | 'error';
  palette: Palette;
}) {
  return (
    <View style={styles.stateRow}>
      <ThemedText
        style={[styles.stateText, { color: variant === 'error' ? palette.errorText : palette.textMuted }]}>
        {text}
      </ThemedText>
    </View>
  );
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const formatRelative = (timestamp: number): string => {
  if (!Number.isFinite(timestamp)) {
    return '';
  }
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < MINUTE_MS) {
    return 'now';
  }
  if (diff < HOUR_MS) {
    return `${Math.floor(diff / MINUTE_MS).toString()}m`;
  }
  if (diff < DAY_MS) {
    return `${Math.floor(diff / HOUR_MS).toString()}h`;
  }
  if (diff < WEEK_MS) {
    return `${Math.floor(diff / DAY_MS).toString()}d`;
  }
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const ROW_PADDING_HORIZONTAL = 10;
const ICON_SIZE = 20;
const ICON_GAP = 14;

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
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
    fontSize: 17,
    fontWeight: '600',
  },
  scrollContent: {
    paddingTop: 20,
    paddingBottom: 32,
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ICON_GAP,
    paddingHorizontal: ROW_PADDING_HORIZONTAL,
    paddingVertical: 11,
    borderRadius: 8,
  },
  topRow: {
    marginBottom: 2,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 22,
  },
  chatsSection: {
    marginTop: 20,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    paddingHorizontal: ROW_PADDING_HORIZONTAL,
    paddingBottom: 8,
  },
  groupSection: {
    marginBottom: 2,
  },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingRight: ROW_PADDING_HORIZONTAL,
    paddingLeft: ROW_PADDING_HORIZONTAL + ICON_SIZE + ICON_GAP,
    borderRadius: 8,
  },
  threadTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 20,
  },
  threadTime: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
  streamingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 24,
  },
  stateRow: {
    paddingVertical: 28,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  stateText: {
    fontSize: 13,
  },
});
