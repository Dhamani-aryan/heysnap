import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Image } from 'expo-image';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
  type KeyboardEvent,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Add01Icon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  Cancel01Icon,
  KeyboardIcon,
  ReloadIcon,
  SquareIcon,
  TouchInteraction02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react-native';

import { ThemedText } from '@/components/themed-text';
import { useMobileMachineWorkspace } from '@/components/mobile-machine-workspace-provider';
import {
  useBrowserViewSubscription,
  type BrowserViewTab,
} from '@/hooks/browser/use-browser-view-subscription';

const CHROME_COLOR = '#323436';
const VIEWPORT_COLOR = '#202326';
const ADDRESS_COLOR = '#25282e';
const DIVIDER_COLOR = 'rgba(255, 255, 255, 0.1)';
const ICON_COLOR = 'rgba(255, 255, 255, 0.82)';
const ACTIVE_ICON_COLOR = '#74f28a';
const ACTIVE_BUTTON_COLOR = 'rgba(116, 242, 138, 0.16)';
const DISABLED_ICON_COLOR = 'rgba(255, 255, 255, 0.38)';
const TEXT_COLOR = 'rgba(255, 255, 255, 0.9)';
const MUTED_TEXT_COLOR = 'rgba(255, 255, 255, 0.46)';
const PRESSED_COLOR = 'rgba(255, 255, 255, 0.08)';
const TAP_DISTANCE_THRESHOLD = 8;
const WHEEL_SEND_INTERVAL_MS = 32;
const WHEEL_DELTA_SCALE = 1.35;
const TABS_DROPDOWN_WIDTH = 280;
const TABS_DROPDOWN_MAX_HEIGHT = 320;
const TABS_DROPDOWN_MARGIN = 10;
const TABS_DROPDOWN_OFFSET = 8;
const TABS_DROPDOWN_ITEM_HEIGHT = 54;
const TABS_DROPDOWN_PADDING = 6;

type ViewportLayout = {
  readonly height: number;
  readonly width: number;
};

type BrowserKeyboardInput = {
  readonly altKey: boolean;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly keyCode: number;
  readonly location: number;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  readonly shiftKey: boolean;
  readonly text?: string;
  readonly type: 'keyDown' | 'keyUp';
};

export default function MachineOverviewScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const windowDimensions = useWindowDimensions();
  const {
    browserViewSubscribeWebSocketUrl,
    setBrowserConnected,
  } = useMobileMachineWorkspace();
  const browserView = useBrowserViewSubscription({
    enabled: isFocused && browserViewSubscribeWebSocketUrl !== null,
    url: browserViewSubscribeWebSocketUrl,
  });
  const browserConnected =
    browserView.status === 'connected' &&
    browserView.publisherConnected &&
    browserView.browserStatus?.connected === true;
  const streamPresent =
    browserView.streamStatus?.streaming === true ||
    browserView.streamStatus?.reason === 'new_tab';
  const streamConnected = browserConnected && streamPresent;
  const activeTabUrl = browserView.activeTab?.url;
  const isNewTab = isBrowserNewTab(activeTabUrl, browserView.streamStatus?.reason);
  const headerTitle = streamConnected
    ? isNewTab
      ? 'New Tab'
      : getBrowserHeaderTitle({
          title: browserView.activeTab?.title,
          url: activeTabUrl,
        })
    : 'Browser';
  const tabCount = streamConnected ? browserView.browserStatus?.tabCount ?? 0 : 0;
  const activeAddressValue = streamConnected && !isNewTab ? activeTabUrl ?? '' : '';
  const [addressValue, setAddressValue] = useState(activeAddressValue);
  const [isAddressFocused, setIsAddressFocused] = useState(false);
  const [addressKeyboardOffset, setAddressKeyboardOffset] = useState(0);
  const [isBrowserInteractionEnabled, setIsBrowserInteractionEnabled] = useState(false);
  const [isBrowserKeyboardFocused, setIsBrowserKeyboardFocused] = useState(false);
  const [isTabsDropdownOpen, setIsTabsDropdownOpen] = useState(false);
  const [tabsDropdownFrame, setTabsDropdownFrame] = useState<{
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const addressInputRef = useRef<TextInput | null>(null);
  const browserKeyboardInputRef = useRef<TextInput | null>(null);
  const browserKeyboardNativeValueRef = useRef('');
  const previousActiveTabIdRef = useRef<number | null>(null);
  const tabsDropdownTriggerRef = useRef<View | null>(null);
  const [viewportLayout, setViewportLayout] = useState<ViewportLayout>({
    height: 0,
    width: 0,
  });
  const sendBrowserCommand = browserView.sendCommand;
  const activeBrowserTabId = browserView.browserStatus?.activeTabId ?? null;
  const tabs = browserView.tabs;
  const canCreateTab = streamConnected;
  const canControlBrowser = streamConnected && activeBrowserTabId !== null;
  const canOpenTabsDialog = streamConnected && tabs.length > 0;
  const canToggleBrowserInteraction = canControlBrowser && !isNewTab;
  const canReloadTab = canControlBrowser;
  const canUseBrowserKeyboard = isBrowserInteractionEnabled && canControlBrowser;
  const canGoBack = streamConnected && browserView.browserStatus?.canGoBack === true;
  const canGoForward = streamConnected && browserView.browserStatus?.canGoForward === true;
  const isAnyKeyboardFocused = isAddressFocused || isBrowserKeyboardFocused;
  const footerKeyboardOffset = isAddressFocused ? addressKeyboardOffset : 0;
  const visibleFrameUri =
    browserConnected &&
    browserView.streamStatus?.streaming === true &&
    browserView.frameUri !== null
      ? browserView.frameUri
      : null;
  const centerMessage = getBrowserCenterMessage({
    browserConnected,
    frameUri: visibleFrameUri,
    isNewTab,
    streamPresent,
  });
  const frameAspectRatio = browserView.frameMetadata?.aspectRatio ?? null;
  const canSendViewportInput =
    isBrowserInteractionEnabled &&
    visibleFrameUri !== null &&
    canControlBrowser &&
    !isNewTab;
  const inputGestureStateRef = useRef({
    didScroll: false,
    lastSentAt: 0,
    lastX: 0,
    lastY: 0,
    pendingDx: 0,
    pendingDy: 0,
    startX: 0,
    startY: 0,
  });

  useEffect(() => {
    if (!isFocused) return;
    setBrowserConnected(browserConnected);
  }, [browserConnected, isFocused, setBrowserConnected]);

  const sendViewportWheel = useCallback(
    (locationX: number, locationY: number, deltaX: number, deltaY: number) => {
      if (!canSendViewportInput) return;
      const inputPoint = getBrowserInputPoint({
        aspectRatio: frameAspectRatio,
        layout: viewportLayout,
        locationX,
        locationY,
      });
      if (inputPoint === null) return;

      sendBrowserCommand({
        command: 'viewport.wheel',
        deltaX: -deltaX * WHEEL_DELTA_SCALE,
        deltaY: -deltaY * WHEEL_DELTA_SCALE,
        fallbackPoint: inputPoint.fallbackPoint,
        ratio: inputPoint.ratio,
      });
    },
    [canSendViewportInput, frameAspectRatio, sendBrowserCommand, viewportLayout],
  );

  const sendViewportClick = useCallback(
    (locationX: number, locationY: number) => {
      if (!canSendViewportInput) return;
      const inputPoint = getBrowserInputPoint({
        aspectRatio: frameAspectRatio,
        layout: viewportLayout,
        locationX,
        locationY,
      });
      if (inputPoint === null) return;

      sendBrowserCommand({
        command: 'viewport.click',
        fallbackPoint: inputPoint.fallbackPoint,
        ratio: inputPoint.ratio,
      });
    },
    [canSendViewportInput, frameAspectRatio, sendBrowserCommand, viewportLayout],
  );

  const inputPanResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gestureState) =>
      canSendViewportInput &&
      (Math.abs(gestureState.dx) > TAP_DISTANCE_THRESHOLD ||
        Math.abs(gestureState.dy) > TAP_DISTANCE_THRESHOLD),
    onPanResponderGrant: (event) => {
      const { locationX, locationY } = event.nativeEvent;
      const inputGestureState = inputGestureStateRef.current;
      inputGestureState.didScroll = false;
      inputGestureState.lastSentAt = 0;
      inputGestureState.lastX = locationX;
      inputGestureState.lastY = locationY;
      inputGestureState.pendingDx = 0;
      inputGestureState.pendingDy = 0;
      inputGestureState.startX = locationX;
      inputGestureState.startY = locationY;
    },
    onPanResponderMove: (event) => {
      if (!canSendViewportInput) return;
      const { locationX, locationY } = event.nativeEvent;
      const inputGestureState = inputGestureStateRef.current;
      const deltaX = locationX - inputGestureState.lastX;
      const deltaY = locationY - inputGestureState.lastY;
      inputGestureState.lastX = locationX;
      inputGestureState.lastY = locationY;
      inputGestureState.pendingDx += deltaX;
      inputGestureState.pendingDy += deltaY;

      const totalDx = locationX - inputGestureState.startX;
      const totalDy = locationY - inputGestureState.startY;
      if (
        Math.abs(totalDx) > TAP_DISTANCE_THRESHOLD ||
        Math.abs(totalDy) > TAP_DISTANCE_THRESHOLD
      ) {
        inputGestureState.didScroll = true;
      }

      const now = Date.now();
      if (now - inputGestureState.lastSentAt < WHEEL_SEND_INTERVAL_MS) return;
      if (
        Math.abs(inputGestureState.pendingDx) < 1 &&
        Math.abs(inputGestureState.pendingDy) < 1
      ) {
        return;
      }

      sendViewportWheel(
        locationX,
        locationY,
        inputGestureState.pendingDx,
        inputGestureState.pendingDy,
      );
      inputGestureState.pendingDx = 0;
      inputGestureState.pendingDy = 0;
      inputGestureState.lastSentAt = now;
    },
    onPanResponderRelease: (event) => {
      if (!canSendViewportInput) return;
      const { locationX, locationY } = event.nativeEvent;
      const inputGestureState = inputGestureStateRef.current;
      if (inputGestureState.didScroll) {
        if (
          Math.abs(inputGestureState.pendingDx) >= 1 ||
          Math.abs(inputGestureState.pendingDy) >= 1
        ) {
          sendViewportWheel(
            locationX,
            locationY,
            inputGestureState.pendingDx,
            inputGestureState.pendingDy,
          );
        }
      } else {
        sendViewportClick(locationX, locationY);
      }
      inputGestureState.pendingDx = 0;
      inputGestureState.pendingDy = 0;
    },
    onPanResponderTerminationRequest: () => false,
    onStartShouldSetPanResponder: () => canSendViewportInput,
  });

  useEffect(() => {
    if (isAddressFocused) return;
    setAddressValue((currentValue) =>
      currentValue === activeAddressValue ? currentValue : activeAddressValue,
    );
  }, [activeAddressValue, isAddressFocused]);

  useEffect(() => {
    if (!isAddressFocused) {
      setAddressKeyboardOffset(0);
      return;
    }

    const updateKeyboardOffset = (event?: KeyboardEvent) => {
      if (event !== undefined) {
        Keyboard.scheduleLayoutAnimation(event);
      }
      setAddressKeyboardOffset(event?.endCoordinates.height ?? Keyboard.metrics()?.height ?? 0);
    };
    const resetKeyboardOffset = (event?: KeyboardEvent) => {
      if (event !== undefined) {
        Keyboard.scheduleLayoutAnimation(event);
      }
      setAddressKeyboardOffset(0);
    };

    updateKeyboardOffset();
    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', updateKeyboardOffset),
      Keyboard.addListener('keyboardDidShow', updateKeyboardOffset),
      Keyboard.addListener('keyboardWillChangeFrame', updateKeyboardOffset),
      Keyboard.addListener('keyboardDidChangeFrame', updateKeyboardOffset),
      Keyboard.addListener('keyboardWillHide', resetKeyboardOffset),
      Keyboard.addListener('keyboardDidHide', resetKeyboardOffset),
    ];

    return () => {
      for (const subscription of subscriptions) {
        subscription.remove();
      }
    };
  }, [isAddressFocused]);

  const resetBrowserKeyboardCapture = useCallback(() => {
    browserKeyboardNativeValueRef.current = '';
    browserKeyboardInputRef.current?.clear();
  }, []);

  const dismissActiveKeyboard = useCallback(() => {
    addressInputRef.current?.blur();
    browserKeyboardInputRef.current?.blur();
    Keyboard.dismiss();
    resetBrowserKeyboardCapture();
  }, [resetBrowserKeyboardCapture]);

  const disableBrowserInteraction = useCallback(() => {
    setIsBrowserInteractionEnabled(false);
    dismissActiveKeyboard();
  }, [dismissActiveKeyboard]);

  useEffect(() => {
    if (!isFocused || !canControlBrowser || isNewTab) {
      disableBrowserInteraction();
    }
  }, [canControlBrowser, disableBrowserInteraction, isFocused, isNewTab]);

  useEffect(() => {
    if (!streamConnected) {
      setIsTabsDropdownOpen(false);
    }
  }, [streamConnected]);

  useEffect(() => {
    const previousActiveTabId = previousActiveTabIdRef.current;
    previousActiveTabIdRef.current = activeBrowserTabId;
    if (
      previousActiveTabId !== null &&
      activeBrowserTabId !== null &&
      previousActiveTabId !== activeBrowserTabId
    ) {
      disableBrowserInteraction();
    }
  }, [activeBrowserTabId, disableBrowserInteraction]);

  const submitAddress = useCallback(() => {
    const nextAddress = addressValue.trim();
    if (!canControlBrowser || nextAddress.length === 0) return;
    sendBrowserCommand({ command: 'navigate', url: nextAddress });
  }, [addressValue, canControlBrowser, sendBrowserCommand]);

  const sendBrowserKeyboardKey = useCallback(
    (key: string) => {
      if (!canUseBrowserKeyboard) {
        logBrowserKeyboardDebug('send-key.skipped', {
          reason: 'keyboard_disabled',
          ...summarizeKeyboardKeyForDebug(key),
        });
        return;
      }
      const keyDown = createBrowserKeyboardInput(key, 'keyDown');
      if (keyDown === null) {
        logBrowserKeyboardDebug('send-key.skipped', {
          reason: 'unsupported_key',
          ...summarizeKeyboardKeyForDebug(key),
        });
        return;
      }

      logBrowserKeyboardDebug('send-key', summarizeKeyboardKeyForDebug(key));
      sendBrowserCommand({ command: 'viewport.key', key: keyDown });
      sendBrowserCommand({
        command: 'viewport.key',
        key: { ...keyDown, text: undefined, type: 'keyUp' },
      });
    },
    [canUseBrowserKeyboard, sendBrowserCommand],
  );

  const sendBrowserKeyboardText = useCallback(
    (text: string) => {
      if (!canUseBrowserKeyboard || text.length === 0) return;
      logBrowserKeyboardDebug('send-text', { textLength: text.length });
      sendBrowserCommand({ command: 'viewport.insertText', text });
    },
    [canUseBrowserKeyboard, sendBrowserCommand],
  );

  const handleBrowserKeyboardChangeText = useCallback(
    (value: string) => {
      const previousValue = browserKeyboardNativeValueRef.current;
      const insertedText = getInsertedKeyboardText(previousValue, value);
      logBrowserKeyboardDebug('on-change-text', {
        insertedTextLength: insertedText.length,
        previousTextLength: previousValue.length,
        textLength: value.length,
      });

      browserKeyboardNativeValueRef.current = value;
      sendBrowserKeyboardText(insertedText);
    },
    [sendBrowserKeyboardText],
  );

  const handleBrowserKeyboardKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const key = event.nativeEvent.key;
      logBrowserKeyboardDebug('on-key-press', summarizeKeyboardKeyForDebug(key));
      if (normalizeKeyboardKey(key) === 'Enter') return;
      if (isPrintableKeyboardKey(key)) {
        return;
      }
      sendBrowserKeyboardKey(key);
    },
    [sendBrowserKeyboardKey],
  );

  const handleBrowserKeyboardSubmit = useCallback(() => {
    logBrowserKeyboardDebug('on-submit', {});
    sendBrowserKeyboardKey('Enter');
  }, [sendBrowserKeyboardKey]);

  const handleBrowserKeyboardBlur = useCallback(() => {
    logBrowserKeyboardDebug('hidden-input-blur', {});
    setIsBrowserKeyboardFocused(false);
    resetBrowserKeyboardCapture();
  }, [resetBrowserKeyboardCapture]);

  const handleBrowserKeyboardFocus = useCallback(() => {
    logBrowserKeyboardDebug('hidden-input-focus', {});
    setIsBrowserKeyboardFocused(true);
  }, []);

  const handleAddressFocus = useCallback(() => {
    setIsAddressFocused(true);
    browserKeyboardInputRef.current?.blur();
    resetBrowserKeyboardCapture();
  }, [resetBrowserKeyboardCapture]);

  const handleAddressBlur = useCallback(() => {
    setIsAddressFocused(false);
  }, []);

  const openBrowserKeyboard = useCallback(() => {
    logBrowserKeyboardDebug('open-keyboard', { canUseBrowserKeyboard });
    if (!canUseBrowserKeyboard) return;
    addressInputRef.current?.blur();
    resetBrowserKeyboardCapture();
    browserKeyboardInputRef.current?.focus();
  }, [canUseBrowserKeyboard, resetBrowserKeyboardCapture]);

  const toggleBrowserInteraction = useCallback(() => {
    if (!canToggleBrowserInteraction) return;
    if (isBrowserInteractionEnabled) {
      disableBrowserInteraction();
      return;
    }

    resetBrowserKeyboardCapture();
    setIsBrowserInteractionEnabled(true);
  }, [
    canToggleBrowserInteraction,
    disableBrowserInteraction,
    isBrowserInteractionEnabled,
    resetBrowserKeyboardCapture,
  ]);

  const openTabsDropdown = useCallback(() => {
    if (!canOpenTabsDialog) return;
    tabsDropdownTriggerRef.current?.measureInWindow((x, y, width, height) => {
      setTabsDropdownFrame({ x, y, width, height });
      setIsTabsDropdownOpen(true);
    });
  }, [canOpenTabsDialog]);

  const closeTabsDropdown = useCallback(() => {
    setIsTabsDropdownOpen(false);
  }, []);

  return (
    <View style={styles.shell}>
      <View style={styles.browserWindow}>
          <View style={[styles.header, { paddingTop: insets.top }]}>
            <View style={styles.headerLeading}>
              <ChromeIconButton
                accessibilityLabel={
                  isBrowserInteractionEnabled
                    ? 'Disable browser interaction'
                    : 'Enable browser interaction'
                }
                active={isBrowserInteractionEnabled}
                disabled={!canToggleBrowserInteraction}
                onPress={toggleBrowserInteraction}>
                <HugeiconsIcon
                  icon={TouchInteraction02Icon}
                  size={22}
                  color={
                    isBrowserInteractionEnabled
                      ? ACTIVE_ICON_COLOR
                      : canToggleBrowserInteraction
                        ? ICON_COLOR
                        : DISABLED_ICON_COLOR
                  }
                  strokeWidth={2}
                />
              </ChromeIconButton>
              <ChromeIconButton
                accessibilityLabel="Reload tab"
                disabled={!canReloadTab}
                onPress={() => sendBrowserCommand({ command: 'reload' })}>
                <HugeiconsIcon
                  icon={ReloadIcon}
                  size={21}
                  color={canReloadTab ? ICON_COLOR : DISABLED_ICON_COLOR}
                  strokeWidth={2}
                />
              </ChromeIconButton>
            </View>
            <ThemedText numberOfLines={1} style={styles.headerTitle}>
              {headerTitle}
            </ThemedText>
            <View style={styles.headerActions}>
              <ChromeIconButton
                accessibilityLabel="New tab"
                disabled={!canCreateTab}
                onPress={() => sendBrowserCommand({ command: 'newTab' })}>
                <HugeiconsIcon
                  icon={Add01Icon}
                  size={21}
                  color={canCreateTab ? ICON_COLOR : DISABLED_ICON_COLOR}
                  strokeWidth={2}
                />
              </ChromeIconButton>
              <View ref={tabsDropdownTriggerRef} collapsable={false}>
                <ChromeIconButton
                  accessibilityLabel={`${tabCount} tabs`}
                  disabled={!canOpenTabsDialog}
                  onPress={openTabsDropdown}>
                  <View style={styles.tabCountIcon}>
                    <HugeiconsIcon
                      icon={SquareIcon}
                      size={23}
                      color={canOpenTabsDialog ? ICON_COLOR : DISABLED_ICON_COLOR}
                      strokeWidth={1.8}
                    />
                    <ThemedText
                      style={[
                        styles.tabCountText,
                        {
                          color: canOpenTabsDialog ? ICON_COLOR : DISABLED_ICON_COLOR,
                        },
                      ]}>
                      {tabCount > 99 ? '99' : String(tabCount)}
                    </ThemedText>
                  </View>
                </ChromeIconButton>
              </View>
            </View>
          </View>

          <View
            onLayout={(event) => {
              const next = readLayout(event);
              setViewportLayout((current) => {
                return current.height === next.height && current.width === next.width
                  ? current
                  : next;
              });
            }}
            style={styles.viewport}>
            {visibleFrameUri !== null ? (
              <>
                <Image
                  cachePolicy="none"
                  contentFit="contain"
                  source={{ uri: visibleFrameUri }}
                  style={styles.browserFrame}
                />
                <View
                  {...inputPanResponder.panHandlers}
                  pointerEvents={canSendViewportInput ? 'auto' : 'none'}
                  style={styles.browserInputLayer}
                />
              </>
            ) : streamConnected && !isNewTab ? (
              <ActivityIndicator color={MUTED_TEXT_COLOR} size="small" />
            ) : centerMessage === null ? null : (
              <ThemedText style={styles.centerText}>{centerMessage}</ThemedText>
            )}
          </View>

          {isAnyKeyboardFocused ? (
            <Pressable
              accessibilityLabel="Dismiss keyboard"
              accessibilityRole="button"
              onPress={dismissActiveKeyboard}
              style={styles.keyboardDismissLayer}
            />
          ) : null}

          <View
            style={[
              styles.footer,
              {
                paddingBottom: Math.max(insets.bottom, 8),
                transform: [{ translateY: -footerKeyboardOffset }],
              },
            ]}>
            <ChromeIconButton
              accessibilityLabel="Back"
              disabled={!canGoBack}
              onPress={() => sendBrowserCommand({ command: 'back' })}>
              <HugeiconsIcon
                icon={ArrowLeft02Icon}
                size={22}
                color={canGoBack ? ICON_COLOR : DISABLED_ICON_COLOR}
                strokeWidth={2}
              />
            </ChromeIconButton>
            <ChromeIconButton
              accessibilityLabel="Forward"
              disabled={!canGoForward}
              onPress={() => sendBrowserCommand({ command: 'forward' })}>
              <HugeiconsIcon
                icon={ArrowRight02Icon}
                size={22}
                color={canGoForward ? ICON_COLOR : DISABLED_ICON_COLOR}
                strokeWidth={2}
              />
            </ChromeIconButton>
            <TextInput
              ref={addressInputRef}
              accessibilityLabel="Address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={canControlBrowser}
              keyboardType="url"
              onBlur={handleAddressBlur}
              onChangeText={setAddressValue}
              onFocus={handleAddressFocus}
              onSubmitEditing={submitAddress}
              placeholder="Search or enter website"
              placeholderTextColor={MUTED_TEXT_COLOR}
              returnKeyType="go"
              selectTextOnFocus
              spellCheck={false}
              style={styles.addressBar}
              value={addressValue}
            />
            {isBrowserInteractionEnabled ? (
              <ChromeIconButton
                accessibilityLabel="Browser keyboard"
                disabled={!canUseBrowserKeyboard}
                onPress={openBrowserKeyboard}>
                <HugeiconsIcon
                  icon={KeyboardIcon}
                  size={22}
                  color={canUseBrowserKeyboard ? ICON_COLOR : DISABLED_ICON_COLOR}
                  strokeWidth={2}
                />
              </ChromeIconButton>
            ) : null}
          </View>
        </View>
      <TextInput
        ref={browserKeyboardInputRef}
        autoCapitalize="none"
        autoCorrect={false}
        blurOnSubmit={false}
        caretHidden
        keyboardType="default"
        onBlur={handleBrowserKeyboardBlur}
        onChangeText={handleBrowserKeyboardChangeText}
        onFocus={handleBrowserKeyboardFocus}
        onKeyPress={handleBrowserKeyboardKeyPress}
        onSubmitEditing={handleBrowserKeyboardSubmit}
        spellCheck={false}
        style={styles.hiddenKeyboardInput}
      />
      <BrowserTabsDropdown
        activeTabId={activeBrowserTabId}
        anchorFrame={tabsDropdownFrame}
        isOpen={isTabsDropdownOpen}
        tabs={tabs}
        windowHeight={windowDimensions.height}
        windowWidth={windowDimensions.width}
        onClose={closeTabsDropdown}
        onSelectTab={(tabId) => {
          sendBrowserCommand({ command: 'activateTab', tabId });
          setIsTabsDropdownOpen(false);
        }}
        onCloseTab={(tabId) => {
          sendBrowserCommand({ command: 'closeTab', tabId });
        }}
      />
    </View>
  );
}

function BrowserTabsDropdown({
  activeTabId,
  anchorFrame,
  isOpen,
  tabs,
  windowHeight,
  windowWidth,
  onClose,
  onCloseTab,
  onSelectTab,
}: {
  activeTabId: number | null;
  anchorFrame: {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  } | null;
  isOpen: boolean;
  tabs: readonly BrowserViewTab[];
  windowHeight: number;
  windowWidth: number;
  onClose: () => void;
  onCloseTab: (tabId: number) => void;
  onSelectTab: (tabId: number) => void;
}) {
  const canCloseTabs = tabs.length > 1;
  const menuHeight = Math.min(
    TABS_DROPDOWN_MAX_HEIGHT,
    tabs.length * TABS_DROPDOWN_ITEM_HEIGHT + TABS_DROPDOWN_PADDING * 2,
  );
  const menuLeft =
    anchorFrame === null
      ? TABS_DROPDOWN_MARGIN
      : Math.min(
          Math.max(
            TABS_DROPDOWN_MARGIN,
            anchorFrame.x + anchorFrame.width - TABS_DROPDOWN_WIDTH,
          ),
          windowWidth - TABS_DROPDOWN_WIDTH - TABS_DROPDOWN_MARGIN,
        );
  const preferredTop =
    anchorFrame === null
      ? TABS_DROPDOWN_MARGIN
      : anchorFrame.y + anchorFrame.height + TABS_DROPDOWN_OFFSET;
  const menuTop = Math.min(
    preferredTop,
    windowHeight - menuHeight - TABS_DROPDOWN_MARGIN,
  );

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={isOpen && anchorFrame !== null}>
      <View style={StyleSheet.absoluteFill}>
        <Pressable
          accessibilityLabel="Close tabs"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.tabsDropdown,
            {
              top: Math.max(TABS_DROPDOWN_MARGIN, menuTop),
              left: menuLeft,
              maxHeight: menuHeight,
            },
          ]}>
          <ScrollView
            contentContainerStyle={styles.tabsDropdownList}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}>
            {tabs.map((tab) => {
              const isActive = tab.active || tab.id === activeTabId;
              return (
                <Pressable
                  key={tab.id}
                  accessibilityLabel={`Switch to ${getBrowserTabTitle(tab)}`}
                  accessibilityRole="button"
                  onPress={() => onSelectTab(tab.id)}
                  style={({ pressed }) => [
                    styles.tabRow,
                    isActive && styles.tabRowActive,
                    pressed && { backgroundColor: PRESSED_COLOR },
                  ]}>
                  <View style={styles.tabRowText}>
                    <ThemedText
                      numberOfLines={1}
                      style={[
                        styles.tabRowTitle,
                        isActive && styles.tabRowTitleActive,
                      ]}>
                      {getBrowserTabTitle(tab)}
                    </ThemedText>
                    <ThemedText numberOfLines={1} style={styles.tabRowUrl}>
                      {formatBrowserUrl(tab.url) ?? 'New Tab'}
                    </ThemedText>
                  </View>
                  {canCloseTabs ? (
                    <Pressable
                      accessibilityLabel={`Close ${getBrowserTabTitle(tab)}`}
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={(event) => {
                        event.stopPropagation();
                        onCloseTab(tab.id);
                      }}
                      style={({ pressed }) => [
                        styles.tabCloseButton,
                        pressed && { backgroundColor: PRESSED_COLOR },
                      ]}>
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        size={17}
                        color={MUTED_TEXT_COLOR}
                        strokeWidth={2.2}
                      />
                    </Pressable>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ChromeIconButton({
  active = false,
  accessibilityLabel,
  children,
  disabled = false,
  onPress,
}: {
  active?: boolean;
  accessibilityLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chromeButton,
        active && !disabled && styles.chromeButtonActive,
        pressed && !disabled && { backgroundColor: PRESSED_COLOR },
      ]}>
      {children}
    </Pressable>
  );
}

function getBrowserHeaderTitle(input: {
  readonly title: string | undefined;
  readonly url: string | undefined;
}): string {
  if (input.title !== undefined && input.title.trim().length > 0) {
    return input.title;
  }
  return formatBrowserUrl(input.url) ?? 'Browser';
}

function getBrowserTabTitle(tab: BrowserViewTab): string {
  if (tab.title !== undefined && tab.title.trim().length > 0) {
    return tab.title;
  }
  return formatBrowserUrl(tab.url) ?? 'New Tab';
}

function formatBrowserUrl(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null;

  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return value;
  }
}

function isBrowserNewTab(
  url: string | undefined,
  streamReason: string | undefined,
): boolean {
  if (streamReason === 'new_tab') return true;
  if (url === undefined || url.length === 0) return true;
  return url === 'about:blank' || url === 'chrome://newtab' || url === 'chrome://newtab/';
}

function getBrowserCenterMessage(input: {
  readonly browserConnected: boolean;
  readonly frameUri: string | null;
  readonly isNewTab: boolean;
  readonly streamPresent: boolean;
}): string | null {
  if (!input.browserConnected) return 'Web Browser not connected';
  if (!input.streamPresent) return 'Connected. Stream not present';
  if (input.isNewTab) return 'New Tab';
  return null;
}

function createBrowserKeyboardInput(
  rawKey: string,
  type: 'keyDown' | 'keyUp',
): BrowserKeyboardInput | null {
  const key = normalizeKeyboardKey(rawKey);
  const descriptor = getKeyboardDescriptor(key);
  if (descriptor === null) return null;

  return {
    altKey: false,
    code: descriptor.code,
    ctrlKey: false,
    key,
    keyCode: descriptor.keyCode,
    location: 0,
    metaKey: false,
    repeat: false,
    shiftKey: false,
    text: type === 'keyDown' ? descriptor.text : undefined,
    type,
  };
}

function normalizeKeyboardKey(key: string): string {
  if (key === 'Return' || key === '\n' || key === '\r') return 'Enter';
  return key;
}

function isPrintableKeyboardKey(key: string): boolean {
  return key.length === 1 && key !== '\n' && key !== '\r';
}

function getInsertedKeyboardText(previousValue: string, value: string): string {
  if (value.length === 0) return '';

  if (value.startsWith(previousValue)) {
    return value.slice(previousValue.length);
  }

  if (previousValue.startsWith(value)) {
    return '';
  }

  return value;
}

function logBrowserKeyboardDebug(event: string, details: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.info('[browser-keyboard][mobile]', event, details);
}

function summarizeKeyboardKeyForDebug(key: string): Record<string, unknown> {
  return {
    keyName: key.length > 1 ? key : undefined,
    printable: isPrintableKeyboardKey(key),
  };
}

function getKeyboardDescriptor(
  key: string,
): { readonly code: string; readonly keyCode: number; readonly text?: string } | null {
  if (key === 'Backspace') return { code: 'Backspace', keyCode: 8 };
  if (key === 'Enter') return { code: 'Enter', keyCode: 13, text: '\r' };
  if (key === ' ') return { code: 'Space', keyCode: 32, text: ' ' };
  if (key === 'Tab') return { code: 'Tab', keyCode: 9 };
  if (key === 'Escape') return { code: 'Escape', keyCode: 27 };
  if (key.length !== 1) return null;

  const upper = key.toUpperCase();
  const keyCode = upper.charCodeAt(0);
  const code = /^[A-Z]$/.test(upper)
    ? `Key${upper}`
    : /^[0-9]$/.test(key)
      ? `Digit${key}`
      : '';

  return { code, keyCode, text: key };
}

function readLayout(event: LayoutChangeEvent): ViewportLayout {
  const { height, width } = event.nativeEvent.layout;
  return { height, width };
}

function getBrowserInputPoint(input: {
  readonly aspectRatio: number | null;
  readonly layout: ViewportLayout;
  readonly locationX: number;
  readonly locationY: number;
}): {
  readonly fallbackPoint: { readonly x: number; readonly y: number };
  readonly ratio: { readonly x: number; readonly y: number };
} | null {
  if (input.layout.width <= 0 || input.layout.height <= 0) return null;

  const frameRect = getContainedFrameRect(input.layout, input.aspectRatio);
  if (frameRect.width <= 0 || frameRect.height <= 0) return null;

  const ratio = {
    x: clamp((input.locationX - frameRect.x) / frameRect.width, 0, 1),
    y: clamp((input.locationY - frameRect.y) / frameRect.height, 0, 1),
  };

  return {
    fallbackPoint: {
      x: ratio.x * frameRect.width,
      y: ratio.y * frameRect.height,
    },
    ratio,
  };
}

function getContainedFrameRect(
  layout: ViewportLayout,
  aspectRatio: number | null,
): { readonly height: number; readonly width: number; readonly x: number; readonly y: number } {
  if (aspectRatio === null || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return { height: layout.height, width: layout.width, x: 0, y: 0 };
  }

  const layoutAspectRatio = layout.width / layout.height;
  if (layoutAspectRatio < aspectRatio) {
    const height = layout.width / aspectRatio;
    return {
      height,
      width: layout.width,
      x: 0,
      y: (layout.height - height) / 2,
    };
  }

  const width = layout.height * aspectRatio;
  return {
    height: layout.height,
    width,
    x: (layout.width - width) / 2,
    y: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: CHROME_COLOR,
  },
  browserWindow: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: CHROME_COLOR,
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DIVIDER_COLOR,
    backgroundColor: CHROME_COLOR,
  },
  headerLeading: {
    width: 84,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 4,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    paddingBottom: 9,
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: TEXT_COLOR,
  },
  headerActions: {
    width: 84,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  chromeButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  chromeButtonActive: {
    backgroundColor: ACTIVE_BUTTON_COLOR,
  },
  tabCountIcon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCountText: {
    position: 'absolute',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
  },
  viewport: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VIEWPORT_COLOR,
  },
  browserFrame: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: VIEWPORT_COLOR,
  },
  browserInputLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  keyboardDismissLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  centerText: {
    paddingHorizontal: 26,
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: MUTED_TEXT_COLOR,
  },
  footer: {
    zIndex: 2,
    elevation: 2,
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DIVIDER_COLOR,
    backgroundColor: CHROME_COLOR,
  },
  addressBar: {
    minWidth: 0,
    flex: 1,
    height: 38,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: ADDRESS_COLOR,
    color: TEXT_COLOR,
    fontSize: 13,
    fontWeight: '600',
  },
  hiddenKeyboardInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -20,
    bottom: 0,
  },
  tabsDropdown: {
    position: 'absolute',
    width: TABS_DROPDOWN_WIDTH,
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER_COLOR,
    backgroundColor: CHROME_COLOR,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 12,
  },
  tabsDropdownList: {
    padding: TABS_DROPDOWN_PADDING,
  },
  tabRow: {
    height: TABS_DROPDOWN_ITEM_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  tabRowActive: {
    backgroundColor: ACTIVE_BUTTON_COLOR,
  },
  tabRowText: {
    minWidth: 0,
    flex: 1,
  },
  tabRowTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    color: TEXT_COLOR,
  },
  tabRowTitleActive: {
    color: ACTIVE_ICON_COLOR,
  },
  tabRowUrl: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: MUTED_TEXT_COLOR,
  },
  tabCloseButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
});
