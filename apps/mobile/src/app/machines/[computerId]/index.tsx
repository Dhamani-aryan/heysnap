import { useCallback, useMemo, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import { Alert, Linking, useColorScheme, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FilesToolbar } from '@/components/machine-files/files-toolbar';
import { createFileStyles, filePalettes } from '@/components/machine-files/file-screen-styles';
import { validateFilesystemName } from '@/components/machine-files/file-utils';
import { FilesystemBody } from '@/components/machine-files/filesystem-body';
import { FilesOrbMicButton } from '@/components/machine-files/files-orb-mic-button';
import { NameSheet, type NameDialogState } from '@/components/machine-files/name-sheet';
import { FilePreviewPane } from '@/components/machine-files/file-preview-pane';
import { ThemedView } from '@/components/themed-view';
import { useMobileMachineWorkspace } from '@/components/mobile-machine-workspace-provider';
import { useAgentRun } from '@/hooks/agent/use-agent-run';
import { useAuth } from '@/hooks/auth/use-auth';
import { getNewThreadModelSelection } from '@/lib/agent/model-selection';
import type { AgentContent, AgentUiContext } from '@/lib/agent/types';
import type { FilesystemEntry, FilesystemUploadFile } from '@/lib/filesystem/types';
import { useAgentChatStore } from '@/stores/agent/agent-chat-store';
import { useAgentModelSelectionStore } from '@/stores/agent/agent-model-selection-store';
import { useFilesystemStore } from '@/stores/filesystem/filesystem-store';

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
    agentBaseUrl,
    currentDirectoryName,
    currentPath,
    error,
    filesystemClient,
    goBack,
    goForward,
    isLoading,
    listing,
    navigateTo,
    openFile,
    openFileEntry,
    closeOpenFile,
  } = useMobileMachineWorkspace();
  const filesystemClipboard = useFilesystemStore((state) => state.filesystemClipboard);
  const setFilesystemClipboard = useFilesystemStore((state) => state.setFilesystemClipboard);
  const clearFilesystemClipboard = useFilesystemStore((state) => state.clearFilesystemClipboard);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [isNameSubmitting, setIsNameSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const entries = listing?.entries ?? EMPTY_ENTRIES;
  const isInitialLoading = isLoading && listing === null;
  const previewEntry = openFileEntry;
  const canPaste =
    filesystemClient !== null &&
    filesystemClipboard !== null &&
    filesystemClipboard.entries.length > 0;

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
    openFile(entry.path);
  }, [navigateTo, openFile]);

  const closePreview = useCallback(() => {
    closeOpenFile();
  }, [closeOpenFile]);

  const copyEntry = useCallback((entry: FilesystemEntry) => {
    setFilesystemClipboard('copy', [entry]);
  }, [setFilesystemClipboard]);

  const cutEntry = useCallback((entry: FilesystemEntry) => {
    setFilesystemClipboard('cut', [entry]);
  }, [setFilesystemClipboard]);

  const pasteClipboard = useCallback(() => {
    void (async () => {
      if (filesystemClient === null || filesystemClipboard === null) {
        return;
      }

      try {
        await filesystemClient.paste(
          filesystemClipboard.mode === 'cut' ? 'move' : 'copy',
          filesystemClipboard.entries.map((entry) => entry.path),
          currentPath,
        );
        if (filesystemClipboard.mode === 'cut') {
          clearFilesystemClipboard();
        }
      } catch (pasteError) {
        Alert.alert(
          'Paste',
          pasteError instanceof Error ? pasteError.message : 'Failed to paste items.',
        );
      }
    })();
  }, [clearFilesystemClipboard, currentPath, filesystemClient, filesystemClipboard]);

  const downloadEntry = useCallback((entry: FilesystemEntry) => {
    void (async () => {
      if (filesystemClient === null) {
        Alert.alert('Download', 'Filesystem is not connected.');
        return;
      }

      try {
        await Linking.openURL(filesystemClient.getDownloadUrl([entry.path]));
      } catch (downloadError) {
        Alert.alert(
          'Download',
          downloadError instanceof Error
            ? downloadError.message
            : 'Failed to open download.',
        );
      }
    })();
  }, [filesystemClient]);

  const uploadFiles = useCallback(() => {
    void (async () => {
      if (isUploading) return;
      if (filesystemClient === null) {
        Alert.alert('Upload Files', 'Filesystem is not connected.');
        return;
      }

      setIsUploading(true);
      try {
        const result = await DocumentPicker.getDocumentAsync({
          multiple: true,
          copyToCacheDirectory: true,
          base64: false,
        });
        if (result.canceled || result.assets.length === 0) {
          return;
        }

        const files = await Promise.all(result.assets.map(toFilesystemUploadFile));
        await filesystemClient.upload(currentPath, files);
        await filesystemClient.refresh();
      } catch (uploadError) {
        Alert.alert(
          'Upload Files',
          uploadError instanceof Error ? uploadError.message : 'Failed to upload files.',
        );
      } finally {
        setIsUploading(false);
      }
    })();
  }, [currentPath, filesystemClient, isUploading]);

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
              canPaste={canPaste}
              currentPath={currentPath}
              directoryName={currentDirectoryName}
              palette={palette}
              styles={styles}
              onCreateFolder={openCreateFolderDialog}
              onGoBack={goBack}
              onGoForward={goForward}
              onPaste={pasteClipboard}
              onUploadFiles={uploadFiles}
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
            onCopyEntry={copyEntry}
            onCutEntry={cutEntry}
            onDownloadEntry={downloadEntry}
            onOpenEntry={openPreview}
            onRenameEntry={openRenameDialog}
          />
        </>
      ) : (
        <FilePreviewPane
          key={previewEntry.path}
          entry={previewEntry}
          filesystemClient={filesystemClient}
          palette={palette}
          onBack={closePreview}
        />
      )}

      {agentBaseUrl === null ? (
        <FilesOrbMicButton palette={palette} />
      ) : (
        <FilesAgentVoiceButton palette={palette} />
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

async function toFilesystemUploadFile(
  asset: DocumentPicker.DocumentPickerAsset,
): Promise<FilesystemUploadFile> {
  const base64 =
    asset.base64 ??
    (await readAsStringAsync(asset.uri, { encoding: EncodingType.Base64 }));
  const contentBase64 = stripDataUrlPrefix(base64);

  return {
    relativePath: asset.name,
    type: 'file',
    contentBase64,
    updatedAt: Number.isFinite(asset.lastModified)
      ? new Date(asset.lastModified).toISOString()
      : undefined,
  };
}

function stripDataUrlPrefix(value: string): string {
  const commaIndex = value.indexOf(',');
  return value.startsWith('data:') && commaIndex >= 0
    ? value.slice(commaIndex + 1)
    : value;
}

function FilesAgentVoiceButton({
  palette,
}: {
  palette: (typeof filePalettes)['light'] | (typeof filePalettes)['dark'];
}) {
  const {
    agentBaseUrl,
    agentIdentity,
    currentPath,
    openFilePath,
    selectedAgentThreadId,
    setSelectedAgentThreadId,
  } = useMobileMachineWorkspace();
  const auth = useAuth();
  const isRunning = useAgentChatStore((state) => state.activeRun !== null);
  const promptModelChoice = useAgentModelSelectionStore((state) => state.promptModelChoice);

  const uiContext = useMemo<AgentUiContext>(
    () => ({
      openFiles:
        openFilePath !== null ? [{ path: openFilePath, isFocused: true }] : [],
    }),
    [openFilePath],
  );

  const { submit, steer } = useAgentRun({
    agentBaseUrl: agentBaseUrl ?? '',
    agentIdentity: agentIdentity ?? '',
    currentPath,
    selectedThreadId: selectedAgentThreadId,
    uiContext,
    onThreadResolved: (threadId) => {
      setSelectedAgentThreadId((current) => current ?? threadId);
    },
  });

  const sendTranscript = useCallback(
    (transcript: string) => {
      const content: AgentContent = [{ type: 'text', content: transcript }];
      if (isRunning) {
        return steer({ content });
      }

      return submit({
        content,
        ...getNewThreadModelSelection({
          allowModelSelection: auth.user?.allowPiModels === true,
          selectedThreadId: selectedAgentThreadId,
          promptModelChoice,
        }),
      });
    },
    [auth.user?.allowPiModels, isRunning, promptModelChoice, selectedAgentThreadId, steer, submit],
  );

  return (
    <FilesOrbMicButton
      isStreaming={isRunning}
      palette={palette}
      onSendTranscript={sendTranscript}
    />
  );
}
