import { Button, Divider, Host, Menu, RNHostView } from '@expo/ui/swift-ui';
import { disabled as swiftDisabled } from '@expo/ui/swift-ui/modifiers';
import { ArrowLeft01Icon, ArrowRight01Icon, MoreHorizontalIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { FilePalette, FileStyles } from './file-screen-styles';

const DISABLED_MENU_ITEM_MODIFIERS = [swiftDisabled(true)];

type FilesToolbarProps = {
  canGoBack: boolean;
  canGoForward: boolean;
  canPaste: boolean;
  currentPath: string;
  directoryName: string;
  palette: FilePalette;
  styles: FileStyles;
  onCreateFolder: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onPaste: () => void;
  onUploadFiles: () => void;
};

export function FilesToolbar({
  canGoBack,
  canGoForward,
  canPaste,
  currentPath,
  directoryName,
  palette,
  styles,
  onCreateFolder,
  onGoBack,
  onGoForward,
  onPaste,
  onUploadFiles,
}: FilesToolbarProps) {
  return (
    <View style={styles.toolbar}>
      <View style={styles.toolbarInner}>
        <View style={styles.navPill}>
          <ToolbarButton
            accessibilityLabel="Back"
            disabled={!canGoBack}
            styles={styles}
            onPress={onGoBack}>
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              size={20}
              color={palette.navIcon}
              strokeWidth={2.4}
            />
          </ToolbarButton>
          <ToolbarButton
            accessibilityLabel="Forward"
            disabled={!canGoForward}
            styles={styles}
            onPress={onGoForward}>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={20}
              color={palette.navIcon}
              strokeWidth={2.4}
            />
          </ToolbarButton>
        </View>

        <Pressable
          accessibilityLabel={`Current directory: ${currentPath.length > 0 ? currentPath : '/'}`}
          accessibilityRole="button"
          style={({ pressed }) => [styles.directoryTab, pressed && styles.directoryTabPressed]}>
          <ThemedText
            numberOfLines={1}
            style={[styles.directoryTitle, { color: palette.directoryText }]}>
            {directoryName}
          </ThemedText>
        </Pressable>

        <HeaderFilesystemMenu
          canPaste={canPaste}
          styles={styles}
          onCreateFolder={onCreateFolder}
          onPaste={onPaste}
          onUploadFiles={onUploadFiles}
        />
      </View>
    </View>
  );
}

function HeaderFilesystemMenu({
  canPaste,
  styles,
  onCreateFolder,
  onPaste,
  onUploadFiles,
}: {
  canPaste: boolean;
  styles: FileStyles;
  onCreateFolder: () => void;
  onPaste: () => void;
  onUploadFiles: () => void;
}) {
  return (
    <Host style={styles.headerMenuHost}>
      <Menu
        label={(
          <RNHostView matchContents>
            <View
              accessibilityLabel="Filesystem actions"
              accessibilityRole="button"
              style={styles.headerMenuButton}>
              <HugeiconsIcon
                icon={MoreHorizontalIcon}
                size={22}
                color={styles.headerMenuIcon.color}
                strokeWidth={2.2}
              />
            </View>
          </RNHostView>
        )}>
        <Button label="New Folder" systemImage="folder.badge.plus" onPress={onCreateFolder} />
        <Divider />
        <Button
          label="Paste"
          systemImage="doc.on.clipboard"
          modifiers={canPaste ? undefined : DISABLED_MENU_ITEM_MODIFIERS}
          onPress={onPaste}
        />
        <Divider />
        <Button label="Get Info" systemImage="info.circle" modifiers={DISABLED_MENU_ITEM_MODIFIERS} />
        <Button label="Change Wallpaper" modifiers={DISABLED_MENU_ITEM_MODIFIERS} />
        <Button label="Upload Files" systemImage="doc.badge.plus" onPress={onUploadFiles} />
        <Button label="Upload Folder" systemImage="folder.badge.plus" modifiers={DISABLED_MENU_ITEM_MODIFIERS} />
      </Menu>
    </Host>
  );
}

function ToolbarButton({
  accessibilityLabel,
  children,
  disabled,
  styles,
  onPress,
}: {
  accessibilityLabel: string;
  children: ReactNode;
  disabled: boolean;
  styles: FileStyles;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolbarButton,
        disabled && styles.toolbarButtonDisabled,
        pressed && !disabled ? styles.toolbarButtonPressed : null,
      ]}>
      {children}
    </Pressable>
  );
}
