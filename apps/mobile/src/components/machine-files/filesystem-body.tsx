import { memo, useCallback, useMemo } from 'react';
import { Button, ContextMenu, Divider, Host, RNHostView } from '@expo/ui/swift-ui';
import { disabled as swiftDisabled } from '@expo/ui/swift-ui/modifiers';
import { Image as ExpoImage } from 'expo-image';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import type { FilesystemClient } from '@ank1015-app/ui/filesystem-client';
import type { FilesystemEntry } from '@ank1015-app/ui/filesystem-types';

import { ThemedText } from '@/components/themed-text';
import type { FilePalette, FileStyles } from './file-screen-styles';
import { formatBytes, formatTimestamp } from './file-utils';

const fileIconSource = require('../../../../../packages/ui/src/filesystem/assets/macos/File.png');
const folderIconSource = require('../../../../../packages/ui/src/filesystem/assets/macos/Folder.png');
const DISABLED_MENU_ITEM_MODIFIERS = [swiftDisabled(true)];

type FilesystemBodyProps = {
  columnCount: number;
  entries: readonly FilesystemEntry[];
  error: string | null;
  filesystemClient: FilesystemClient | null;
  isLoading: boolean;
  palette: FilePalette;
  styles: FileStyles;
  onOpenEntry: (entry: FilesystemEntry) => void;
  onRenameEntry: (entry: FilesystemEntry) => void;
};

export function FilesystemBody({
  entries,
  error,
  filesystemClient,
  isLoading,
  palette,
  styles,
  onOpenEntry,
  onRenameEntry,
}: FilesystemBodyProps) {
  const handleTrashEntry = useCallback((entry: FilesystemEntry) => {
    const kind = entry.type === 'directory' ? 'folder' : 'file';
    Alert.alert(
      `Move ${kind} to Trash?`,
      `“${entry.name}” will be moved to the Trash.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move to Trash',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await filesystemClient?.trash([entry.path]);
              } catch (trashError) {
                Alert.alert(
                  'Trash',
                  trashError instanceof Error
                    ? trashError.message
                    : 'Failed to move item to Trash.',
                );
              }
            })();
          },
        },
      ],
    );
  }, [filesystemClient]);

  const handleShowInfo = useCallback((entry: FilesystemEntry) => {
    Alert.alert(
      entry.name,
      [
        `Kind: ${entry.type === 'directory' ? 'Folder' : 'File'}`,
        `Path: ${entry.path || '/'}`,
        `Size: ${entry.size === null ? 'Folder' : formatBytes(entry.size)}`,
        `Modified: ${formatTimestamp(entry.updatedAt)}`,
      ].join('\n'),
    );
  }, []);

  if (isLoading) {
    return <FinderState message="Loading folder..." palette={palette} styles={styles} />;
  }

  if (error !== null) {
    return <FinderState message={error} palette={palette} styles={styles} variant="error" />;
  }

  if (entries.length === 0) {
    return (
      <View style={styles.emptyContent}>
        <ThemedText style={[styles.emptyInlineText, { color: palette.emptyInlineText }]}>
          This folder is empty.
        </ThemedText>
      </View>
    );
  }

  return (
    <ScrollView
      alwaysBounceVertical={false}
      contentContainerStyle={styles.tiles}
      removeClippedSubviews
      showsVerticalScrollIndicator
      style={styles.content}>
      {entries.map((entry) => (
        <FinderItem
          key={entry.path}
          entry={entry}
          palette={palette}
          styles={styles}
          onOpenEntry={onOpenEntry}
          onRenameEntry={onRenameEntry}
          onShowInfo={handleShowInfo}
          onTrashEntry={handleTrashEntry}
        />
      ))}
    </ScrollView>
  );
}

function FinderState({
  message,
  palette,
  styles,
  variant = 'info',
}: {
  message: string;
  palette: FilePalette;
  styles: FileStyles;
  variant?: 'info' | 'error';
}) {
  return (
    <View style={styles.state}>
      <ThemedText
        style={[
          styles.stateText,
          { color: variant === 'error' ? palette.errorText : palette.stateText },
        ]}>
        {message}
      </ThemedText>
    </View>
  );
}

type FinderItemProps = {
  entry: FilesystemEntry;
  palette: FilePalette;
  styles: FileStyles;
  onOpenEntry: (entry: FilesystemEntry) => void;
  onRenameEntry: (entry: FilesystemEntry) => void;
  onShowInfo: (entry: FilesystemEntry) => void;
  onTrashEntry: (entry: FilesystemEntry) => void;
};

const FinderItem = memo(function FinderItem({
  entry,
  palette,
  styles,
  onOpenEntry,
  onRenameEntry,
  onShowInfo,
  onTrashEntry,
}: FinderItemProps) {
  const isDirectory = entry.type === 'directory';

  const handleOpen = useCallback(() => onOpenEntry(entry), [entry, onOpenEntry]);

  const handleRename = useCallback(() => onRenameEntry(entry), [entry, onRenameEntry]);
  const handleInfo = useCallback(() => onShowInfo(entry), [entry, onShowInfo]);
  const handleTrash = useCallback(() => {
    void onTrashEntry(entry);
  }, [entry, onTrashEntry]);

  const tileStyle = useMemo(
    () => ({ pressed }: { pressed: boolean }) => [
      styles.finderItem,
      pressed ? styles.finderItemPressed : null,
    ],
    [styles.finderItem, styles.finderItemPressed],
  );

  return (
    <View style={styles.finderItemCell}>
      <Host style={styles.finderItemHost} matchContents>
        <ContextMenu>
          <ContextMenu.Trigger>
            <RNHostView matchContents>
              <Pressable
                accessibilityLabel={`${isDirectory ? 'Folder' : 'File'}: ${entry.name}`}
                accessibilityRole="button"
                onPress={handleOpen}
                style={tileStyle}>
                <View style={styles.finderItemIcon}>
                  <ExpoImage
                    contentFit="contain"
                    source={isDirectory ? folderIconSource : fileIconSource}
                    style={isDirectory ? styles.folderIcon : styles.fileIcon}
                  />
                </View>
                <View style={styles.finderItemLabel}>
                  <ThemedText
                    numberOfLines={1}
                    style={[styles.finderItemLabelText, { color: palette.itemLabelText }]}>
                    {entry.name}
                  </ThemedText>
                </View>
              </Pressable>
            </RNHostView>
          </ContextMenu.Trigger>
          <ContextMenu.Items>
            <Button label="Open" systemImage="eye" onPress={handleOpen} />
            <Button label="Rename" systemImage="pencil" onPress={handleRename} />
            <Button label="Get Info" systemImage="info.circle" onPress={handleInfo} />
            <Divider />
            <Button
              label="Trash"
              role="destructive"
              systemImage="trash"
              onPress={handleTrash}
            />
            <Button
              label="Download"
              systemImage="arrow.down.circle"
              modifiers={DISABLED_MENU_ITEM_MODIFIERS}
            />
          </ContextMenu.Items>
        </ContextMenu>
      </Host>
    </View>
  );
});
