import { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { FilesystemEntry } from '@ank1015-app/ui/filesystem-types';

import { ThemedText } from '@/components/themed-text';
import { WEB_PREVIEW_URL } from '@/constants/config';
import type { FilePalette } from './file-screen-styles';

type FilePreviewModalProps = {
  entry: FilesystemEntry | null;
  filesystemWebsocketUrl: string | null;
  palette: FilePalette;
  onClose: () => void;
};

const versionOf = (entry: FilesystemEntry): string =>
  `${entry.updatedAt}:${String(entry.size ?? '')}`;

export function FilePreviewModal({
  entry,
  filesystemWebsocketUrl,
  palette,
  onClose,
}: FilePreviewModalProps) {
  const webViewRef = useRef<WebView>(null);
  const isReadyRef = useRef(false);
  const pendingUpdateRef = useRef<string | null>(null);

  const previewUri = useMemo(() => {
    if (entry === null || filesystemWebsocketUrl === null) {
      return null;
    }

    const url = new URL('/preview', WEB_PREVIEW_URL);
    url.searchParams.set('websocketUrl', filesystemWebsocketUrl);
    url.searchParams.set('path', entry.path);
    url.searchParams.set('name', entry.name);
    url.searchParams.set('v', versionOf(entry));
    return url.toString();
  }, [entry, filesystemWebsocketUrl]);

  const currentVersion = entry === null ? null : versionOf(entry);
  const initialVersionRef = useRef<string | null>(currentVersion);
  const lastSentVersionRef = useRef<string | null>(currentVersion);

  // Reset the bridge state whenever a new file is opened.
  useEffect(() => {
    if (entry === null) {
      isReadyRef.current = false;
      pendingUpdateRef.current = null;
      initialVersionRef.current = null;
      lastSentVersionRef.current = null;
      return;
    }

    isReadyRef.current = false;
    pendingUpdateRef.current = null;
    initialVersionRef.current = versionOf(entry);
    lastSentVersionRef.current = versionOf(entry);
  }, [entry?.path, entry?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push version updates into the WebView when the file changes server-side.
  useEffect(() => {
    if (entry === null || currentVersion === null) {
      return;
    }

    if (lastSentVersionRef.current === currentVersion) {
      return;
    }

    lastSentVersionRef.current = currentVersion;
    const payload = JSON.stringify({ type: 'update', version: currentVersion });

    if (isReadyRef.current) {
      sendToWebView(webViewRef.current, payload);
    } else {
      pendingUpdateRef.current = payload;
    }
  }, [entry, currentVersion]);

  const handleMessage = (event: WebViewMessageEvent) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return;
    }

    const type = (parsed as { type?: unknown }).type;

    if (type === 'ready') {
      isReadyRef.current = true;
      if (pendingUpdateRef.current !== null) {
        sendToWebView(webViewRef.current, pendingUpdateRef.current);
        pendingUpdateRef.current = null;
      }
    }
  };

  const isVisible = entry !== null && previewUri !== null;

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent={false}
      visible={isVisible}>
      <SafeAreaView edges={['top']} style={[styles.shell, { backgroundColor: palette.background }]}>
        <View style={[styles.header, { borderBottomColor: palette.navOutline }]}>
          <ThemedText
            numberOfLines={1}
            style={[styles.title, { color: palette.directoryText }]}>
            {entry?.name ?? ''}
          </ThemedText>
          <Pressable
            accessibilityLabel="Close preview"
            accessibilityRole="button"
            hitSlop={12}
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.6 }]}>
            <HugeiconsIcon
              icon={Cancel01Icon}
              size={22}
              color={palette.navIcon}
              strokeWidth={2.4}
            />
          </Pressable>
        </View>

        <View style={[styles.body, { backgroundColor: palette.background }]}>
          {previewUri === null ? (
            <View style={styles.center}>
              <ThemedText style={{ color: palette.stateText }}>
                Preview unavailable.
              </ThemedText>
            </View>
          ) : (
            <WebView
              ref={webViewRef}
              source={{ uri: previewUri }}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              setSupportMultipleWindows={false}
              onMessage={handleMessage}
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
      </SafeAreaView>
    </Modal>
  );
}

const sendToWebView = (webView: WebView | null, payload: string): void => {
  if (webView === null) {
    return;
  }

  const script = `(() => { try { window.postMessage(${JSON.stringify(payload)}, '*'); } catch (e) {} return true; })();`;
  webView.injectJavaScript(script);
};

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
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
