import { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { FilesystemEntry } from '@ank1015-app/ui/filesystem-types';

import { ThemedText } from '@/components/themed-text';
import { WEB_PREVIEW_URL } from '@/constants/config';
import type { FilePalette } from './file-screen-styles';

type FilePreviewPaneProps = {
  entry: FilesystemEntry;
  filesystemWebsocketUrl: string | null;
  palette: FilePalette;
  onBack: () => void;
};

const versionOf = (entry: FilesystemEntry): string =>
  `${entry.updatedAt}:${String(entry.size ?? '')}`;

export function FilePreviewPane({
  entry,
  filesystemWebsocketUrl,
  palette,
  onBack,
}: FilePreviewPaneProps) {
  const webViewRef = useRef<WebView>(null);
  const isReadyRef = useRef(false);
  const pendingUpdateRef = useRef<string | null>(null);

  const previewUri = useMemo(() => {
    if (filesystemWebsocketUrl === null) {
      return null;
    }

    const url = new URL('/preview', WEB_PREVIEW_URL);
    url.searchParams.set('websocketUrl', filesystemWebsocketUrl);
    url.searchParams.set('path', entry.path);
    url.searchParams.set('name', entry.name);
    url.searchParams.set('v', versionOf(entry));
    return url.toString();
  }, [entry.path, filesystemWebsocketUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentVersion = versionOf(entry);
  const lastSentVersionRef = useRef<string | null>(currentVersion);

  // Reset the bridge state whenever a new file path is opened.
  useEffect(() => {
    isReadyRef.current = false;
    pendingUpdateRef.current = null;
    lastSentVersionRef.current = currentVersion;
  }, [entry.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push version updates into the WebView when the file changes server-side.
  useEffect(() => {
    if (lastSentVersionRef.current === currentVersion) {
      return;
    }

    lastSentVersionRef.current = currentVersion;
    const payload = JSON.stringify({
      type: 'update',
      path: entry.path,
      name: entry.name,
      version: currentVersion,
    });

    if (isReadyRef.current) {
      sendToWebView(webViewRef.current, payload);
    } else {
      pendingUpdateRef.current = payload;
    }
  }, [currentVersion, entry.name, entry.path]);

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
    </View>
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
