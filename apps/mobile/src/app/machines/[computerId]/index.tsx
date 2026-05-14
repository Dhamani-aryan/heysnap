import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, useColorScheme, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { FilesystemEntry } from '@ank1015-app/ui/filesystem-types';

import { FilesToolbar } from '@/components/machine-files/files-toolbar';
import { createFileStyles, filePalettes } from '@/components/machine-files/file-screen-styles';
import { validateFilesystemName } from '@/components/machine-files/file-utils';
import { FilesystemBody } from '@/components/machine-files/filesystem-body';
import { NameSheet, type NameDialogState } from '@/components/machine-files/name-sheet';
import { FilePreviewPane } from '@/components/machine-files/file-preview-pane';
import { ThemedView } from '@/components/themed-view';
import { useMobileMachineWorkspace } from '@/components/mobile-machine-workspace-provider';

const DEFAULT_NEW_FOLDER_NAME = 'untitled folder';
const EMPTY_ENTRIES: readonly FilesystemEntry[] = [];

export default function MachineScreen() {
  const scheme = useColorScheme();
  const windowDimensions = useWindowDimensions();
  const columnCount = windowDimensions.width >= 430 ? 4 : 3;
  const palette = filePalettes[scheme === 'dark' ? 'dark' : 'light'];
  const styles = useMemo(
    () => createFileStyles(palette, columnCount, windowDimensions.width),
    [columnCount, palette, windowDimensions.width],
  );
  const {
    canGoBack,
    canGoForward,
    currentDirectoryName,
    currentPath,
    error,
    filesystemClient,
    filesystemWebsocketUrl,
    goBack,
    goForward,
    isLoading,
    listing,
    navigateTo,
    setOpenFilePath,
  } = useMobileMachineWorkspace();
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [isNameSubmitting, setIsNameSubmitting] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const entries = listing?.entries ?? EMPTY_ENTRIES;
  const isInitialLoading = isLoading && listing === null;

  const previewEntry = useMemo<FilesystemEntry | null>(() => {
    if (previewPath === null) {
      return null;
    }
    return entries.find((candidate) => candidate.path === previewPath) ?? null;
  }, [entries, previewPath]);

  // Mirror the previewed file path into the workspace context so other tabs
  // (e.g. the agent's uiContext.openFiles) can read it.
  useEffect(() => {
    setOpenFilePath(previewPath);
    return () => {
      setOpenFilePath(null);
    };
  }, [previewPath, setOpenFilePath]);

  const openCreateFolderDialog = useCallback(() => {
    setNameDialog({ mode: 'create-folder', initialName: DEFAULT_NEW_FOLDER_NAME });
  }, []);

  const openRenameDialog = useCallback((entry: FilesystemEntry) => {
    setNameDialog({ mode: 'rename', entry, initialName: entry.name });
  }, []);

  const closeNameDialog = useCallback(() => {
    setNameDialog((current) => (isNameSubmitting ? current : null));
  }, [isNameSubmitting]);

  const openPreview = useCallback((entry: FilesystemEntry) => {
    if (entry.type === 'directory') {
      navigateTo(entry.path);
      return;
    }
    setPreviewPath(entry.path);
  }, [navigateTo]);

  const closePreview = useCallback(() => {
    setPreviewPath(null);
  }, []);

  const submitNameDialog = useCallback(
    async (rawName: string) => {
      if (nameDialog === null) {
        return;
      }

      const cleanName = rawName.trim();
      const validationMessage = validateFilesystemName(cleanName);

      if (validationMessage !== null) {
        Alert.alert('Invalid Name', validationMessage);
        return;
      }

      setIsNameSubmitting(true);

      try {
        if (filesystemClient === null) {
          throw new Error('Filesystem is not connected.');
        }

        if (nameDialog.mode === 'create-folder') {
          await filesystemClient.createFolder(currentPath, cleanName);
        } else if (cleanName !== nameDialog.entry.name) {
          await filesystemClient.rename(nameDialog.entry.path, cleanName);
        }

        setNameDialog(null);
      } catch (nameError) {
        Alert.alert(
          nameDialog.mode === 'create-folder' ? 'New Folder' : 'Rename',
          nameError instanceof Error ? nameError.message : 'Failed to save name.',
        );
      } finally {
        setIsNameSubmitting(false);
      }
    },
    [currentPath, filesystemClient, nameDialog],
  );

  const handleSheetSubmit = useCallback(
    (name: string) => {
      void submitNameDialog(name);
    },
    [submitNameDialog],
  );

  return (
    <ThemedView style={[styles.shell, { backgroundColor: palette.background }]}>
      {previewEntry === null ? (
        <>
          <SafeAreaView edges={['top']} style={styles.safeArea}>
            <FilesToolbar
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              currentPath={currentPath}
              directoryName={currentDirectoryName}
              palette={palette}
              styles={styles}
              onCreateFolder={openCreateFolderDialog}
              onGoBack={goBack}
              onGoForward={goForward}
            />
          </SafeAreaView>

          <FilesystemBody
            columnCount={columnCount}
            entries={entries}
            error={error}
            filesystemClient={filesystemClient}
            isLoading={isInitialLoading}
            palette={palette}
            styles={styles}
            onOpenEntry={openPreview}
            onRenameEntry={openRenameDialog}
          />
        </>
      ) : (
        <FilePreviewPane
          entry={previewEntry}
          filesystemWebsocketUrl={filesystemWebsocketUrl}
          palette={palette}
          onBack={closePreview}
        />
      )}

      <NameSheet
        dialog={nameDialog}
        isSubmitting={isNameSubmitting}
        palette={palette}
        styles={styles}
        onCancel={closeNameDialog}
        onDismiss={closeNameDialog}
        onSubmit={handleSheetSubmit}
      />
    </ThemedView>
  );
}
