"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PromptAttachment } from "../agent/prompt-composer";
import type { AgentThreadSummary, AgentUiContext } from "../agent/types";
import type { BrowserControlStatus } from "../cloud/browser-control-bridge";
import { CapabilitiesPanel } from "../cloud/capabilities-panel";
import {
  ConnectorsWorkspaceToolbar,
  FeedbackDialog,
  FinderToolbar,
  FilesystemDesktopWorkspace,
  FilesystemLeftPaneStack,
  UploadProgressDialog,
  WorkspaceRightSidebar,
  buildFilesystemDownloadUrl,
  createInitialNavigationHistory,
  formatBytes,
  formatBrowserControlTitle,
  folderPickerAttributes,
  getBrowserRelativePath,
  getDirectoryUploadSources,
  getParentPath,
  getUploadSelectionPaths,
  isAbortError,
  isEditableKeyboardTarget,
  isFilesystemEntry,
  isInvalidInitialFilesystemPathError,
  normalizeInitialFilesystemPath,
  normalizeOpenFilePath,
  toFilesystemUploadFile,
  toListingErrorMessage,
  toOpenFileTab,
  type ActiveLeftPaneSurface,
  type BrowserScreencastState,
  type BrowserUploadSource,
  type BrowserViewportClickInput,
  type BrowserViewportKeyboardInput,
  type BrowserViewportWheelInput,
  type BrowserWindowTab,
  type DirectoryPickerWindow,
  type FeedbackSubmitState,
  type OpenFileTab,
  type UploadProgressState,
  type WorkspacePanel,
} from "../components/filesystem";
import { FilesystemClient, type FilesystemConnectionStatus } from "./filesystem-client";
import type { FilesystemEntry, FilesystemListing, FilesystemUploadFile } from "./types";

export type {
  BrowserViewportClickInput,
  BrowserViewportInputPoint,
  BrowserViewportKeyboardInput,
  BrowserViewportWheelInput,
  BrowserWindowTab,
  WorkspacePanel,
} from "../components/filesystem";

const HISTORY_LIMIT = 64;
const DEFAULT_LEFT_PANE_RATIO = 0.5;
const MIN_PANE_RATIO = 0.25;
const MAX_PANE_RATIO = 0.75;
const LEFT_PANE_RATIO_STORAGE_KEY = "filesystem-explorer:left-pane-ratio";
const RIGHT_SIDEBAR_OPEN_STORAGE_KEY = "filesystem-explorer:right-sidebar-open";
const clampPaneRatio = (ratio: number): number =>
  Math.min(MAX_PANE_RATIO, Math.max(MIN_PANE_RATIO, ratio));

const getInitialLeftPaneRatio = (): number => {
  if (typeof window === "undefined") {
    return DEFAULT_LEFT_PANE_RATIO;
  }

  const stored = Number.parseFloat(window.localStorage.getItem(LEFT_PANE_RATIO_STORAGE_KEY) ?? "");

  return Number.isFinite(stored) ? clampPaneRatio(stored) : DEFAULT_LEFT_PANE_RATIO;
};

const getInitialRightSidebarOpen = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(RIGHT_SIDEBAR_OPEN_STORAGE_KEY) === "true";
};

export interface FilesystemExplorerProps {
  readonly websocketUrl?: string;
  readonly filesystemPreviewBaseUrl?: string;
  readonly agentBaseUrl?: string;
  readonly feedbackUrl?: string;
  readonly sarvamApiKey?: string;
  readonly browserControlStatus?: BrowserControlStatus;
  readonly browserWindowError?: string | null;
  readonly browserWindowId?: number | null;
  readonly browserWindowTabs?: BrowserWindowTab[];
  readonly browserCanGoBack?: boolean;
  readonly browserCanGoForward?: boolean;
  readonly browserScreencastAspectRatio?: number | null;
  readonly browserScreencastFrameUrl?: string | null;
  readonly browserScreencastState?: BrowserScreencastState;
  readonly browserScreencastTabId?: number | null;
  readonly isBrowserWindowOpening?: boolean;
  readonly capabilitiesBaseUrl?: string;
  readonly selectedThreadId?: string | null;
  readonly workspacePanel?: WorkspacePanel;
  readonly initialPath?: string;
  readonly machineName?: string;
  readonly canSleepMachine?: boolean;
  readonly onFilesystemOpen?: () => void;
  readonly onOpenBrowser?: () => Promise<number | null> | number | null;
  readonly onCloseBrowser?: () => Promise<void> | void;
  readonly onSelectBrowserTab?: (tabId: number) => Promise<void> | void;
  readonly onCloseBrowserTab?: (tabId: number) => Promise<void> | void;
  readonly onNewBrowserTab?: () => Promise<void> | void;
  readonly onBrowserBack?: () => Promise<void> | void;
  readonly onBrowserForward?: () => Promise<void> | void;
  readonly onBrowserGoTo?: (url: string) => Promise<void> | void;
  readonly onBrowserRefresh?: () => Promise<void> | void;
  readonly onBrowserViewportClick?: (input: BrowserViewportClickInput) => Promise<void> | void;
  readonly onBrowserViewportKey?: (input: BrowserViewportKeyboardInput) => Promise<void> | void;
  readonly onBrowserViewportWheel?: (input: BrowserViewportWheelInput) => Promise<void> | void;
  readonly onPathChange?: (path: string) => void;
  readonly onInitialPathInvalid?: (path: string) => void;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
  readonly onNewThread?: () => void;
  readonly onOpenConnectors?: () => void;
  readonly onCloseConnectors?: () => void;
  readonly onThreadResolved?: (threadId: string) => void;
  readonly onBackToMachines?: () => void;
  readonly onSleepMachine?: () => Promise<void>;
}

export function FilesystemExplorer({
  websocketUrl = "ws://localhost:4000/filesystem",
  filesystemPreviewBaseUrl,
  agentBaseUrl = "http://localhost:4000/agent",
  feedbackUrl,
  sarvamApiKey,
  browserControlStatus,
  browserWindowError = null,
  browserWindowId = null,
  browserWindowTabs = [],
  browserCanGoBack = false,
  browserCanGoForward = false,
  browserScreencastAspectRatio = null,
  browserScreencastFrameUrl = null,
  browserScreencastState = "idle",
  browserScreencastTabId = null,
  isBrowserWindowOpening = false,
  capabilitiesBaseUrl,
  selectedThreadId = null,
  workspacePanel,
  initialPath,
  machineName = "Machine",
  canSleepMachine = true,
  onFilesystemOpen,
  onOpenBrowser,
  onCloseBrowser,
  onSelectBrowserTab,
  onCloseBrowserTab,
  onNewBrowserTab,
  onBrowserBack,
  onBrowserForward,
  onBrowserGoTo,
  onBrowserRefresh,
  onBrowserViewportClick,
  onBrowserViewportKey,
  onBrowserViewportWheel,
  onPathChange,
  onInitialPathInvalid,
  onSelectThread,
  onNewThread,
  onOpenConnectors,
  onCloseConnectors,
  onThreadResolved,
  onBackToMachines,
  onSleepMachine,
}: FilesystemExplorerProps): React.ReactElement {
  const clientRef = useRef<FilesystemClient | null>(null);
  const uploadFilesInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFolderInputRef = useRef<HTMLInputElement | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [leftPaneRatio, setLeftPaneRatio] = useState(getInitialLeftPaneRatio);
  const [listing, setListing] = useState<FilesystemListing | null>(null);
  const [listingError, setListingError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(null);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(getInitialRightSidebarOpen);
  const [isRightWorkAreaOpen, setIsRightWorkAreaOpen] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [isFeedbackDialogOpen, setIsFeedbackDialogOpen] = useState(false);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSubmitState, setFeedbackSubmitState] = useState<FeedbackSubmitState>({ status: "idle" });
  const [openFileTabs, setOpenFileTabs] = useState<OpenFileTab[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [activeLeftPaneSurface, setActiveLeftPaneSurface] = useState<ActiveLeftPaneSurface>("directory");
  const [connectionStatus, setConnectionStatus] = useState<FilesystemConnectionStatus>("connecting");
  const [internalWorkspacePanel, setInternalWorkspacePanel] = useState<WorkspacePanel>("chat");
  const [sharedPromptDraft, setSharedPromptDraft] = useState("");
  const [sharedPromptAttachments, setSharedPromptAttachments] = useState<PromptAttachment[]>([]);
  const activeWorkspacePanel = workspacePanel ?? internalWorkspacePanel;
  const currentPath = listing?.path ?? "";
  const currentDirectoryName = listing?.name ?? "workspace";
  const isRightAgentAreaOpen = activeWorkspacePanel === "chat" && isRightWorkAreaOpen;
  const activeFileTab = activeLeftPaneSurface !== "file" || activeFilePath === null
    ? null
    : openFileTabs.find((tab) => tab.path === activeFilePath) ?? null;
  const openFileWatchKey = useMemo(
    () => openFileTabs.map((tab) => tab.path).sort((left, right) => left.localeCompare(right)).join("\0"),
    [openFileTabs],
  );
  const agentUiContext = useMemo<AgentUiContext>(() => ({
    openFiles: [
      ...openFileTabs.map((tab) => ({
        path: tab.path,
        isFocused: activeLeftPaneSurface === "file" && tab.path === activeFilePath,
      })),
      ...(browserWindowId === null
        ? []
        : [{
            path: "chrome",
            isFocused: activeLeftPaneSurface === "browser",
          }]),
    ],
  }), [activeFilePath, activeLeftPaneSurface, browserWindowId, openFileTabs]);
  const onFilesystemOpenRef = useRef(onFilesystemOpen);
  const onPathChangeRef = useRef(onPathChange);
  const onInitialPathInvalidRef = useRef(onInitialPathInvalid);

  useEffect(() => {
    onFilesystemOpenRef.current = onFilesystemOpen;
    onPathChangeRef.current = onPathChange;
    onInitialPathInvalidRef.current = onInitialPathInvalid;
  }, [onFilesystemOpen, onInitialPathInvalid, onPathChange]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_SIDEBAR_OPEN_STORAGE_KEY, isRightSidebarOpen ? "true" : "false");
  }, [isRightSidebarOpen]);

  useEffect(() => {
    if (browserWindowId === null) {
      setActiveLeftPaneSurface((currentSurface) => currentSurface === "browser" ? "directory" : currentSurface);
    }
  }, [browserWindowId]);

  useEffect(() => {
    if (activeLeftPaneSurface !== "file" || activeFilePath === null || openFileTabs.length < 2) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight") ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      const activeIndex = openFileTabs.findIndex((tab) => tab.path === activeFilePath);

      if (activeIndex < 0) {
        return;
      }

      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (activeIndex + direction + openFileTabs.length) % openFileTabs.length;
      setActiveFilePath(openFileTabs[nextIndex]?.path ?? activeFilePath);
      setActiveLeftPaneSurface("file");
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeFilePath, activeLeftPaneSurface, openFileTabs]);

  useEffect(() => {
    const initialPathForConnection = normalizeInitialFilesystemPath(initialPath);
    let hasReceivedListing = false;
    let didRetryInitialPath = false;
    const client = new FilesystemClient(websocketUrl, {
      initialPath: initialPathForConnection,
      onListing: (nextListing) => {
        const isInitialListing = !hasReceivedListing;
        hasReceivedListing = true;
        setListing(nextListing);
        if (isInitialListing) {
          const initialHistory = createInitialNavigationHistory(nextListing.path);
          setHistory(initialHistory);
          setHistoryIndex(initialHistory.length - 1);
        }
        onPathChangeRef.current?.(nextListing.path);
      },
      onViewState: (viewState) => {
        setOpenFileTabs(viewState.openFiles.map(toOpenFileTab));
        setActiveFilePath(null);
        setActiveLeftPaneSurface("directory");
      },
      onLoading: setIsFetching,
      onError: (message) => {
        setListingError(toListingErrorMessage(message));

        if (
          message === null ||
          hasReceivedListing ||
          didRetryInitialPath ||
          initialPathForConnection === undefined ||
          initialPathForConnection.length === 0 ||
          !isInvalidInitialFilesystemPathError(message)
        ) {
          return;
        }

        didRetryInitialPath = true;
        onInitialPathInvalidRef.current?.(initialPathForConnection);
        void clientRef.current?.subscribe("").catch((error) => {
          setListingError(toListingErrorMessage(error instanceof Error ? error.message : "Failed to load folder."));
          setIsFetching(false);
        });
      },
      onOpen: () => {
        setConnectionStatus("alive");
        onFilesystemOpenRef.current?.();
      },
      onConnectionStatus: setConnectionStatus,
    });

    setHistory([]);
    setHistoryIndex(-1);
    setSelectedPaths([]);
    setListing(null);
    setListingError(null);
    setIsFetching(true);
    setRenamingPath(null);
    setSelectionAnchorPath(null);
    setOpenFileTabs([]);
    setActiveFilePath(null);
    setActiveLeftPaneSurface("directory");
    setConnectionStatus("connecting");
    clientRef.current = client;
    client.connect();

    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [initialPath, websocketUrl]);

  useEffect(() => {
    const paths = openFileWatchKey.length === 0 ? [] : openFileWatchKey.split("\0");

    void clientRef.current?.setOpenFiles(paths).catch((error) => {
      setListingError(toListingErrorMessage(error instanceof Error ? error.message : "Failed to remember open files."));
    });
  }, [openFileWatchKey]);

  const handleLeftPaneRatioChange = useCallback((ratio: number): void => {
    const nextRatio = clampPaneRatio(ratio);

    setLeftPaneRatio(nextRatio);
    window.localStorage.setItem(LEFT_PANE_RATIO_STORAGE_KEY, String(nextRatio));
  }, []);

  const showChatPanel = useCallback((): void => {
    setInternalWorkspacePanel("chat");
  }, []);

  const showConnectorsPanel = useCallback((): void => {
    setInternalWorkspacePanel("connectors");
    onOpenConnectors?.();
  }, [onOpenConnectors]);

  const closeConnectorsPanel = useCallback((): void => {
    setInternalWorkspacePanel("chat");
    onCloseConnectors?.();
  }, [onCloseConnectors]);

  const handleToggleRightWorkArea = useCallback((): void => {
    setIsRightWorkAreaOpen((current) => !current);
  }, []);

  const handleToggleRightSidebar = useCallback((): void => {
    setIsRightSidebarOpen((current) => {
      const nextIsOpen = !current;

      if (nextIsOpen) {
        setIsRightWorkAreaOpen(true);
      }

      return nextIsOpen;
    });
  }, []);

  const handleNewThread = useCallback((): void => {
    showChatPanel();
    onNewThread?.();
  }, [onNewThread, showChatPanel]);

  const openFeedbackDialog = useCallback((): void => {
    setFeedbackSubmitState({ status: "idle" });
    setIsFeedbackDialogOpen(true);
  }, []);

  const closeFeedbackDialog = useCallback((): void => {
    if (feedbackSubmitState.status === "submitting") {
      return;
    }

    setIsFeedbackDialogOpen(false);
    setFeedbackSubmitState({ status: "idle" });
  }, [feedbackSubmitState.status]);

  const submitFeedback = useCallback(async (): Promise<void> => {
    if (feedbackUrl === undefined) {
      dispatchToast({ type: "error", message: "Feedback is not available for this workspace." });
      return;
    }

    const comment = feedbackComment.trim();

    if (comment.length === 0) {
      dispatchToast({ type: "error", message: "Add a comment before sending feedback." });
      return;
    }

    setFeedbackSubmitState({ status: "submitting" });

    try {
      const response = await fetch(feedbackUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          comment,
          threadId: selectedThreadId,
          cwd: currentPath,
          clientContext: {
            source: "workspace",
            userAgent: window.navigator.userAgent,
          },
        }),
      });
      const payload = await response.json().catch(() => null) as {
        readonly feedback?: { readonly status?: string };
        readonly error?: { readonly message?: string };
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Feedback could not be sent.");
      }

      const status = payload?.feedback?.status;
      setFeedbackComment("");
      setFeedbackSubmitState({ status: "idle" });
      setIsFeedbackDialogOpen(false);
      dispatchToast({
        type: "success",
        message: status === "complete" ? "Feedback sent" : "Feedback saved",
        description: status === "complete"
          ? "A session snapshot was attached."
          : "The machine snapshot was unavailable, so only the comment was saved.",
      });
    } catch (error) {
      setFeedbackSubmitState({ status: "idle" });
      dispatchToast({
        type: "error",
        message: error instanceof Error ? error.message : "Feedback could not be sent.",
      });
    }
  }, [currentPath, feedbackComment, feedbackUrl, selectedThreadId]);

  const handleSelectThread = useCallback((thread: AgentThreadSummary): void => {
    showChatPanel();
    onSelectThread?.(thread);
  }, [onSelectThread, showChatPanel]);

  const handleShowBrowser = useCallback((): void => {
    if (browserWindowId !== null) {
      setActiveLeftPaneSurface("browser");
      return;
    }

    void Promise.resolve(onOpenBrowser?.() ?? null).then((openedWindowId) => {
      if (openedWindowId !== null) {
        setActiveLeftPaneSurface("browser");
      }
    }).catch(() => {
      // The workspace-level browser opener owns the user-visible error state.
    });
  }, [browserWindowId, onOpenBrowser]);

  const handleCloseBrowser = useCallback((): void => {
    void Promise.resolve(onCloseBrowser?.()).catch(() => {
      // The workspace-level browser closer owns the user-visible error state.
    });
    setActiveLeftPaneSurface((currentSurface) => currentSurface === "browser" ? "directory" : currentSurface);
  }, [onCloseBrowser]);

  const subscribeTo = useCallback(async (
    nextPath: string,
    shouldPushHistory: boolean,
  ): Promise<FilesystemListing | undefined> => {
    setIsFetching(true);
    setListingError(null);
    setActiveFilePath(null);
    setActiveLeftPaneSurface("directory");
    const nextListing = await clientRef.current?.subscribe(nextPath);
    setSelectedPaths([]);
    setSelectionAnchorPath(null);
    setRenamingPath(null);

    if (!shouldPushHistory) {
      return nextListing;
    }

    setHistory((previous) => {
      const trimmed =
        historyIndex >= 0
          ? previous.slice(0, historyIndex + 1)
          : listing === null
            ? []
            : [currentPath];

      if (trimmed[trimmed.length - 1] === nextPath) {
        setHistoryIndex(trimmed.length - 1);
        return trimmed;
      }

      const next = [...trimmed, nextPath];
      const overflow = Math.max(0, next.length - HISTORY_LIMIT);
      const bounded = next.slice(overflow);
      setHistoryIndex(bounded.length - 1);

      return bounded;
    });
    return nextListing;
  }, [currentPath, historyIndex, listing]);

  const navigateTo = useCallback(
    (nextPath: string) => {
      void subscribeTo(nextPath, true).catch((error) => {
        setListingError(toListingErrorMessage(error instanceof Error ? error.message : "Failed to load folder."));
        setIsFetching(false);
      });
    },
    [subscribeTo],
  );

  const openFileTab = useCallback((entry: FilesystemEntry): void => {
    if (entry.type !== "file") {
      return;
    }

    setOpenFileTabs((currentTabs) => {
      if (currentTabs.some((tab) => tab.path === entry.path)) {
        return currentTabs.map((tab) => (
          tab.path === entry.path ? toOpenFileTab(entry) : tab
        ));
      }

      return [...currentTabs, toOpenFileTab(entry)];
    });
    setActiveFilePath(entry.path);
    setActiveLeftPaneSurface("file");
  }, []);

  const openFilePath = useCallback((path: string): void => {
    const normalizedPath = normalizeOpenFilePath(path);

    if (normalizedPath === null) {
      return;
    }

    const openUnknownFileTab = (): void => {
      const tab: OpenFileTab = {
        name: normalizedPath.split("/").filter(Boolean).at(-1) ?? normalizedPath,
        path: normalizedPath,
        size: null,
        updatedAt: new Date().toISOString(),
      };

      setOpenFileTabs((currentTabs) => {
        if (currentTabs.some((currentTab) => currentTab.path === tab.path)) {
          return currentTabs;
        }

        return [...currentTabs, tab];
      });
      setActiveFilePath(tab.path);
      setActiveLeftPaneSurface("file");
    };

    const openResolvedEntry = (entry: FilesystemEntry): void => {
      if (entry.type === "directory") {
        navigateTo(entry.path);
        return;
      }

      openFileTab(entry);
    };

    if (normalizedPath.length === 0) {
      navigateTo("");
      return;
    }

    const visibleEntry = listing?.entries.find((entry) => entry.path === normalizedPath);
    if (visibleEntry !== undefined) {
      openResolvedEntry(visibleEntry);
      return;
    }

    const parentPath = getParentPath(normalizedPath);
    void (async () => {
      const parentListing =
        listing?.path === parentPath
          ? listing
          : await subscribeTo(parentPath, true);
      const targetEntry = parentListing?.entries.find((entry) => entry.path === normalizedPath);

      if (targetEntry !== undefined) {
        openResolvedEntry(targetEntry);
        return;
      }

      openUnknownFileTab();
    })().catch((error) => {
      setListingError(toListingErrorMessage(error instanceof Error ? error.message : "Failed to open item."));
      setIsFetching(false);
    });
  }, [listing, navigateTo, openFileTab, subscribeTo]);

  const closeFileTab = useCallback((path: string): void => {
    setOpenFileTabs((currentTabs) => {
      const closedIndex = currentTabs.findIndex((tab) => tab.path === path);

      if (closedIndex < 0) {
        return currentTabs;
      }

      const nextTabs = currentTabs.filter((tab) => tab.path !== path);
      setActiveFilePath((currentActivePath) => {
        if (currentActivePath !== path) {
          return currentActivePath;
        }

        const nextActivePath = nextTabs[closedIndex]?.path ?? nextTabs[closedIndex - 1]?.path ?? null;
        setActiveLeftPaneSurface((currentSurface) => (
          currentSurface === "file" ? (nextActivePath === null ? "directory" : "file") : currentSurface
        ));
        return nextActivePath;
      });

      return nextTabs;
    });
  }, []);

  const handleEntryDoubleClick = useCallback(
    (entry: FilesystemEntry) => {
      if (entry.type === "directory") {
        navigateTo(entry.path);
        return;
      }

      openFileTab(entry);
    },
    [navigateTo, openFileTab],
  );

  const showEntryInfo = useCallback((entry: FilesystemEntry): void => {
    const size = entry.size === null ? "Folder" : formatBytes(entry.size);
    const updatedAt = new Date(entry.updatedAt);
    const modified = Number.isNaN(updatedAt.getTime()) ? entry.updatedAt : updatedAt.toLocaleString();

    window.alert([
      `Name: ${entry.name}`,
      `Kind: ${entry.type === "directory" ? "Folder" : "File"}`,
      `Path: ${entry.path || "/"}`,
      `Size: ${size}`,
      `Modified: ${modified}`,
    ].join("\n"));
  }, []);

  const onBack = useCallback(() => {
    if (historyIndex <= 0) {
      return;
    }

    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    void subscribeTo(history[nextIndex] ?? "", false).catch((error) => {
      setListingError(toListingErrorMessage(error instanceof Error ? error.message : "Failed to load folder."));
      setIsFetching(false);
    });
  }, [history, historyIndex, subscribeTo]);

  const onForward = useCallback(() => {
    if (historyIndex >= history.length - 1) {
      return;
    }

    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    void subscribeTo(history[nextIndex] ?? "", false).catch((error) => {
      setListingError(toListingErrorMessage(error instanceof Error ? error.message : "Failed to load folder."));
      setIsFetching(false);
    });
  }, [history, historyIndex, subscribeTo]);

  const createNewFolder = useCallback(async (): Promise<void> => {
    try {
      const result = await clientRef.current?.createFolder(currentPath);
      const entry = isFilesystemEntry(result) ? result : null;

      if (entry !== null) {
        setSelectedPaths([entry.path]);
        setSelectionAnchorPath(entry.path);
        setRenamingPath(entry.path);
      }
    } catch (error) {
      setListingError(toListingErrorMessage(error instanceof Error ? error.message : "Failed to create folder."));
    }
  }, [currentPath]);

  const commitRename = useCallback(async (entry: FilesystemEntry, nextName: string): Promise<void> => {
    const cleanName = nextName.trim();

    if (cleanName.length === 0 || cleanName === entry.name) {
      setRenamingPath(null);
      return;
    }

    try {
      const result = await clientRef.current?.rename(entry.path, cleanName);
      const renamed = isFilesystemEntry(result) ? result : null;
      setSelectedPaths([renamed?.path ?? entry.path]);
      setSelectionAnchorPath(renamed?.path ?? entry.path);
      setRenamingPath(null);

      if (entry.type === "file" && renamed?.type === "file") {
        setOpenFileTabs((currentTabs) => currentTabs.map((tab) => (
          tab.path === entry.path ? toOpenFileTab(renamed) : tab
        )));
        setActiveFilePath((currentActivePath) => currentActivePath === entry.path ? renamed.path : currentActivePath);
      }
    } catch (error) {
      setListingError(toListingErrorMessage(error instanceof Error ? error.message : "Failed to rename item."));
    }
  }, []);

  const moveEntryToTrash = useCallback(async (entriesToTrash: readonly FilesystemEntry[]): Promise<void> => {
    const pathsToTrash = entriesToTrash.map((entry) => entry.path);

    if (pathsToTrash.length === 0) {
      return;
    }

    try {
      await clientRef.current?.trash(pathsToTrash);
      setSelectedPaths((currentPaths) => currentPaths.filter((path) => !pathsToTrash.includes(path)));
      setSelectionAnchorPath((currentAnchorPath) =>
        currentAnchorPath !== null && pathsToTrash.includes(currentAnchorPath) ? null : currentAnchorPath,
      );
      setRenamingPath((currentRenamingPath) =>
        currentRenamingPath !== null && pathsToTrash.includes(currentRenamingPath) ? null : currentRenamingPath,
      );
      setOpenFileTabs((currentTabs) => currentTabs.filter((tab) => !pathsToTrash.includes(tab.path)));
      setActiveFilePath((currentActivePath) =>
        {
          if (currentActivePath === null || !pathsToTrash.includes(currentActivePath)) {
            return currentActivePath;
          }

          setActiveLeftPaneSurface((currentSurface) => (
            currentSurface === "file" ? "directory" : currentSurface
          ));
          return null;
        },
      );
    } catch (error) {
      setListingError(toListingErrorMessage(error instanceof Error ? error.message : "Failed to move items to Trash."));
    }
  }, []);

  const downloadEntries = useCallback((entriesToDownload: readonly FilesystemEntry[]): void => {
    if (entriesToDownload.length === 0) {
      return;
    }

    try {
      const downloadUrl = buildFilesystemDownloadUrl(websocketUrl, entriesToDownload.map((entry) => entry.path));
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = entriesToDownload.length === 1 ? entriesToDownload[0]?.name ?? "" : "download.zip";
      document.body.append(link);
      link.click();
      link.remove();
    } catch (error) {
      setListingError(toListingErrorMessage(error instanceof Error ? error.message : "Failed to start download."));
    }
  }, [websocketUrl]);

  const openEntry = useCallback((entry: FilesystemEntry): void => {
    if (entry.type === "directory") {
      navigateTo(entry.path);
      return;
    }

    openFileTab(entry);
  }, [navigateTo, openFileTab]);

  const uploadBrowserSources = useCallback(async (
    sources: readonly BrowserUploadSource[],
    title: string,
  ): Promise<void> => {
    if (sources.length === 0) {
      return;
    }

    try {
      setIsFetching(true);
      setListingError(null);
      const totalBytes = sources.reduce((sum, source) => sum + (source.type === "file" ? source.file.size : 0), 0);
      let completedBytes = 0;
      const uploadFiles: FilesystemUploadFile[] = [];

      setUploadProgress({
        title,
        detail: "Preparing upload...",
        completedBytes: 0,
        totalBytes,
        phase: "preparing",
      });

      for (const source of sources) {
        if (source.type === "directory") {
          uploadFiles.push({ type: "directory", relativePath: source.relativePath });
          continue;
        }

        setUploadProgress({
          title,
          detail: source.file.name,
          completedBytes,
          totalBytes,
          phase: "preparing",
        });
        uploadFiles.push(await toFilesystemUploadFile(source));
        completedBytes += source.file.size;
        setUploadProgress({
          title,
          detail: source.file.name,
          completedBytes,
          totalBytes,
          phase: "preparing",
        });
      }

      setUploadProgress({
        title,
        detail: "Sending items to the machine...",
        completedBytes: totalBytes,
        totalBytes,
        phase: "uploading",
      });
      await clientRef.current?.upload(currentPath, uploadFiles);
      const uploadedPaths = getUploadSelectionPaths(currentPath, uploadFiles);

      if (uploadedPaths.length > 0) {
        setSelectedPaths(uploadedPaths);
        setSelectionAnchorPath(uploadedPaths[0] ?? null);
      }
    } catch (error) {
      setListingError(toListingErrorMessage(error instanceof Error ? error.message : "Failed to upload items."));
      setIsFetching(false);
    } finally {
      setUploadProgress(null);
    }
  }, [currentPath]);

  const uploadBrowserFiles = useCallback(async (
    files: FileList | null,
    options: { readonly includeFolderPath: boolean },
  ): Promise<void> => {
    if (files === null || files.length === 0) {
      return;
    }

    const sources = Array.from(files).map((file): BrowserUploadSource => ({
      type: "file",
      relativePath: options.includeFolderPath ? getBrowserRelativePath(file) : file.name,
      file,
    }));

    await uploadBrowserSources(sources, options.includeFolderPath ? "Uploading folder" : "Uploading files");
  }, [uploadBrowserSources]);

  const chooseUploadFolder = useCallback((): void => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;

    if (picker === undefined) {
      uploadFolderInputRef.current?.click();
      return;
    }

    void picker({ mode: "read" })
      .then(async (directoryHandle) => {
        const sources = await getDirectoryUploadSources(directoryHandle);
        await uploadBrowserSources(sources, `Uploading ${directoryHandle.name}`);
      })
      .catch((error) => {
        if (isAbortError(error)) {
          return;
        }

        setListingError(toListingErrorMessage(error instanceof Error ? error.message : "Failed to upload folder."));
      });
  }, [uploadBrowserSources]);

  const selectEntry = useCallback(
    (entry: FilesystemEntry, event: React.MouseEvent) => {
      const entries = listing?.entries ?? [];

      if (event.shiftKey && selectionAnchorPath !== null) {
        const anchorIndex = entries.findIndex((currentEntry) => currentEntry.path === selectionAnchorPath);
        const targetIndex = entries.findIndex((currentEntry) => currentEntry.path === entry.path);

        if (anchorIndex >= 0 && targetIndex >= 0) {
          const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
          setSelectedPaths(entries.slice(start, end + 1).map((currentEntry) => currentEntry.path));
          return;
        }
      }

      if (event.metaKey || event.ctrlKey) {
        setSelectedPaths((currentPaths) =>
          currentPaths.includes(entry.path)
            ? currentPaths.filter((path) => path !== entry.path)
            : [...currentPaths, entry.path],
        );
        setSelectionAnchorPath(entry.path);
        return;
      }

      setSelectedPaths([entry.path]);
      setSelectionAnchorPath(entry.path);
    },
    [listing?.entries, selectionAnchorPath],
  );

  const rightSidebar = (
    <WorkspaceRightSidebar
      activeWorkspacePanel={activeWorkspacePanel}
      agentBaseUrl={agentBaseUrl}
      isOpen={isRightSidebarOpen}
      selectedThreadId={selectedThreadId}
      onNewThread={handleNewThread}
      onOpenConnectors={showConnectorsPanel}
      onSelectThread={handleSelectThread}
    />
  );

  if (activeWorkspacePanel === "connectors") {
    return (
      <main
        className="finder-shell"
        data-right-sidebar-open={isRightSidebarOpen ? "true" : undefined}
        data-workspace-panel="connectors"
      >
        <ConnectorsWorkspaceToolbar
          isRightSidebarOpen={isRightSidebarOpen}
          onBack={closeConnectorsPanel}
          onToggleRightSidebar={handleToggleRightSidebar}
        />
        <section className="connectors-workspace-main" aria-label="Connectors">
          <CapabilitiesPanel
            capabilitiesBaseUrl={capabilitiesBaseUrl}
            showTopbar={false}
          />
        </section>
        {rightSidebar}
      </main>
    );
  }

  return (
    <main className="finder-shell" data-right-sidebar-open={isRightSidebarOpen ? "true" : undefined}>
      <input
        ref={uploadFilesInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const input = event.currentTarget;
          void uploadBrowserFiles(input.files, { includeFolderPath: false }).finally(() => {
            input.value = "";
          });
        }}
      />
      <input
        ref={uploadFolderInputRef}
        type="file"
        multiple
        hidden
        {...folderPickerAttributes}
        onChange={(event) => {
          const input = event.currentTarget;
          void uploadBrowserFiles(input.files, { includeFolderPath: true }).finally(() => {
            input.value = "";
          });
        }}
      />
      <FinderToolbar
        canGoBack={historyIndex > 0}
        canGoForward={historyIndex >= 0 && historyIndex < history.length - 1}
        onBack={onBack}
        onForward={onForward}
        title={currentDirectoryName}
        isFetching={isFetching}
        browserTabTitle={formatBrowserControlTitle(browserControlStatus)}
        onNewThread={handleNewThread}
        onShareFeedback={feedbackUrl === undefined ? undefined : openFeedbackDialog}
        isRightSidebarOpen={isRightSidebarOpen}
        isRightWorkAreaOpen={isRightWorkAreaOpen}
        onToggleRightWorkArea={handleToggleRightWorkArea}
        onToggleRightSidebar={handleToggleRightSidebar}
        activeLeftPaneSurface={activeLeftPaneSurface}
        isBrowserTabCollapsed={browserWindowId === null}
        isBrowserWindowOpening={isBrowserWindowOpening}
        onShowBrowser={handleShowBrowser}
        onCollapseBrowser={handleCloseBrowser}
        openFileTabs={openFileTabs}
        activeFilePath={activeFileTab?.path ?? null}
        onShowDirectory={() => {
          setActiveFilePath(null);
          setActiveLeftPaneSurface("directory");
        }}
        onSelectFileTab={(path) => {
          setActiveFilePath(path);
          setActiveLeftPaneSurface("file");
        }}
        onCloseFileTab={closeFileTab}
      />

      <FilesystemDesktopWorkspace
        leftPaneRatio={leftPaneRatio}
        isRightWorkAreaOpen={isRightWorkAreaOpen}
        isRightAgentAreaOpen={isRightAgentAreaOpen}
        onLeftPaneRatioChange={handleLeftPaneRatioChange}
        agentBaseUrl={agentBaseUrl}
        sarvamApiKey={sarvamApiKey}
        selectedThreadId={selectedThreadId}
        currentPath={currentPath}
        currentDirectoryName={currentDirectoryName}
        promptDraft={sharedPromptDraft}
        promptAttachments={sharedPromptAttachments}
        workspacePanel={activeWorkspacePanel}
        capabilitiesBaseUrl={capabilitiesBaseUrl}
        uiContext={agentUiContext}
        onOpenFilePath={openFilePath}
        onPromptDraftChange={setSharedPromptDraft}
        onPromptAttachmentsChange={setSharedPromptAttachments}
        onSelectThread={handleSelectThread}
        onThreadResolved={onThreadResolved}
      >
        <FilesystemLeftPaneStack
          activeLeftPaneSurface={activeLeftPaneSurface}
          directoryError={listingError}
          isDirectoryLoading={isFetching && listing === null}
          entries={listing?.entries ?? []}
          selectedPaths={selectedPaths}
          renamingPath={renamingPath}
          onSelectEntry={selectEntry}
          onSelectionChange={(paths) => {
            setSelectedPaths(paths);
            setSelectionAnchorPath(paths[0] ?? null);
          }}
          onActivateEntry={handleEntryDoubleClick}
          onDirectoryBackgroundClick={() => {
            setSelectedPaths([]);
            setSelectionAnchorPath(null);
          }}
          onCreateNewFolder={() => void createNewFolder()}
          onUploadFiles={() => uploadFilesInputRef.current?.click()}
          onUploadFolder={chooseUploadFolder}
          onRenameStart={(entry) => {
            setSelectedPaths([entry.path]);
            setSelectionAnchorPath(entry.path);
            setRenamingPath(entry.path);
          }}
          onRenameCommit={(entry, nextName) => void commitRename(entry, nextName)}
          onRenameCancel={() => setRenamingPath(null)}
          onOpenEntry={openEntry}
          onGetEntryInfo={showEntryInfo}
          onTrashEntries={(entriesToTrash) => void moveEntryToTrash(entriesToTrash)}
          onDownloadEntries={downloadEntries}
          browserError={browserWindowError}
          isBrowserOpening={isBrowserWindowOpening}
          browserStatus={browserControlStatus}
          browserTabs={browserWindowTabs}
          browserWindowId={browserWindowId}
          browserCanGoBack={browserCanGoBack}
          browserCanGoForward={browserCanGoForward}
          browserScreencastAspectRatio={browserScreencastAspectRatio}
          browserScreencastFrameUrl={browserScreencastFrameUrl}
          browserScreencastState={browserScreencastState}
          browserScreencastTabId={browserScreencastTabId}
          onBrowserBack={onBrowserBack}
          onBrowserForward={onBrowserForward}
          onBrowserGoTo={onBrowserGoTo}
          onBrowserRefresh={onBrowserRefresh}
          onSelectBrowserTab={onSelectBrowserTab}
          onCloseBrowserTab={onCloseBrowserTab}
          onNewBrowserTab={onNewBrowserTab}
          onBrowserViewportClick={onBrowserViewportClick}
          onBrowserViewportKey={onBrowserViewportKey}
          onBrowserViewportWheel={onBrowserViewportWheel}
          openFileTabs={openFileTabs}
          activeFilePath={activeFileTab?.path ?? null}
          websocketUrl={websocketUrl}
          filesystemPreviewBaseUrl={filesystemPreviewBaseUrl}
          canSleepMachine={canSleepMachine}
          machineName={machineName}
          connectionStatus={connectionStatus}
          onBackToMachines={onBackToMachines}
          onSleepMachine={onSleepMachine}
        />
      </FilesystemDesktopWorkspace>
      {rightSidebar}
      {uploadProgress === null ? null : <UploadProgressDialog progress={uploadProgress} />}
      {isFeedbackDialogOpen ? (
        <FeedbackDialog
          comment={feedbackComment}
          currentPath={currentPath}
          selectedThreadId={selectedThreadId}
          state={feedbackSubmitState}
          onChangeComment={(value) => {
            setFeedbackComment(value);
          }}
          onClose={closeFeedbackDialog}
          onSubmit={() => void submitFeedback()}
        />
      ) : null}
    </main>
  );
}

const dispatchToast = (input: {
  readonly type: "success" | "error";
  readonly message: string;
  readonly description?: string;
}): void => {
  window.dispatchEvent(new CustomEvent("heysnap:toast", { detail: input }));
};
