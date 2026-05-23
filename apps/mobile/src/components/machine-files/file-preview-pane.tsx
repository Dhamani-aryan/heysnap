import { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { WebView } from 'react-native-webview';
import type { FilesystemEntry } from '@ank1015-app/ui/filesystem-types';

import { ThemedText } from '@/components/themed-text';
import { WEB_PREVIEW_URL } from '@/constants/config';
import type { FilePalette } from './file-screen-styles';

type FilePreviewPaneProps = {
  entry: FilesystemEntry;
  filesystemPreviewBaseUrl: string | null;
  filesystemWebsocketUrl: string | null;
  palette: FilePalette;
  onBack: () => void;
};

export function FilePreviewPane({
  entry,
  filesystemPreviewBaseUrl,
  filesystemWebsocketUrl,
  palette,
  onBack,
}: FilePreviewPaneProps) {
  const previewUri = useMemo(() => {
    if (filesystemWebsocketUrl === null) {
      return null;
    }

    const url = new URL('/preview', WEB_PREVIEW_URL);
    url.searchParams.set('websocketUrl', filesystemWebsocketUrl);
    if (filesystemPreviewBaseUrl !== null) {
      url.searchParams.set('previewBaseUrl', filesystemPreviewBaseUrl);
    }
    url.searchParams.set('path', entry.path);
    url.searchParams.set('name', entry.name);
    return url.toString();
  }, [entry.name, entry.path, filesystemPreviewBaseUrl, filesystemWebsocketUrl]);

  return (
    <View style={[styles.shell, { backgroundColor: palette.background }]}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: palette.background }}>
        <View style={[styles.header, { borderBottomColor: palette.navOutline }]}>
          <Pressable
            accessibilityLabel="Back to files"
            accessibilityRole="button"
            hitSlop={12}
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}>
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              size={22}
              color={palette.navIcon}
              strokeWidth={2.4}
            />
          </Pressable>
          <ThemedText
            numberOfLines={1}
            style={[styles.title, { color: palette.directoryText }]}>
            {entry.name}
          </ThemedText>
          <View style={styles.headerSpacer} />
        </View>
      </SafeAreaView>

      <View style={[styles.body, { backgroundColor: palette.background }]}>
        {previewUri === null ? (
          <View style={styles.center}>
            <ThemedText style={{ color: palette.stateText }}>
              Preview unavailable.
            </ThemedText>
          </View>
        ) : (
          <WebView
            source={{ uri: previewUri }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            setSupportMultipleWindows={false}
            startInLoadingState
            renderLoading={() => (
              <View style={[styles.center, { backgroundColor: palette.background }]}>
                <ActivityIndicator color={palette.navIcon} />
              </View>
            )}
            style={[styles.webview, { backgroundColor: palette.background }]}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  body: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
