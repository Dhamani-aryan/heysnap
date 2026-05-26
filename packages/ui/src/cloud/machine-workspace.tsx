"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AgentRuntimeProvider } from "../agent/agent-runtime";
import type { AgentThreadSummary } from "../agent/types";
import {
  createBrowserKeyboardEventParams,
  DEFAULT_BROWSER_WINDOW_URL,
  disconnectBrowserScreencastPort,
  executeBrowserControlExtensionCommand,
  getActiveBrowserTabId,
  getBrowserScreencastMode,
  isBrowserControlExtensionUnavailableError,
  isDebuggerAlreadyAttachedError,
  isDebuggerNotAttachedError,
  isBrowserWindowTabDebuggable,
  normalizeBrowserAddressUrl,
  readNavigationHistory,
  parseBrowserScreencastMessage,
  parseBrowserTabEventMessage,
  parseBrowserWindowTabs,
  parseChromeWindow,
  readBrowserNavigationStateFromHistory,
  readBrowserNavigationStateFromNavigationResult,
  readBrowserViewportSize,
  shouldHoldBrowserNavigationState,
  stripUndefined,
  type BrowserDebuggerCommandExecutor,
  type BrowserNavigationState,
  type BrowserScreencastState,
  type BrowserWindowTab,
} from "../components/cloud/browser-control";
import { MachineWorkspaceShell } from "../components/cloud/workspace";
import {
  FilesystemExplorer,
  type BrowserViewportClickInput,
  type BrowserViewportInputPoint,
  type BrowserViewportKeyboardInput,
  type BrowserViewportWheelInput,
} from "../filesystem/filesystem-explorer";
import {
  connectBrowserControlExtensionPort,
  sendBrowserControlExtensionCommand,
} from "./browser-control-extension";
import {
  BrowserControlBridge,
  type BrowserControlExecutor,
  type BrowserControlStatus,
} from "./browser-control-bridge";
import {
  emitClientDiagnostic,
  normalizeDiagnosticUrl,
} from "./client-diagnostics";
import type { CloudComputer } from "./cloud-client";
import { useBrowserWindowStore } from "./cloud-runtime";

export {
  executeBrowserControlExtensionCommand,
  shouldWaitForNavigationCommit,
} from "../components/cloud/browser-control";

const BROWSER_SCREENCAST_PORT_NAME = "heysnap-cdp-screencast";
const BROWSER_TAB_EVENTS_PORT_NAME = "heysnap-tab-events";
const CHROME_DEBUGGER_PROTOCOL_VERSION = "1.3";

export interface MachineWorkspaceProps {
  readonly agentBaseUrl: string;
  readonly browserControlWebSocketUrl?: string;
  readonly browserControlExtensionId?: string;
  readonly browserControlExecutor?: BrowserControlExecutor;
  readonly capabilitiesBaseUrl?: string;
  readonly computer: CloudComputer;
  readonly filesystemPreviewBaseUrl?: string;
  readonly filesystemWebsocketUrl: string;
  readonly feedbackUrl?: string;
  readonly allowModelSelection?: boolean;
  readonly sarvamApiKey?: string;
  readonly selectedThreadId?: string | null;
  readonly workspacePanel?: "chat" | "connectors";
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
  readonly onNewThread?: () => void;
  readonly onOpenConnectors?: () => void;
  readonly onCloseConnectors?: () => void;
  readonly onThreadResolved?: (threadId: string) => void;
  readonly onBackToMachines?: () => void;
  readonly onSleepMachine?: () => Promise<void>;
  readonly suppressConnectionLoader?: boolean;
}

export function MachineWorkspace({
  agentBaseUrl,
  browserControlWebSocketUrl,
  browserControlExtensionId,
  browserControlExecutor,
  capabilitiesBaseUrl,
  computer,
  filesystemPreviewBaseUrl,
  filesystemWebsocketUrl,
  feedbackUrl,
  allowModelSelection = false,
  sarvamApiKey,
  selectedThreadId = null,
  workspacePanel = "chat",
  onSelectThread,
  onNewThread,
  onOpenConnectors,
  onCloseConnectors,
  onThreadResolved,
  onBackToMachines,
  onSleepMachine,
  suppressConnectionLoader = false,
}: MachineWorkspaceProps): React.ReactElement {
  const [isFilesystemOpen, setIsFilesystemOpen] = useState(suppressConnectionLoader);
  const [browserControlStatus, setBrowserControlStatus] = useState<BrowserControlStatus>({
    state: browserControlWebSocketUrl === undefined ? "unavailable" : "checking_extension",
    label: browserControlWebSocketUrl === undefined ? "Unavailable" : "Checking",
  });
  const [isBrowserExtensionDialogOpen, setIsBrowserExtensionDialogOpen] = useState(false);
  const [browserWindowTabs, setBrowserWindowTabs] = useState<BrowserWindowTab[]>([]);
  const [browserNavigationState, setBrowserNavigationState] = useState<BrowserNavigationState>({
    tabId: null,
    canGoBack: false,
    canGoForward: false,
  });
  const [browserScreencastState, setBrowserScreencastState] = useState<BrowserScreencastState>({
    aspectRatio: null,
    frameUrl: null,
    state: "idle",
    tabId: null,
  });
  const browserWindowId = useBrowserWindowStore((state) => state.windowId);
  const isBrowserWindowHydrated = useBrowserWindowStore((state) => state.isHydrated);
  const isBrowserWindowOpening = useBrowserWindowStore((state) => state.isOpening);
  const browserWindowError = useBrowserWindowStore((state) => state.error);
  const hydrateBrowserWindowId = useBrowserWindowStore((state) => state.hydrateFromStorage);
  const setBrowserWindowId = useBrowserWindowStore((state) => state.setWindowId);
  const clearBrowserWindowId = useBrowserWindowStore((state) => state.clearWindowId);
  const setBrowserWindowOpening = useBrowserWindowStore((state) => state.setOpening);
  const setBrowserWindowError = useBrowserWindowStore((state) => state.setError);
  const openingBrowserPromiseRef = useRef<Promise<number | null> | null>(null);
  const browserWindowIdRef = useRef(browserWindowId);
  const browserWindowTabsRef = useRef<BrowserWindowTab[]>([]);
  const attachedDebuggerTabIdsRef = useRef<Set<number>>(new Set());
  const browserNavigationRequestIdRef = useRef(0);
  const browserNavigationStateHoldRef = useRef<{ readonly tabId: number; readonly until: number } | null>(null);
  const browserScreencastPortRef = useRef<ReturnType<typeof connectBrowserControlExtensionPort> | null>(null);
  const browserScreencastRequestIdRef = useRef(0);
  const hasAutoShownBrowserExtensionDialogRef = useRef(false);
  const isBrowserControlExtensionMissingRef = useRef(false);
  const previousFilesystemWebsocketUrlRef = useRef(filesystemWebsocketUrl);
  const previousBrowserControlWebsocketUrlRef = useRef(browserControlWebSocketUrl);
  const isWorkspaceReady = isFilesystemOpen;
  const activeBrowserTabId = getActiveBrowserTabId(browserWindowTabs);
  const activeBrowserTab = activeBrowserTabId === null
    ? null
    : browserWindowTabs.find((tab) => tab.id === activeBrowserTabId) ?? null;
  const activeBrowserTabUrl = activeBrowserTab?.url;
  const activeBrowserNavigationKey = activeBrowserTab === null
    ? null
    : `${activeBrowserTab.id}:${activeBrowserTab.url ?? ""}:${activeBrowserTab.status ?? ""}`;
  const activeBrowserScreencastMode = getBrowserScreencastMode(activeBrowserTabUrl);
  const activeBrowserScreencastKey = browserWindowId === null || activeBrowserTab === null
    ? null
    : `${browserWindowId}:${activeBrowserTab.id}:${activeBrowserScreencastMode}`;

  useEffect(() => {
    document.documentElement.dataset.cloudScreen = "workspace";

    return () => {
      if (document.documentElement.dataset.cloudScreen === "workspace") {
        delete document.documentElement.dataset.cloudScreen;
      }
    };
  }, []);

  useEffect(() => {
    const previousUrl = previousFilesystemWebsocketUrlRef.current;
    previousFilesystemWebsocketUrlRef.current = filesystemWebsocketUrl;

    if (previousUrl !== filesystemWebsocketUrl) {
      emitClientDiagnostic("workspace.websocket_url_changed", {
        computerId: computer.id,
        route: "filesystem",
        previousUrl: normalizeDiagnosticUrl(previousUrl),
        nextUrl: normalizeDiagnosticUrl(filesystemWebsocketUrl),
      }, { source: "machine-workspace", message: "Workspace websocket URL changed" });
    }

    if (suppressConnectionLoader) {
      setIsFilesystemOpen(true);
      return;
    }

    setIsFilesystemOpen(false);
  }, [computer.id, filesystemWebsocketUrl, suppressConnectionLoader]);

  useEffect(() => {
    const previousUrl = previousBrowserControlWebsocketUrlRef.current;
    previousBrowserControlWebsocketUrlRef.current = browserControlWebSocketUrl;

    if (previousUrl !== browserControlWebSocketUrl) {
      emitClientDiagnostic("workspace.websocket_url_changed", {
        computerId: computer.id,
        route: "browser-control",
        previousUrl: normalizeDiagnosticUrl(previousUrl),
        nextUrl: normalizeDiagnosticUrl(browserControlWebSocketUrl),
      }, { source: "machine-workspace", message: "Workspace websocket URL changed" });
    }

    hasAutoShownBrowserExtensionDialogRef.current = false;
    isBrowserControlExtensionMissingRef.current = false;
    setIsBrowserExtensionDialogOpen(false);
  }, [browserControlExtensionId, browserControlWebSocketUrl, computer.id]);

  useEffect(() => {
    if (browserControlStatus.state === "connected") {
      hasAutoShownBrowserExtensionDialogRef.current = false;
      isBrowserControlExtensionMissingRef.current = false;
      setIsBrowserExtensionDialogOpen(false);
      return;
    }

    if (
      browserControlStatus.state === "extension_unavailable"
      && !hasAutoShownBrowserExtensionDialogRef.current
    ) {
      isBrowserControlExtensionMissingRef.current = true;
      hasAutoShownBrowserExtensionDialogRef.current = true;
      setIsBrowserExtensionDialogOpen(true);
      return;
    }

    if (browserControlStatus.state === "extension_unavailable") {
      isBrowserControlExtensionMissingRef.current = true;
    }
  }, [browserControlStatus.state]);

  useEffect(() => {
    hydrateBrowserWindowId();
  }, [hydrateBrowserWindowId]);

  useEffect(() => {
    browserWindowIdRef.current = browserWindowId;

    if (browserWindowId === null) {
      setBrowserWindowTabs([]);
      attachedDebuggerTabIdsRef.current.clear();
    }
  }, [browserWindowId]);

  useEffect(() => {
    browserWindowTabsRef.current = browserWindowTabs;
    const liveTabIds = new Set(browserWindowTabs.map((tab) => tab.id));

    for (const tabId of attachedDebuggerTabIdsRef.current) {
      if (!liveTabIds.has(tabId)) {
        attachedDebuggerTabIdsRef.current.delete(tabId);
      }
    }
  }, [browserWindowTabs]);

  const executeBrowserExtensionCommand = useCallback(async (
    command: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<unknown> => {
    if (browserControlExecutor !== undefined) {
      return browserControlExecutor({ command, params: payload, signal });
    }

    const extensionId = browserControlExtensionId?.trim();
    if (extensionId === undefined || extensionId.length === 0) {
      throw new Error("Chrome extension ID is not configured.");
    }

    return sendBrowserControlExtensionCommand(extensionId, command, payload, signal);
  }, [browserControlExecutor, browserControlExtensionId]);

  const refreshBrowserWindowTabs = useCallback(async (
    windowId: number,
    signal: AbortSignal,
  ): Promise<BrowserWindowTab[]> => {
    const tabs = await executeBrowserExtensionCommand("tabs.query", { windowId }, signal);
    const parsedTabs = parseBrowserWindowTabs(tabs);

    setBrowserWindowTabs(parsedTabs);
    return parsedTabs;
  }, [executeBrowserExtensionCommand]);

  const attachDebuggerToBrowserTab = useCallback(async (
    tabId: number,
    signal: AbortSignal,
  ): Promise<void> => {
    if (attachedDebuggerTabIdsRef.current.has(tabId)) {
      return;
    }

    try {
      await executeBrowserExtensionCommand("debugger.attach", {
        tabId,
        version: CHROME_DEBUGGER_PROTOCOL_VERSION,
      }, signal);
    } catch (error) {
      if (!isDebuggerAlreadyAttachedError(error)) {
        throw error;
      }
    }

    attachedDebuggerTabIdsRef.current.add(tabId);
  }, [executeBrowserExtensionCommand]);

  const executeBrowserDebuggerCommand = useCallback<BrowserDebuggerCommandExecutor>(async ({
    method,
    params,
    signal,
    tabId,
  }) => {
    await attachDebuggerToBrowserTab(tabId, signal);

    try {
      return await executeBrowserExtensionCommand("debugger.sendCommand", stripUndefined({
        tabId,
        method,
        params,
      }), signal);
    } catch (error) {
      attachedDebuggerTabIdsRef.current.delete(tabId);

      if (!isDebuggerNotAttachedError(error)) {
        throw error;
      }

      await attachDebuggerToBrowserTab(tabId, signal);
      return executeBrowserExtensionCommand("debugger.sendCommand", stripUndefined({
        tabId,
        method,
        params,
      }), signal);
    }
  }, [attachDebuggerToBrowserTab, executeBrowserExtensionCommand]);

  const refreshBrowserNavigationState = useCallback(async (
    tabId: number,
    signal: AbortSignal,
    force = false,
  ): Promise<void> => {
    const requestId = browserNavigationRequestIdRef.current + 1;
    browserNavigationRequestIdRef.current = requestId;
    const tab = browserWindowTabsRef.current.find((candidate) => candidate.id === tabId);

    if (tab !== undefined && !isBrowserWindowTabDebuggable(tab)) {
      if (!signal.aborted && requestId === browserNavigationRequestIdRef.current && !shouldHoldBrowserNavigationState(tabId, force, browserNavigationStateHoldRef.current)) {
        setBrowserNavigationState({
          tabId,
          canGoBack: false,
          canGoForward: false,
        });
      }
      return;
    }

    const history = await executeBrowserDebuggerCommand({
      tabId,
      method: "Page.getNavigationHistory",
      signal,
    });
    const parsedHistory = readNavigationHistory(history);
    const nextState = readBrowserNavigationStateFromHistory(tabId, parsedHistory);

    if (!signal.aborted && requestId === browserNavigationRequestIdRef.current && !shouldHoldBrowserNavigationState(tabId, force, browserNavigationStateHoldRef.current)) {
      setBrowserNavigationState(nextState);
    }
  }, [executeBrowserDebuggerCommand]);

  const scheduleBrowserNavigationStateRefresh = useCallback((tabId: number): void => {
    window.setTimeout(() => {
      const abortController = new AbortController();

      void refreshBrowserNavigationState(tabId, abortController.signal, true).catch(() => undefined);
    }, 300);
  }, [refreshBrowserNavigationState]);

  const applyBrowserNavigationState = useCallback((nextState: BrowserNavigationState, holdMs = 0): void => {
    browserNavigationRequestIdRef.current += 1;
    browserNavigationStateHoldRef.current = nextState.tabId === null || holdMs <= 0
      ? null
      : {
          tabId: nextState.tabId,
          until: Date.now() + holdMs,
        };
    setBrowserNavigationState(nextState);
  }, []);

  useEffect(() => {
    if (!isBrowserWindowHydrated || browserWindowId === null || browserWindowTabs.length === 0) {
      return;
    }

    const abortController = new AbortController();

    void (async () => {
      for (const tab of browserWindowTabs) {
        if (abortController.signal.aborted) {
          return;
        }

        if (!isBrowserWindowTabDebuggable(tab)) {
          continue;
        }

        await attachDebuggerToBrowserTab(tab.id, abortController.signal).catch(() => undefined);
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [attachDebuggerToBrowserTab, browserWindowId, browserWindowTabs, isBrowserWindowHydrated]);

  useEffect(() => {
    if (browserControlExecutor !== undefined || !isBrowserWindowHydrated || browserWindowId === null) {
      return;
    }

    const extensionId = browserControlExtensionId?.trim();

    if (extensionId === undefined || extensionId.length === 0) {
      return;
    }

    let port: ReturnType<typeof connectBrowserControlExtensionPort>;

    try {
      port = connectBrowserControlExtensionPort(extensionId, BROWSER_TAB_EVENTS_PORT_NAME);
    } catch {
      return;
    }

    port.onMessage.addListener((message) => {
      const event = parseBrowserTabEventMessage(message);

      if (event === null) {
        return;
      }

      if (event.type === "windowRemoved") {
        if (event.windowId === browserWindowIdRef.current) {
          clearBrowserWindowId();
        }
        return;
      }

      if (event.windowId !== null && event.windowId !== browserWindowIdRef.current) {
        return;
      }

      setBrowserWindowTabs(event.tabs);
    });

    return () => {
      port.disconnect();
    };
  }, [
    browserControlExecutor,
    browserControlExtensionId,
    browserWindowId,
    clearBrowserWindowId,
    isBrowserWindowHydrated,
  ]);

  const stopBrowserScreencastPort = useCallback((): void => {
    const port = browserScreencastPortRef.current;

    if (port === null) {
      return;
    }

    browserScreencastPortRef.current = null;
    disconnectBrowserScreencastPort(port);
  }, []);

  useEffect(() => {
    if (
      browserControlExecutor !== undefined
      || !isBrowserWindowHydrated
      || browserWindowId === null
      || activeBrowserTab === null
    ) {
      stopBrowserScreencastPort();
      setBrowserScreencastState({
        aspectRatio: null,
        frameUrl: null,
        state: "idle",
        tabId: activeBrowserTabId,
      });
      return;
    }

    if (activeBrowserScreencastMode === "new_tab") {
      stopBrowserScreencastPort();
      setBrowserScreencastState({
        aspectRatio: null,
        frameUrl: null,
        state: "new_tab",
        tabId: activeBrowserTabId,
      });
      return;
    }

    if (activeBrowserScreencastMode !== "streamable") {
      stopBrowserScreencastPort();
      setBrowserScreencastState({
        aspectRatio: null,
        frameUrl: null,
        state: "idle",
        tabId: activeBrowserTabId,
      });
      return;
    }

    const extensionId = browserControlExtensionId?.trim();

    if (extensionId === undefined || extensionId.length === 0) {
      stopBrowserScreencastPort();
      setBrowserScreencastState({
        aspectRatio: null,
        frameUrl: null,
        state: "idle",
        tabId: activeBrowserTabId,
      });
      return;
    }

    if (activeBrowserTabId === null) {
      return;
    }

    const abortController = new AbortController();
    const requestId = browserScreencastRequestIdRef.current + 1;
    browserScreencastRequestIdRef.current = requestId;
    const tabId = activeBrowserTabId;
    const tabUrl = activeBrowserTabUrl || DEFAULT_BROWSER_WINDOW_URL;

    stopBrowserScreencastPort();
    setBrowserScreencastState({
      aspectRatio: null,
      frameUrl: null,
      state: "connecting",
      tabId,
    });

    let port: ReturnType<typeof connectBrowserControlExtensionPort>;

    try {
      port = connectBrowserControlExtensionPort(extensionId, BROWSER_SCREENCAST_PORT_NAME);
    } catch {
      setBrowserScreencastState({
        aspectRatio: null,
        frameUrl: null,
        state: "error",
        tabId,
      });
      return;
    }

    browserScreencastPortRef.current = port;

    port.onMessage.addListener((message) => {
      if (browserScreencastPortRef.current !== port || browserScreencastRequestIdRef.current !== requestId) {
        return;
      }

      const event = parseBrowserScreencastMessage(message);

      if (event === null) {
        return;
      }

      if (event.type === "started") {
        setBrowserScreencastState((current) => ({
          aspectRatio: current.tabId === tabId ? current.aspectRatio : null,
          frameUrl: current.tabId === tabId ? current.frameUrl : null,
          state: "streaming",
          tabId,
        }));
        return;
      }

      if (event.type === "frame") {
        if (event.tabId !== tabId) {
          return;
        }

        setBrowserScreencastState({
          aspectRatio: event.aspectRatio,
          frameUrl: event.dataUrl,
          state: "streaming",
          tabId,
        });
        return;
      }

      if (event.type === "stopped") {
        setBrowserScreencastState((current) => ({
          aspectRatio: current.tabId === tabId ? current.aspectRatio : null,
          frameUrl: current.tabId === tabId ? current.frameUrl : null,
          state: "stopped",
          tabId,
        }));
        return;
      }

      setBrowserScreencastState({
        aspectRatio: null,
        frameUrl: null,
        state: "error",
        tabId,
      });
    });

    port.onDisconnect.addListener(() => {
      if (browserScreencastPortRef.current !== port) {
        return;
      }

      browserScreencastPortRef.current = null;
      setBrowserScreencastState((current) => current.tabId === tabId
        ? {
            ...current,
            state: current.state === "streaming" ? "stopped" : current.state,
          }
        : current);
    });

    void (async () => {
      await executeBrowserExtensionCommand("managedWindow.remember", {
        windowId: browserWindowId,
        tabId,
        url: tabUrl,
      }, abortController.signal);

      if (abortController.signal.aborted || browserScreencastPortRef.current !== port) {
        return;
      }

      port.postMessage({
        type: "start",
        windowId: browserWindowId,
        format: "png",
        quality: 100,
        maxWidth: 1920,
        maxHeight: 1200,
        everyNthFrame: 1,
      });
    })().catch(() => {
      if (!abortController.signal.aborted && browserScreencastPortRef.current === port) {
        setBrowserScreencastState({
          aspectRatio: null,
          frameUrl: null,
          state: "error",
          tabId,
        });
      }
    });

    return () => {
      abortController.abort();

      if (browserScreencastPortRef.current === port) {
        browserScreencastPortRef.current = null;
        disconnectBrowserScreencastPort(port);
      }
    };
  }, [
    activeBrowserScreencastKey,
    activeBrowserTabId,
    activeBrowserScreencastMode,
    browserControlExecutor,
    browserControlExtensionId,
    browserWindowId,
    executeBrowserExtensionCommand,
    isBrowserWindowHydrated,
    stopBrowserScreencastPort,
  ]);

  useEffect(() => {
    if (activeBrowserTabId === null) {
      setBrowserNavigationState({
        tabId: null,
        canGoBack: false,
        canGoForward: false,
      });
      return;
    }

    const abortController = new AbortController();

    void refreshBrowserNavigationState(activeBrowserTabId, abortController.signal).catch(() => {
      if (!abortController.signal.aborted) {
        setBrowserNavigationState({
          tabId: activeBrowserTabId,
          canGoBack: false,
          canGoForward: false,
        });
      }
    });

    return () => {
      abortController.abort();
    };
  }, [activeBrowserNavigationKey, activeBrowserTabId, refreshBrowserNavigationState]);

  useEffect(() => {
    if (!isBrowserWindowHydrated || browserWindowId === null) {
      return;
    }

    const abortController = new AbortController();

    void (async () => {
      const result = await executeBrowserExtensionCommand("chrome.call", {
        api: "windows.get",
        args: [browserWindowId, { populate: true }],
      }, abortController.signal);
      const chromeWindow = parseChromeWindow(result);
      const firstTab = chromeWindow.tabs.find((tab) => tab.active === true) ?? chromeWindow.tabs[0];

      if (firstTab === undefined) {
        throw new Error("Chrome did not return a tab for the stored browser window.");
      }

      await executeBrowserExtensionCommand("managedWindow.remember", {
        windowId: chromeWindow.id,
        tabId: firstTab.id,
        url: firstTab.url || DEFAULT_BROWSER_WINDOW_URL,
      }, abortController.signal);
      setBrowserWindowTabs(chromeWindow.tabs);
    })().catch(() => {
      if (!abortController.signal.aborted) {
        clearBrowserWindowId();
      }
    });

    return () => {
      abortController.abort();
    };
  }, [browserWindowId, clearBrowserWindowId, executeBrowserExtensionCommand, isBrowserWindowHydrated]);

  useEffect(() => {
    if (!isBrowserWindowHydrated || browserWindowId === null) {
      return;
    }

    let isCancelled = false;
    let isChecking = false;
    const checkBrowserWindow = async (): Promise<void> => {
      if (isChecking) {
        return;
      }

      isChecking = true;
      const abortController = new AbortController();

      try {
        await executeBrowserExtensionCommand("chrome.call", {
          api: "windows.get",
          args: [browserWindowId],
        }, abortController.signal);
        await refreshBrowserWindowTabs(browserWindowId, abortController.signal);
      } catch {
        if (!isCancelled) {
          clearBrowserWindowId();
        }
      } finally {
        isChecking = false;
      }
    };
    const intervalId = window.setInterval(() => {
      void checkBrowserWindow();
    }, 1500);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [browserWindowId, clearBrowserWindowId, executeBrowserExtensionCommand, isBrowserWindowHydrated, refreshBrowserWindowTabs]);

  const handleFilesystemOpen = useCallback((): void => {
    setIsFilesystemOpen(true);
  }, []);

  const handleOpenBrowser = useCallback(async (): Promise<number | null> => {
    if (
      browserControlStatus.state === "extension_unavailable"
      || (
        isBrowserControlExtensionMissingRef.current
        && browserControlStatus.state !== "connected"
      )
    ) {
      setIsBrowserExtensionDialogOpen(true);
      return null;
    }

    if (browserWindowId !== null) {
      setBrowserWindowError(null);
      return browserWindowId;
    }

    if (openingBrowserPromiseRef.current !== null) {
      return openingBrowserPromiseRef.current;
    }

    const abortController = new AbortController();
    setBrowserWindowOpening(true);

    const openBrowserPromise = (async (): Promise<number | null> => {
      const result = await executeBrowserExtensionCommand("chrome.call", {
        api: "windows.create",
        args: [
          {
            url: DEFAULT_BROWSER_WINDOW_URL,
            focused: false,
            type: "normal",
            width: 1440,
            height: 900,
          },
        ],
      }, abortController.signal);
      const createdWindow = parseChromeWindow(result);
      const firstTab = createdWindow.tabs.find((tab) => tab.active === true) ?? createdWindow.tabs[0];

      if (firstTab === undefined) {
        throw new Error("Chrome did not return a first tab for the created window.");
      }

      await executeBrowserExtensionCommand("managedWindow.remember", {
        windowId: createdWindow.id,
        tabId: firstTab.id,
        url: firstTab.url || DEFAULT_BROWSER_WINDOW_URL,
      }, abortController.signal);

      browserWindowIdRef.current = createdWindow.id;
      setBrowserWindowTabs(createdWindow.tabs);
      setBrowserWindowId(createdWindow.id);
      return createdWindow.id;
    })();
    openingBrowserPromiseRef.current = openBrowserPromise;

    try {
      return await openBrowserPromise;
    } catch (error) {
      if (isBrowserControlExtensionUnavailableError(error)) {
        setIsBrowserExtensionDialogOpen(true);
      }
      setBrowserWindowError(error instanceof Error ? error.message : "Failed to create browser window.");
      return null;
    } finally {
      openingBrowserPromiseRef.current = null;
      setBrowserWindowOpening(false);
    }
  }, [
    browserControlStatus.state,
    browserWindowId,
    executeBrowserExtensionCommand,
    setBrowserWindowError,
    setBrowserWindowId,
    setBrowserWindowOpening,
  ]);

  const executeBrowserControlCommand = useCallback<BrowserControlExecutor>(async (input) => {
    if (browserControlExecutor !== undefined) {
      return browserControlExecutor(input);
    }

    if (input.command === "ping") {
      return executeBrowserExtensionCommand("ping", undefined, input.signal);
    }

    const windowId = browserWindowIdRef.current ?? await handleOpenBrowser();

    if (windowId === null) {
      throw new Error("Chrome is connected, but the browser window could not be opened.");
    }

    const result = await executeBrowserControlExtensionCommand({
      attachments: input.attachments,
      command: input.command,
      executeDebuggerCommand: executeBrowserDebuggerCommand,
      executeExtensionCommand: executeBrowserExtensionCommand,
      outputs: input.outputs,
      params: input.params,
      readAttachment: input.readAttachment,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      windowId,
      writeOutput: input.writeOutput,
    });

    await refreshBrowserWindowTabs(windowId, input.signal).catch(() => undefined);
    return result;
  }, [browserControlExecutor, executeBrowserDebuggerCommand, executeBrowserExtensionCommand, handleOpenBrowser, refreshBrowserWindowTabs]);

  const handleSelectBrowserTab = useCallback(async (tabId: number): Promise<void> => {
    const abortController = new AbortController();

    setBrowserWindowError(null);
    setBrowserWindowTabs((currentTabs) => currentTabs.map((tab) => ({
      ...tab,
      active: tab.id === tabId,
    })));

    try {
      await executeBrowserControlCommand({
        command: "tab.focus",
        params: { tabId },
        signal: abortController.signal,
      });
    } catch (error) {
      setBrowserWindowError(error instanceof Error ? error.message : "Failed to activate browser tab.");
      if (browserWindowId !== null) {
        await refreshBrowserWindowTabs(browserWindowId, abortController.signal).catch(() => undefined);
      }
    }
  }, [browserWindowId, executeBrowserControlCommand, refreshBrowserWindowTabs, setBrowserWindowError]);

  const handleCloseBrowserTab = useCallback(async (tabId: number): Promise<void> => {
    const abortController = new AbortController();

    setBrowserWindowError(null);
    setBrowserWindowTabs((currentTabs) => {
      const closedTabIndex = currentTabs.findIndex((tab) => tab.id === tabId);
      const closedTab = closedTabIndex === -1 ? undefined : currentTabs[closedTabIndex];
      const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);

      if (closedTab?.active !== true) {
        return nextTabs;
      }

      const nextActiveTab = nextTabs[closedTabIndex] ?? nextTabs[closedTabIndex - 1];

      return nextTabs.map((tab) => ({
        ...tab,
        active: tab.id === nextActiveTab?.id,
      }));
    });

    try {
      await executeBrowserControlCommand({
        command: "closeTab",
        params: { tabIds: [tabId] },
        signal: abortController.signal,
      });
    } catch (error) {
      setBrowserWindowError(error instanceof Error ? error.message : "Failed to close browser tab.");
      if (browserWindowId !== null) {
        await refreshBrowserWindowTabs(browserWindowId, abortController.signal).catch(() => undefined);
      }
    }
  }, [browserWindowId, executeBrowserControlCommand, refreshBrowserWindowTabs, setBrowserWindowError]);

  const handleNewBrowserTab = useCallback(async (): Promise<void> => {
    const abortController = new AbortController();

    setBrowserWindowError(null);

    try {
      await executeBrowserControlCommand({
        command: "createNewTab",
        params: {
          tabs: [{
            active: true,
            url: DEFAULT_BROWSER_WINDOW_URL,
          }],
        },
        signal: abortController.signal,
      });
    } catch (error) {
      setBrowserWindowError(error instanceof Error ? error.message : "Failed to open browser tab.");
      if (browserWindowId !== null) {
        await refreshBrowserWindowTabs(browserWindowId, abortController.signal).catch(() => undefined);
      }
    }
  }, [browserWindowId, executeBrowserControlCommand, refreshBrowserWindowTabs, setBrowserWindowError]);

  const handleBrowserHistoryNavigation = useCallback(async (direction: "back" | "forward"): Promise<void> => {
    const tabId = getActiveBrowserTabId(browserWindowTabs);

    if (tabId === null) {
      return;
    }

    const abortController = new AbortController();

    setBrowserWindowError(null);

    try {
      const result = await executeBrowserControlCommand({
        command: direction === "back" ? "tab.back" : "tab.forward",
        params: { tabId },
        signal: abortController.signal,
      });
      const navigationState = readBrowserNavigationStateFromNavigationResult(result, tabId);

      if (navigationState === null) {
        await refreshBrowserNavigationState(tabId, abortController.signal).catch(() => undefined);
      } else {
        applyBrowserNavigationState(navigationState, 250);
      }

      scheduleBrowserNavigationStateRefresh(tabId);
    } catch (error) {
      setBrowserWindowError(error instanceof Error ? error.message : `Failed to navigate ${direction}.`);
      if (browserWindowId !== null) {
        await refreshBrowserWindowTabs(browserWindowId, abortController.signal).catch(() => undefined);
      }
      await refreshBrowserNavigationState(tabId, abortController.signal).catch(() => undefined);
    }
  }, [
    browserWindowId,
    browserWindowTabs,
    applyBrowserNavigationState,
    executeBrowserControlCommand,
    refreshBrowserNavigationState,
    refreshBrowserWindowTabs,
    scheduleBrowserNavigationStateRefresh,
    setBrowserWindowError,
  ]);

  const handleBrowserRefresh = useCallback(async (): Promise<void> => {
    const tabId = getActiveBrowserTabId(browserWindowTabs);

    if (tabId === null) {
      return;
    }

    const abortController = new AbortController();

    setBrowserWindowError(null);

    try {
      await executeBrowserControlCommand({
        command: "tab.refresh",
        params: { tabId },
        signal: abortController.signal,
      });
      scheduleBrowserNavigationStateRefresh(tabId);
    } catch (error) {
      setBrowserWindowError(error instanceof Error ? error.message : "Failed to refresh browser tab.");
      if (browserWindowId !== null) {
        await refreshBrowserWindowTabs(browserWindowId, abortController.signal).catch(() => undefined);
      }
      await refreshBrowserNavigationState(tabId, abortController.signal).catch(() => undefined);
    }
  }, [
    browserWindowId,
    browserWindowTabs,
    executeBrowserControlCommand,
    refreshBrowserNavigationState,
    refreshBrowserWindowTabs,
    scheduleBrowserNavigationStateRefresh,
    setBrowserWindowError,
  ]);

  const handleBrowserGoTo = useCallback(async (url: string): Promise<void> => {
    const tabId = getActiveBrowserTabId(browserWindowTabs);
    const normalizedUrl = normalizeBrowserAddressUrl(url);

    if (tabId === null || normalizedUrl === null) {
      return;
    }

    const abortController = new AbortController();

    setBrowserWindowError(null);

    try {
      await executeBrowserControlCommand({
        command: "tab.goTo",
        params: {
          tabId,
          url: normalizedUrl,
        },
        signal: abortController.signal,
      });

      if (browserWindowId !== null) {
        await refreshBrowserWindowTabs(browserWindowId, abortController.signal).catch(() => undefined);
      }
      scheduleBrowserNavigationStateRefresh(tabId);
    } catch (error) {
      setBrowserWindowError(error instanceof Error ? error.message : "Failed to navigate browser tab.");
      if (browserWindowId !== null) {
        await refreshBrowserWindowTabs(browserWindowId, abortController.signal).catch(() => undefined);
      }
      await refreshBrowserNavigationState(tabId, abortController.signal).catch(() => undefined);
    }
  }, [
    browserWindowId,
    browserWindowTabs,
    executeBrowserControlCommand,
    refreshBrowserNavigationState,
    refreshBrowserWindowTabs,
    scheduleBrowserNavigationStateRefresh,
    setBrowserWindowError,
  ]);

  const resolveBrowserViewportPoint = useCallback(async (
    tabId: number,
    ratio: BrowserViewportInputPoint,
    fallbackPoint: BrowserViewportInputPoint,
    signal: AbortSignal,
  ): Promise<BrowserViewportInputPoint> => {
    try {
      const metrics = await executeBrowserDebuggerCommand({
        tabId,
        method: "Page.getLayoutMetrics",
        signal,
      });
      const viewportSize = readBrowserViewportSize(metrics);

      if (viewportSize !== null) {
        return {
          x: ratio.x * viewportSize.width,
          y: ratio.y * viewportSize.height,
        };
      }
    } catch {
      // Use the screencast frame coordinates if layout metrics are unavailable.
    }

    return fallbackPoint;
  }, [executeBrowserDebuggerCommand]);

  const handleBrowserViewportWheel = useCallback(async (input: BrowserViewportWheelInput): Promise<void> => {
    const tab = browserWindowTabsRef.current.find((candidate) => candidate.id === input.tabId);

    if (tab === undefined || tab.active !== true || !isBrowserWindowTabDebuggable(tab)) {
      return;
    }

    const abortController = new AbortController();

    try {
      const point = await resolveBrowserViewportPoint(
        input.tabId,
        input.ratio,
        input.fallbackPoint,
        abortController.signal,
      );

      await executeBrowserDebuggerCommand({
        tabId: input.tabId,
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseWheel",
          x: Math.round(point.x),
          y: Math.round(point.y),
          deltaX: Math.round(input.deltaX),
          deltaY: Math.round(input.deltaY),
        },
        signal: abortController.signal,
      });
    } catch (error) {
      setBrowserWindowError(error instanceof Error ? error.message : "Failed to scroll browser tab.");
    }
  }, [executeBrowserDebuggerCommand, resolveBrowserViewportPoint, setBrowserWindowError]);

  const handleBrowserViewportClick = useCallback(async (input: BrowserViewportClickInput): Promise<void> => {
    const tab = browserWindowTabsRef.current.find((candidate) => candidate.id === input.tabId);

    if (tab === undefined || tab.active !== true || !isBrowserWindowTabDebuggable(tab)) {
      return;
    }

    const abortController = new AbortController();

    try {
      const point = await resolveBrowserViewportPoint(
        input.tabId,
        input.ratio,
        input.fallbackPoint,
        abortController.signal,
      );
      const baseParams = {
        x: Math.round(point.x),
        y: Math.round(point.y),
        button: "left",
        clickCount: 1,
      };

      await executeBrowserDebuggerCommand({
        tabId: input.tabId,
        method: "Input.dispatchMouseEvent",
        params: {
          ...baseParams,
          type: "mousePressed",
        },
        signal: abortController.signal,
      });
      await executeBrowserDebuggerCommand({
        tabId: input.tabId,
        method: "Input.dispatchMouseEvent",
        params: {
          ...baseParams,
          type: "mouseReleased",
        },
        signal: abortController.signal,
      });
    } catch (error) {
      setBrowserWindowError(error instanceof Error ? error.message : "Failed to click browser tab.");
    }
  }, [executeBrowserDebuggerCommand, resolveBrowserViewportPoint, setBrowserWindowError]);

  const handleBrowserViewportKey = useCallback(async (input: BrowserViewportKeyboardInput): Promise<void> => {
    const tab = browserWindowTabsRef.current.find((candidate) => candidate.id === input.tabId);

    if (tab === undefined || tab.active !== true || !isBrowserWindowTabDebuggable(tab)) {
      return;
    }

    const abortController = new AbortController();

    try {
      await executeBrowserDebuggerCommand({
        tabId: input.tabId,
        method: "Input.dispatchKeyEvent",
        params: createBrowserKeyboardEventParams(input),
        signal: abortController.signal,
      });
    } catch (error) {
      setBrowserWindowError(error instanceof Error ? error.message : "Failed to type in browser tab.");
    }
  }, [executeBrowserDebuggerCommand, setBrowserWindowError]);

  const handleCloseBrowser = useCallback(async (): Promise<void> => {
    const windowIdToClose = browserWindowId;
    clearBrowserWindowId();

    if (windowIdToClose === null) {
      return;
    }

    const abortController = new AbortController();

    try {
      await executeBrowserExtensionCommand("chrome.call", {
        api: "windows.remove",
        args: [windowIdToClose],
      }, abortController.signal);
      await executeBrowserExtensionCommand("managedWindow.get", undefined, abortController.signal).catch(() => undefined);
      setBrowserWindowTabs([]);
    } catch (error) {
      setBrowserWindowError(error instanceof Error ? error.message : "Failed to close browser window.");
    }
  }, [
    browserWindowId,
    clearBrowserWindowId,
    executeBrowserExtensionCommand,
    setBrowserWindowError,
  ]);

  return (
    <MachineWorkspaceShell
      computer={computer}
      isBrowserExtensionDialogOpen={isBrowserExtensionDialogOpen}
      isWorkspaceReady={isWorkspaceReady}
      onCloseBrowserExtensionDialog={() => setIsBrowserExtensionDialogOpen(false)}
    >
      <AgentRuntimeProvider key={computer.id} agentBaseUrl={agentBaseUrl}>
        <BrowserControlBridge
          websocketUrl={browserControlWebSocketUrl}
          extensionId={browserControlExtensionId}
          executor={executeBrowserControlCommand}
          onEnsureBrowserWindow={handleOpenBrowser}
          onStatusChange={setBrowserControlStatus}
        />
        <FilesystemExplorer
          websocketUrl={filesystemWebsocketUrl}
          workspacePersistenceKey={`filesystem:${computer.id}`}
          filesystemPreviewBaseUrl={filesystemPreviewBaseUrl}
          feedbackUrl={feedbackUrl}
          allowModelSelection={allowModelSelection}
          agentBaseUrl={agentBaseUrl}
          sarvamApiKey={sarvamApiKey}
          browserControlStatus={browserControlStatus}
          browserWindowError={browserWindowError}
          browserWindowId={browserWindowId}
          browserWindowTabs={browserWindowTabs}
          browserCanGoBack={browserNavigationState.tabId === activeBrowserTabId && browserNavigationState.canGoBack}
          browserCanGoForward={browserNavigationState.tabId === activeBrowserTabId && browserNavigationState.canGoForward}
          browserScreencastAspectRatio={browserScreencastState.aspectRatio}
          browserScreencastFrameUrl={browserScreencastState.frameUrl}
          browserScreencastState={browserScreencastState.state}
          browserScreencastTabId={browserScreencastState.tabId}
          isBrowserWindowOpening={isBrowserWindowOpening}
          capabilitiesBaseUrl={capabilitiesBaseUrl}
          selectedThreadId={selectedThreadId}
          workspacePanel={workspacePanel}
          machineName={computer.name}
          canSleepMachine={computer.kind !== "local"}
          onFilesystemOpen={handleFilesystemOpen}
          onOpenBrowser={handleOpenBrowser}
          onCloseBrowser={handleCloseBrowser}
          onSelectBrowserTab={handleSelectBrowserTab}
          onCloseBrowserTab={handleCloseBrowserTab}
          onNewBrowserTab={handleNewBrowserTab}
          onBrowserBack={() => handleBrowserHistoryNavigation("back")}
          onBrowserForward={() => handleBrowserHistoryNavigation("forward")}
          onBrowserGoTo={handleBrowserGoTo}
          onBrowserRefresh={handleBrowserRefresh}
          onBrowserViewportClick={handleBrowserViewportClick}
          onBrowserViewportKey={handleBrowserViewportKey}
          onBrowserViewportWheel={handleBrowserViewportWheel}
          onSelectThread={onSelectThread}
          onNewThread={onNewThread}
          onOpenConnectors={onOpenConnectors}
          onCloseConnectors={onCloseConnectors}
          onThreadResolved={onThreadResolved}
          onBackToMachines={onBackToMachines}
          onSleepMachine={onSleepMachine}
        />
      </AgentRuntimeProvider>
    </MachineWorkspaceShell>
  );
}
