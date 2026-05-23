"use client";

import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  Cancel01Icon,
  ChatFeedbackIcon,
  Download05Icon,
  File02Icon,
  FileUploadIcon,
  FolderAddIcon,
  Folder01Icon,
  FolderUploadIcon,
  InternetIcon,
  Moon02Icon,
  PlugSocketIcon,
  PowerIcon,
  Refresh01Icon,
  Search01Icon,
  SidebarRightIcon,
  SquareArrowExpand01Icon,
  SquareArrowShrink02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { AgentPanel } from "../agent/agent-panel";
import { useAgentRunMutation, useAgentThreadGroupsQuery } from "../agent/agent-queries";
import { getAssistantMarkdown } from "../agent/agent-store";
import { RightPromptComposer, type PromptAttachment, type PromptVoiceState } from "../agent/prompt-composer";
import {
  AgentRuntimeProvider,
  useAgentChatStore,
  useAgentThreadListStore,
  useOptionalAgentRuntime,
} from "../agent/agent-runtime";
import { selectHasThreads } from "../agent/agent-thread-list-store";
import type { AgentThreadGroup, AgentThreadSummary, AgentUiContext } from "../agent/types";
import type { BrowserControlStatus } from "../cloud/browser-control-bridge";
import { CapabilitiesPanel } from "../cloud/capabilities-panel";
import docxFileIconSrc from "../../../../apps/assets/files/docx_file_icon.png";
import pdfFileIconSrc from "../../../../apps/assets/files/pdf_file_icon.png";
import xlsxFileIconSrc from "../../../../apps/assets/files/xlsx_file_icon.png";
import fileIconSrc from "./assets/macos/File.png";
import folderIconSrc from "./assets/macos/Folder.png";
import {
  buildFilesystemPreviewerUrl,
  resolveFilesystemPreviewBaseUrl,
} from "./file-preview";
import { FilesystemClient, type FilesystemConnectionStatus } from "./filesystem-client";
import type { FilesystemEntry, FilesystemListing, FilesystemUploadFile } from "./types";

const ChatMarkdown = lazy(() =>
  import("../agent/chat-markdown").then((module) => ({ default: module.ChatMarkdown })),
);

const HISTORY_LIMIT = 64;
const DEFAULT_LEFT_PANE_RATIO = 0.5;
const MIN_PANE_RATIO = 0.25;
const MAX_PANE_RATIO = 0.75;
const BROWSER_TOP_PADDING = 8;
const BROWSER_TAB_BAR_HEIGHT = 36;
const BROWSER_TOOL_BAR_HEIGHT = 40;
const BROWSER_BOTTOM_PADDING = 8;
const DEFAULT_BROWSER_STREAM_ASPECT_RATIO = 16 / 10;
const DEFAULT_BROWSER_WINDOW_URL = "chrome://newtab";
const LEFT_PANE_RATIO_STORAGE_KEY = "filesystem-explorer:left-pane-ratio";
const RIGHT_SIDEBAR_OPEN_STORAGE_KEY = "filesystem-explorer:right-sidebar-open";
const CONTEXT_MENU_WIDTH = 200;
const CONTEXT_MENU_VIEWPORT_MARGIN = 8;
const BACKGROUND_CONTEXT_MENU_HEIGHT = 148;
const ENTRY_CONTEXT_MENU_HEIGHT = 148;
const MULTI_ENTRY_CONTEXT_MENU_HEIGHT = 64;
const folderPickerAttributes = {
  webkitdirectory: "",
  directory: "",
} as React.InputHTMLAttributes<HTMLInputElement>;

type SelectionRect = {
  readonly originX: number;
  readonly originY: number;
  readonly currentX: number;
  readonly currentY: number;
};

type SelectionBox = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
};

type BrowserUploadSource =
  | {
      readonly type: "file";
      readonly relativePath: string;
      readonly file: File;
    }
  | {
      readonly type: "directory";
      readonly relativePath: string;
    };

type UploadProgressState = {
  readonly title: string;
  readonly detail: string;
  readonly completedBytes: number;
  readonly totalBytes: number;
  readonly phase: "preparing" | "uploading";
};

type OpenFileTab = {
  readonly name: string;
  readonly path: string;
  readonly size: number | null;
  readonly updatedAt: string;
};

type ActiveLeftPaneSurface = "directory" | "browser" | "file";
type FeedbackSubmitState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" };

export type BrowserWindowTab = {
  readonly id: number;
  readonly index: number;
  readonly active?: boolean;
  readonly favIconUrl?: string;
  readonly status?: string;
  readonly title?: string;
  readonly url?: string;
};

export type BrowserViewportInputPoint = {
  readonly x: number;
  readonly y: number;
};

export type BrowserViewportClickInput = {
  readonly fallbackPoint: BrowserViewportInputPoint;
  readonly ratio: BrowserViewportInputPoint;
  readonly tabId: number;
};

export type BrowserViewportKeyboardInput = {
  readonly altKey: boolean;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly keyCode: number;
  readonly location: number;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  readonly shiftKey: boolean;
  readonly tabId: number;
  readonly text?: string;
  readonly type: "keyDown" | "keyUp";
};

export type BrowserViewportWheelInput = {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly fallbackPoint: BrowserViewportInputPoint;
  readonly ratio: BrowserViewportInputPoint;
  readonly tabId: number;
};

type BrowserScreencastState = "idle" | "connecting" | "streaming" | "new_tab" | "stopped" | "error";

export type WorkspacePanel = "chat" | "connectors";

type BrowserFileSystemHandle = {
  readonly kind: "file" | "directory";
  readonly name: string;
};

type BrowserFileHandle = BrowserFileSystemHandle & {
  readonly kind: "file";
  getFile(): Promise<File>;
};

type BrowserDirectoryHandle = BrowserFileSystemHandle & {
  readonly kind: "directory";
  values(): AsyncIterable<BrowserFileSystemHandle>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { readonly mode?: "read" | "readwrite" }) => Promise<BrowserDirectoryHandle>;
};

type ContextMenuState =
  | {
      readonly kind: "background";
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "entry";
      readonly x: number;
      readonly y: number;
      readonly entry: FilesystemEntry;
    }
  | {
      readonly kind: "selection";
      readonly x: number;
      readonly y: number;
      readonly entries: FilesystemEntry[];
    };

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

const normalizeInitialFilesystemPath = (path: string | undefined): string | undefined => {
  if (path === undefined) {
    return undefined;
  }

  const normalizedPath = path.trim();
  return normalizedPath.length === 0 ? "" : normalizedPath;
};

const createInitialNavigationHistory = (path: string): string[] => {
  const segments = path.trim().split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return [];
  }

  return [
    "",
    ...segments.map((_, index) => segments.slice(0, index + 1).join("/")),
  ];
};

const isInvalidInitialFilesystemPathError = (message: string): boolean =>
  /path (?:is not a directory|not found)/iu.test(message);

const isFilesystemConnectionErrorMessage = (message: string): boolean =>
  message === "Filesystem connection failed." ||
  message === "Filesystem connection closed." ||
  message === "Filesystem connection is not open.";

const toListingErrorMessage = (message: string | null): string | null => {
  if (message === null || isFilesystemConnectionErrorMessage(message)) {
    return null;
  }

  return message;
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
    <aside className="split-right-sidebar" aria-label="Right sidebar" aria-hidden={!isRightSidebarOpen}>
      <div className="split-right-sidebar-actions">
        <RightSidebarAction
          icon={Add01Icon}
          label="New Chat"
          isActive={activeWorkspacePanel === "chat" && selectedThreadId === null}
          onClick={handleNewThread}
        />
        <RightSidebarAction icon={Search01Icon} label="Search" />
        <RightSidebarAction
          icon={PlugSocketIcon}
          label="Connectors"
          isActive={activeWorkspacePanel === "connectors"}
          onClick={showConnectorsPanel}
        />
      </div>
      <RightSidebarChats
        agentBaseUrl={agentBaseUrl}
        isOpen={isRightSidebarOpen}
        selectedThreadId={selectedThreadId}
        onSelectThread={handleSelectThread}
      />
    </aside>
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
        browserControlStatus={browserControlStatus}
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

      <DesktopSplitPane
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
        <div className="left-pane-surface-stack">
          <div
            className={activeLeftPaneSurface === "directory" ? "left-pane-surface active" : "left-pane-surface inactive"}
            aria-hidden={activeLeftPaneSurface !== "directory"}
          >
            <FinderBody
              error={listingError}
              isLoading={isFetching && listing === null}
              entries={listing?.entries ?? []}
              selectedPaths={selectedPaths}
              renamingPath={renamingPath}
              onSelect={selectEntry}
              onSelectionChange={(paths) => {
                setSelectedPaths(paths);
                setSelectionAnchorPath(paths[0] ?? null);
              }}
              onActivate={handleEntryDoubleClick}
              onBackgroundClick={() => {
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
              onGetInfo={showEntryInfo}
              onTrashEntries={(entriesToTrash) => void moveEntryToTrash(entriesToTrash)}
              onDownloadEntries={downloadEntries}
            />
          </div>
          <div
            className={activeLeftPaneSurface === "browser" ? "left-pane-surface active" : "left-pane-surface inactive"}
            aria-hidden={activeLeftPaneSurface !== "browser"}
          >
            <BrowserControlPanel
              error={browserWindowError}
              isOpening={isBrowserWindowOpening}
              status={browserControlStatus}
              tabs={browserWindowTabs}
              windowId={browserWindowId}
              canGoBack={browserCanGoBack}
              canGoForward={browserCanGoForward}
              screencastAspectRatio={browserScreencastAspectRatio}
              screencastFrameUrl={browserScreencastFrameUrl}
              screencastState={browserScreencastState}
              screencastTabId={browserScreencastTabId}
              onBack={onBrowserBack}
              onForward={onBrowserForward}
              onGoTo={onBrowserGoTo}
              onRefresh={onBrowserRefresh}
              onSelectTab={onSelectBrowserTab}
              onCloseTab={onCloseBrowserTab}
              onNewTab={onNewBrowserTab}
              onViewportClick={onBrowserViewportClick}
              onViewportKey={onBrowserViewportKey}
              onViewportWheel={onBrowserViewportWheel}
            />
          </div>
          <FileViewerStack
            openFileTabs={openFileTabs}
            activeFilePath={activeFileTab?.path ?? null}
            websocketUrl={websocketUrl}
            filesystemPreviewBaseUrl={filesystemPreviewBaseUrl}
          />
        </div>
        {activeLeftPaneSurface === "directory" ? (
          <MachineStatusControl
            canSleepMachine={canSleepMachine}
            compact={false}
            machineName={machineName}
            status={connectionStatus}
            onBack={onBackToMachines}
            onSleep={onSleepMachine}
          />
        ) : null}
      </DesktopSplitPane>
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

const UploadProgressDialog = ({
  progress,
}: {
  readonly progress: UploadProgressState;
}): React.ReactElement => {
  const percent = progress.totalBytes === 0
    ? 100
    : Math.max(0, Math.min(100, (progress.completedBytes / progress.totalBytes) * 100));

  return (
    <div className="upload-progress-backdrop" role="presentation">
      <div
        className="upload-progress-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-progress-title"
      >
        <div className="upload-progress-heading">
          <div>
            <h2 id="upload-progress-title">{progress.title}</h2>
            <p>{progress.phase === "uploading" ? "Finishing upload" : progress.detail}</p>
          </div>
          <Spinner />
        </div>
        <div
          className="upload-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="upload-progress-meta">
          <span>{Math.round(percent)}%</span>
          <span>{formatBytes(progress.completedBytes)} / {formatBytes(progress.totalBytes)}</span>
        </div>
      </div>
    </div>
  );
};

const FeedbackDialog = ({
  comment,
  currentPath,
  selectedThreadId,
  state,
  onChangeComment,
  onClose,
  onSubmit,
}: {
  readonly comment: string;
  readonly currentPath: string;
  readonly selectedThreadId: string | null;
  readonly state: FeedbackSubmitState;
  readonly onChangeComment: (value: string) => void;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
}): React.ReactElement => {
  const canSubmit = comment.trim().length > 0 && state.status !== "submitting";

  return (
    <div className="feedback-dialog-backdrop" role="presentation">
      <form
        className="feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            onSubmit();
          }
        }}
      >
        <div className="feedback-dialog-heading">
          <div>
            <h2 id="feedback-dialog-title">Share feedback</h2>
            <p>{currentPath.length === 0 ? "Workspace root" : currentPath}</p>
          </div>
          <button
            type="button"
            className="feedback-dialog-close"
            aria-label="Close feedback"
            title="Close"
            disabled={state.status === "submitting"}
            onClick={onClose}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} color="currentColor" strokeWidth={1.8} />
          </button>
        </div>
        <textarea
          className="feedback-dialog-input"
          value={comment}
          maxLength={5_000}
          autoFocus
          placeholder="What should we know?"
          aria-label="Feedback comment"
          disabled={state.status === "submitting"}
          onChange={(event) => onChangeComment(event.currentTarget.value)}
        />
        <div className="feedback-dialog-meta">
          <span>{selectedThreadId === null ? "No thread selected" : selectedThreadId}</span>
          <span>{comment.length}/5000</span>
        </div>
        <div className="feedback-dialog-actions">
          <button
            type="button"
            className="feedback-dialog-secondary"
            disabled={state.status === "submitting"}
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="submit"
            className="feedback-dialog-primary"
            disabled={!canSubmit}
          >
            {state.status === "submitting" ? "Sending" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
};

const RightSidebarAction = ({
  icon,
  isActive = false,
  label,
  onClick,
}: {
  readonly icon: IconSvgElement;
  readonly isActive?: boolean;
  readonly label: string;
  readonly onClick?: () => void;
}): React.ReactElement => (
  <button
    className={isActive ? "split-right-sidebar-action active" : "split-right-sidebar-action"}
    type="button"
    aria-pressed={isActive}
    onClick={onClick}
  >
    <HugeiconsIcon icon={icon} size={16} color="currentColor" strokeWidth={1.8} />
    <span>{label}</span>
  </button>
);

const RightSidebarChats = ({
  agentBaseUrl,
  isOpen,
  selectedThreadId,
  onSelectThread,
}: {
  readonly agentBaseUrl: string;
  readonly isOpen: boolean;
  readonly selectedThreadId: string | null;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
}): React.ReactElement => {
  const runtime = useOptionalAgentRuntime();

  if (runtime === null) {
    return (
      <AgentRuntimeProvider agentBaseUrl={agentBaseUrl}>
        <RightSidebarChats
          agentBaseUrl={agentBaseUrl}
          isOpen={isOpen}
          selectedThreadId={selectedThreadId}
          onSelectThread={onSelectThread}
        />
      </AgentRuntimeProvider>
    );
  }

  return (
    <RightSidebarChatsContent
      isOpen={isOpen}
      selectedThreadId={selectedThreadId}
      onSelectThread={onSelectThread}
    />
  );
};

const RightSidebarChatsContent = ({
  isOpen,
  selectedThreadId,
  onSelectThread,
}: {
  readonly isOpen: boolean;
  readonly selectedThreadId: string | null;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
}): React.ReactElement => {
  useAgentThreadGroupsQuery({ enabled: isOpen });
  const groups = useAgentThreadListStore((state) => state.groups);
  const isLoading = useAgentThreadListStore((state) => state.isLoading);
  const hasLoaded = useAgentThreadListStore((state) => state.hasLoaded);
  const error = useAgentThreadListStore((state) => state.error);
  const hasThreads = useAgentThreadListStore(selectHasThreads);
  const activeRun = useAgentChatStore((state) => state.activeRun);
  const activeThreadSummary = useAgentChatStore((state) => state.threadSummary);
  const activeStreamingThreadId = activeRun === null
    ? null
    : activeRun.threadId ?? activeThreadSummary?.id ?? null;

  return (
    <section className="split-right-sidebar-chats" aria-label="Chats">
      <h2>Chats</h2>
      {error !== null ? (
        <p className="split-right-sidebar-state error">{error}</p>
      ) : (!hasLoaded || isLoading) && !hasThreads ? (
        <p className="split-right-sidebar-state">Loading chats...</p>
      ) : hasThreads ? (
        <div className="split-right-sidebar-chat-groups">
          {groups.map((group) =>
            group.threads.length === 0 ? null : (
              <RightSidebarChatGroup
                key={group.path}
                group={group}
                selectedThreadId={selectedThreadId}
                activeStreamingThreadId={activeStreamingThreadId}
                onSelectThread={onSelectThread}
              />
            ),
          )}
        </div>
      ) : (
        <p className="split-right-sidebar-state">No previous chats.</p>
      )}
    </section>
  );
};

const RightSidebarChatGroup = ({
  group,
  selectedThreadId,
  activeStreamingThreadId,
  onSelectThread,
}: {
  readonly group: AgentThreadGroup;
  readonly selectedThreadId: string | null;
  readonly activeStreamingThreadId: string | null;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
}): React.ReactElement => {
  const label = group.path.trim().length === 0 ? "workspace" : group.path;
  const hasSelectedThread = group.threads.some((thread) => thread.id === selectedThreadId);
  const [isExpanded, setIsExpanded] = useState(hasSelectedThread);
  const [isShowingAll, setIsShowingAll] = useState(false);
  const visibleThreads = isShowingAll ? group.threads : group.threads.slice(0, 5);
  const canToggleVisibleThreads = group.threads.length > 5;

  useEffect(() => {
    if (hasSelectedThread) {
      setIsExpanded(true);
    }
  }, [hasSelectedThread]);

  return (
    <section className="split-right-sidebar-chat-group">
      <button
        type="button"
        className={isExpanded ? "split-right-sidebar-chat-folder expanded" : "split-right-sidebar-chat-folder"}
        title={label}
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((current) => !current)}
      >
        <HugeiconsIcon
          icon={Folder01Icon}
          size={15}
          color="currentColor"
          strokeWidth={1.8}
          className="split-right-sidebar-folder-icon"
        />
        <span>{getSidebarFolderLabel(label)}</span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={12}
          color="currentColor"
          strokeWidth={1.8}
          className="split-right-sidebar-folder-chevron"
        />
      </button>
      <div
        className={isExpanded ? "split-right-sidebar-chat-collapse open" : "split-right-sidebar-chat-collapse"}
        aria-hidden={!isExpanded}
      >
        <div className="split-right-sidebar-chat-collapse-inner">
          <div className="split-right-sidebar-chat-list">
            {visibleThreads.map((thread) => (
              <RightSidebarChatItem
                key={thread.id}
                thread={thread}
                isSelected={thread.id === selectedThreadId}
                isStreaming={thread.isStreaming === true || thread.id === activeStreamingThreadId}
                onSelectThread={onSelectThread}
              />
            ))}
            {canToggleVisibleThreads ? (
              <button
                className="split-right-sidebar-show-more"
                type="button"
                onClick={() => setIsShowingAll((current) => !current)}
                tabIndex={isExpanded ? 0 : -1}
              >
                {isShowingAll ? "Show less" : "Show more"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
};

const RightSidebarChatItem = ({
  thread,
  isSelected,
  isStreaming,
  onSelectThread,
}: {
  readonly thread: AgentThreadSummary;
  readonly isSelected: boolean;
  readonly isStreaming: boolean;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
}): React.ReactElement => {
  const updatedLabel = useMemo(() => formatSidebarChatDate(thread.updatedAt), [thread.updatedAt]);

  return (
    <button
      className={isSelected ? "split-right-sidebar-chat selected" : "split-right-sidebar-chat"}
      title={thread.title}
      type="button"
      onClick={() => onSelectThread?.(thread)}
    >
      <span className="split-right-sidebar-chat-title">{thread.title}</span>
      <span className="split-right-sidebar-chat-meta">
        {isStreaming ? (
          <span className="split-right-sidebar-chat-spinner" aria-label="Streaming" />
        ) : updatedLabel}
      </span>
    </button>
  );
};

const getSidebarFolderLabel = (path: string): string => {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? path;
};

const formatSidebarChatDate = (timestamp: number): string => {
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const elapsedMs = Date.now() - timestamp;
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60_000));

  if (elapsedMinutes < 1) {
    return "now";
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours}h`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);

  if (elapsedDays < 7) {
    return `${elapsedDays}d`;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
};

const MachineStatusControl = ({
  canSleepMachine,
  compact,
  machineName,
  status,
  onBack,
  onSleep,
}: {
  readonly canSleepMachine: boolean;
  readonly compact: boolean;
  readonly machineName: string;
  readonly status: FilesystemConnectionStatus;
  readonly onBack?: () => void;
  readonly onSleep?: () => Promise<void>;
}): React.ReactElement => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSleeping, setIsSleeping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const statusLabel = getFilesystemConnectionLabel(status);
  const isSleepDisabled = !canSleepMachine || onSleep === undefined || isSleeping;
  const isBackDisabled = onBack === undefined || isSleeping;
  const buttonClassName = [
    "machine-status-button",
    isOpen ? "active" : "",
    compact ? "icon-only" : "",
  ].filter(Boolean).join(" ");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeMenu = (event: PointerEvent): void => {
      const target = event.target;

      if (target instanceof Node && containerRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeMenu, true);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeMenu, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const sleepMachine = (): void => {
    if (isSleepDisabled || onSleep === undefined) {
      return;
    }

    setIsSleeping(true);
    setError(null);

    void onSleep()
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Failed to sleep machine.");
      })
      .finally(() => {
        setIsSleeping(false);
      });
  };

  return (
    <div ref={containerRef} className="machine-status-control">
      {isOpen ? (
        <div className="machine-status-popover" role="dialog" aria-label="Machine actions">
          <button
            type="button"
            className="machine-status-action"
            disabled={isSleepDisabled}
            title={canSleepMachine ? "Sleep machine" : "Local machines cannot be slept from here"}
            onClick={sleepMachine}
          >
            {isSleeping ? (
              <span className="machine-status-action-spinner" aria-hidden="true" />
            ) : (
              <HugeiconsIcon icon={Moon02Icon} size={17} color="currentColor" strokeWidth={1.8} />
            )}
            <span>Sleep</span>
          </button>
          <button
            type="button"
            className="machine-status-action"
            disabled={isBackDisabled}
            onClick={() => {
              onBack?.();
              setIsOpen(false);
            }}
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} size={17} color="currentColor" strokeWidth={1.8} />
            <span>Back</span>
          </button>
          {error === null ? null : <div className="machine-status-error">{error}</div>}
        </div>
      ) : null}

      <button
        type="button"
        className={buttonClassName}
        aria-label={`${machineName}, ${statusLabel}`}
        title={`${machineName} · ${statusLabel}`}
        aria-expanded={isOpen}
        onClick={() => {
          setError(null);
          setIsOpen((current) => !current);
        }}
      >
        <HugeiconsIcon icon={PowerIcon} size={12} color="currentColor" strokeWidth={1.8} />
        <span className="machine-status-label">{machineName}</span>
        <ConnectionStatusIndicator status={status} />
      </button>
    </div>
  );
};

const ConnectionStatusIndicator = ({
  status,
}: {
  readonly status: FilesystemConnectionStatus;
}): React.ReactElement => {
  if (status === "connecting") {
    return <span className="machine-status-spinner" aria-hidden="true" />;
  }

  return <span className="machine-status-dot" data-status={status} aria-hidden="true" />;
};

const getFilesystemConnectionLabel = (status: FilesystemConnectionStatus): string => {
  switch (status) {
    case "alive":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "closed":
      return "Disconnected";
  }
};

const ConnectorsWorkspaceToolbar = ({
  isRightSidebarOpen,
  onBack,
  onToggleRightSidebar,
}: {
  readonly isRightSidebarOpen: boolean;
  readonly onBack: () => void;
  readonly onToggleRightSidebar: () => void;
}): React.ReactElement => (
  <div className="connectors-workspace-toolbar">
    <button className="connectors-back-button" type="button" onClick={onBack}>
      <span aria-hidden="true">
        <HugeiconsIcon icon={ArrowLeft01Icon} size={17} color="currentColor" strokeWidth={1.8} />
      </span>
      Back
    </button>
    <ToolbarButton
      onClick={onToggleRightSidebar}
      ariaLabel={isRightSidebarOpen ? "Close right sidebar" : "Open right sidebar"}
      title={isRightSidebarOpen ? "Close right sidebar" : "Open right sidebar"}
      pressed={isRightSidebarOpen}
    >
      <HugeiconsIcon icon={SidebarRightIcon} size={18} color="currentColor" strokeWidth={1.8} />
    </ToolbarButton>
  </div>
);

const formatBrowserControlTitle = (status: BrowserControlStatus | undefined): string => {
  if (status === undefined) {
    return "Browser control unavailable";
  }

  return status.detail === undefined
    ? `Browser control: ${status.label}`
    : `Browser control: ${status.label} - ${status.detail}`;
};

const getBrowserControlStatusText = (status: BrowserControlStatus | undefined): string =>
  status === undefined ? "Unavailable" : status.label;

const getBrowserControlDetailText = (status: BrowserControlStatus | undefined): string => {
  if (status === undefined) {
    return "Browser control is not configured for this workspace.";
  }

  return status.detail ?? "Ready to report browser-control activity.";
};

const getBrowserWindowStatusText = (input: {
  readonly error: string | null;
  readonly isOpening: boolean;
  readonly windowId: number | null;
}): string => {
  if (input.error !== null) {
    return input.error;
  }

  if (input.isOpening) {
    return "Creating Chrome window.";
  }

  if (input.windowId !== null) {
    return `Chrome window ${input.windowId}`;
  }

  return "No Chrome window is attached.";
};

const dispatchToast = (input: {
  readonly type: "success" | "error";
  readonly message: string;
  readonly description?: string;
}): void => {
  window.dispatchEvent(new CustomEvent("heysnap:toast", { detail: input }));
};

const FinderToolbar = ({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  title,
  isFetching,
  browserControlStatus,
  onNewThread,
  onShareFeedback,
  isRightSidebarOpen,
  isRightWorkAreaOpen,
  onToggleRightWorkArea,
  onToggleRightSidebar,
  activeLeftPaneSurface,
  isBrowserTabCollapsed,
  isBrowserWindowOpening,
  onShowBrowser,
  onCollapseBrowser,
  openFileTabs,
  activeFilePath,
  onShowDirectory,
  onSelectFileTab,
  onCloseFileTab,
}: {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly onBack: () => void;
  readonly onForward: () => void;
  readonly title: string;
  readonly isFetching: boolean;
  readonly browserControlStatus?: BrowserControlStatus;
  readonly onNewThread?: () => void;
  readonly onShareFeedback?: () => void;
  readonly isRightSidebarOpen: boolean;
  readonly isRightWorkAreaOpen: boolean;
  readonly onToggleRightWorkArea: () => void;
  readonly onToggleRightSidebar: () => void;
  readonly activeLeftPaneSurface: ActiveLeftPaneSurface;
  readonly isBrowserTabCollapsed: boolean;
  readonly isBrowserWindowOpening: boolean;
  readonly onShowBrowser: () => void;
  readonly onCollapseBrowser: () => void;
  readonly openFileTabs: OpenFileTab[];
  readonly activeFilePath: string | null;
  readonly onShowDirectory: () => void;
  readonly onSelectFileTab: (path: string) => void;
  readonly onCloseFileTab: (path: string) => void;
}): React.ReactElement => (
  <div className="finder-toolbar">
    <div className="toolbar-inner">
      <div className="nav-pill">
        <ToolbarButton onClick={onBack} disabled={!canGoBack} ariaLabel="Back">
          <ChevronIcon direction="left" />
        </ToolbarButton>
        <ToolbarButton onClick={onForward} disabled={!canGoForward} ariaLabel="Forward">
          <ChevronIcon direction="right" />
        </ToolbarButton>
      </div>

      <div className="tab-strip-wrap">
        <button
          type="button"
          title={title}
          className={activeLeftPaneSurface === "directory" ? "directory-tab active" : "directory-tab"}
          onClick={onShowDirectory}
        >
          <span className="directory-tab-title">{title}</span>
        </button>

        <div className="tab-strip" role="tablist" aria-label="Open files">
          <BrowserTab
            isActive={activeLeftPaneSurface === "browser"}
            isCollapsed={isBrowserTabCollapsed}
            isOpening={isBrowserWindowOpening}
            title={formatBrowserControlTitle(browserControlStatus)}
            onSelect={onShowBrowser}
            onClose={onCollapseBrowser}
          />
          {openFileTabs.map((tab) => (
            <FileTab
              key={tab.path}
              tab={tab}
              isActive={tab.path === activeFilePath}
              onSelect={() => onSelectFileTab(tab.path)}
              onClose={() => onCloseFileTab(tab.path)}
            />
          ))}
        </div>
      </div>

      <div className="toolbar-spinner">{isFetching ? <Spinner /> : null}</div>
      {onShareFeedback === undefined ? null : (
        <ToolbarButton
          onClick={onShareFeedback}
          ariaLabel="Share feedback"
          title="Share feedback"
        >
          <HugeiconsIcon icon={ChatFeedbackIcon} size={18} color="currentColor" strokeWidth={1.8} />
        </ToolbarButton>
      )}
      <ToolbarButton
        onClick={onToggleRightWorkArea}
        ariaLabel={isRightWorkAreaOpen ? "Hide right work area" : "Show right work area"}
        title={isRightWorkAreaOpen ? "Hide right work area" : "Show right work area"}
        pressed={!isRightWorkAreaOpen}
      >
        <HugeiconsIcon
          icon={isRightWorkAreaOpen ? SquareArrowExpand01Icon : SquareArrowShrink02Icon}
          size={18}
          color="currentColor"
          strokeWidth={1.8}
        />
      </ToolbarButton>
      {!isRightSidebarOpen ? (
        <button
          type="button"
          className="new-thread-button"
          aria-label="New chat"
          title="New chat"
          onClick={onNewThread}
        >
          <HugeiconsIcon icon={Add01Icon} size={18} color="currentColor" strokeWidth={1.8} />
        </button>
      ) : null}
      <ToolbarButton
        onClick={onToggleRightSidebar}
        ariaLabel={isRightSidebarOpen ? "Close right sidebar" : "Open right sidebar"}
        title={isRightSidebarOpen ? "Close right sidebar" : "Open right sidebar"}
        pressed={isRightSidebarOpen}
      >
        <HugeiconsIcon icon={SidebarRightIcon} size={18} color="currentColor" strokeWidth={1.8} />
      </ToolbarButton>
    </div>
  </div>
);

const BrowserTab = ({
  isActive,
  isCollapsed,
  isOpening,
  title,
  onSelect,
  onClose,
}: {
  readonly isActive: boolean;
  readonly isCollapsed: boolean;
  readonly isOpening: boolean;
  readonly title: string;
  readonly onSelect: () => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  if (isCollapsed) {
    return (
      <button
        type="button"
        className="browser-collapsed-tab"
        title={title}
        aria-label={isOpening ? "Opening browser" : "Open browser"}
        disabled={isOpening}
        onClick={onSelect}
      >
        <HugeiconsIcon icon={InternetIcon} size={14} color="currentColor" strokeWidth={1.8} />
      </button>
    );
  }

  return (
    <div className={isActive ? "file-tab browser-file-tab active" : "file-tab browser-file-tab"} role="tab" aria-selected={isActive}>
      <span className="file-tab-leading">
        <span className="file-tab-file-icon" aria-hidden="true">
          <HugeiconsIcon icon={InternetIcon} size={14} color="currentColor" strokeWidth={1.8} />
        </span>
        <button
          type="button"
          className="file-tab-close"
          aria-label="Collapse browser tab"
          title="Close tab"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} color="currentColor" strokeWidth={2} />
        </button>
      </span>
      <button
        type="button"
        className="file-tab-activate"
        title={title}
        onClick={onSelect}
        tabIndex={isActive ? 0 : -1}
      >
        <span className="file-tab-title">Browser</span>
      </button>
    </div>
  );
};

const FileTab = ({
  tab,
  isActive,
  onSelect,
  onClose,
}: {
  readonly tab: OpenFileTab;
  readonly isActive: boolean;
  readonly onSelect: () => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const iconSrc = getTypedFileIconSrc(tab.name);
  const className = [
    "file-tab",
    isActive ? "active" : "",
    tab.name.length > 24 ? "long-name" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={className} role="tab" aria-selected={isActive}>
      <span className="file-tab-leading">
        <span className="file-tab-file-icon" aria-hidden="true">
          {iconSrc === null ? (
            <HugeiconsIcon icon={File02Icon} size={16} color="currentColor" strokeWidth={1.8} />
          ) : (
            <img src={iconSrc} alt="" draggable={false} className="file-tab-type-icon" />
          )}
        </span>
        <button
          type="button"
          className="file-tab-close"
          aria-label={`Close ${tab.name}`}
          title="Close tab"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <CloseIcon />
        </button>
      </span>
      <button
        type="button"
        className="file-tab-activate"
        title={tab.path}
        onClick={onSelect}
        tabIndex={isActive ? 0 : -1}
      >
        <span className="file-tab-title">{tab.name}</span>
      </button>
    </div>
  );
};

const ToolbarButton = ({
  children,
  disabled,
  onClick,
  ariaLabel,
  title,
  active,
  pressed,
}: {
  readonly children: React.ReactNode;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly ariaLabel: string;
  readonly title?: string;
  readonly active?: boolean;
  readonly pressed?: boolean;
}): React.ReactElement => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel}
    aria-pressed={pressed}
    title={title ?? ariaLabel}
    className={active === true ? "toolbar-button active" : "toolbar-button"}
  >
    {children}
  </button>
);

const FileViewer = ({
  file,
  filesystemPreviewBaseUrl,
  websocketUrl,
}: {
  readonly file: OpenFileTab;
  readonly filesystemPreviewBaseUrl?: string;
  readonly websocketUrl: string;
}): React.ReactElement => {
  const previewBaseUrl = resolveFilesystemPreviewBaseUrl(websocketUrl, filesystemPreviewBaseUrl);

  if (previewBaseUrl === null) {
    return (
      <section className="heysnap-document-viewer" aria-label={file.name}>
        <DocumentViewerState
          message="File preview is not available on this server yet. Restart or update the cloud server and machine server."
          variant="error"
        />
      </section>
    );
  }

  return (
    <section className="heysnap-document-viewer" aria-label={file.name}>
      <iframe
        className="heysnap-file-preview-frame"
        src={buildFilesystemPreviewerUrl(previewBaseUrl, file.path)}
        title={file.name}
      />
    </section>
  );
};

const MemoizedFileViewer = memo(FileViewer);

const BrowserControlPanel = ({
  canGoBack,
  canGoForward,
  error,
  isOpening,
  onBack,
  onCloseTab,
  onForward,
  onGoTo,
  onNewTab,
  onRefresh,
  onSelectTab,
  onViewportClick,
  onViewportKey,
  onViewportWheel,
  screencastAspectRatio,
  screencastFrameUrl,
  screencastState,
  screencastTabId,
  status,
  tabs,
  windowId,
}: {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly error: string | null;
  readonly isOpening: boolean;
  readonly onBack?: () => Promise<void> | void;
  readonly onCloseTab?: (tabId: number) => Promise<void> | void;
  readonly onForward?: () => Promise<void> | void;
  readonly onGoTo?: (url: string) => Promise<void> | void;
  readonly onNewTab?: () => Promise<void> | void;
  readonly onRefresh?: () => Promise<void> | void;
  readonly onSelectTab?: (tabId: number) => Promise<void> | void;
  readonly onViewportClick?: (input: BrowserViewportClickInput) => Promise<void> | void;
  readonly onViewportKey?: (input: BrowserViewportKeyboardInput) => Promise<void> | void;
  readonly onViewportWheel?: (input: BrowserViewportWheelInput) => Promise<void> | void;
  readonly screencastAspectRatio: number | null;
  readonly screencastFrameUrl: string | null;
  readonly screencastState: BrowserScreencastState;
  readonly screencastTabId: number | null;
  readonly status?: BrowserControlStatus;
  readonly tabs: BrowserWindowTab[];
  readonly windowId: number | null;
}): React.ReactElement => {
  const panelRef = useRef<HTMLElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollRef = useRef<BrowserViewportWheelInput | null>(null);
  const [addressValue, setAddressValue] = useState("");
  const [isAddressFocused, setIsAddressFocused] = useState(false);
  const [isViewportKeyboardActive, setIsViewportKeyboardActive] = useState(false);
  const [panelSize, setPanelSize] = useState({ width: 0, height: 0 });
  const [frameAspectRatio, setFrameAspectRatio] = useState(DEFAULT_BROWSER_STREAM_ASPECT_RATIO);
  const screenAspectRatio = readBrowserFrameAspectRatio(screencastAspectRatio) ?? frameAspectRatio;
  const availableScreenHeight = Math.max(
    0,
    panelSize.height - BROWSER_TOP_PADDING - BROWSER_TAB_BAR_HEIGHT - BROWSER_TOOL_BAR_HEIGHT - BROWSER_BOTTOM_PADDING,
  );
  const screenWidthFromHeight = availableScreenHeight * screenAspectRatio;
  const screenWidth = Math.max(0, Math.min(panelSize.width, screenWidthFromHeight));
  const screenHeight = screenWidth > 0 ? screenWidth / screenAspectRatio : 0;
  const windowHeight = BROWSER_TOP_PADDING + BROWSER_TAB_BAR_HEIGHT + BROWSER_TOOL_BAR_HEIGHT + screenHeight
    + BROWSER_BOTTOM_PADDING;
  const statusText = [
    getBrowserWindowStatusText({ error, isOpening, windowId }),
    getBrowserControlStatusText(status),
    getBrowserControlDetailText(status),
  ].join(" ");
  const activeTab = tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
  const activeTabIsNewTab = activeTab !== null && isBrowserNewTabUrl(activeTab.url);
  const activeFrameUrl = activeTab !== null && activeTab.id === screencastTabId ? screencastFrameUrl : null;
  const canSendViewportInput = activeTab !== null
    && activeFrameUrl !== null
    && !activeTabIsNewTab
    && screencastState === "streaming";
  const visibleTabs = tabs.length > 0
    ? tabs
    : windowId === null
      ? []
      : [{
          id: windowId,
          index: 0,
          active: true,
          title: `Window ${windowId}`,
          url: DEFAULT_BROWSER_WINDOW_URL,
        }];

  useEffect(() => {
    const panel = panelRef.current;

    if (panel === null) {
      return;
    }

    const updateSize = (): void => {
      const rect = panel.getBoundingClientRect();
      setPanelSize({
        width: rect.width,
        height: rect.height,
      });
    };
    const observer = new ResizeObserver(updateSize);

    updateSize();
    observer.observe(panel);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (activeTabIsNewTab) {
      setAddressValue("");
      return;
    }

    if (!isAddressFocused) {
      setAddressValue(activeTab?.url ?? "");
    }
  }, [activeTab?.url, activeTabIsNewTab, isAddressFocused]);

  useEffect(() => {
    if (!activeTabIsNewTab || activeTab === null) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeTab?.id, activeTabIsNewTab]);

  const flushPendingScroll = useCallback((): void => {
    scrollFrameRef.current = null;

    const scroll = pendingScrollRef.current;
    pendingScrollRef.current = null;

    if (scroll === null || onViewportWheel === undefined) {
      return;
    }

    void Promise.resolve(onViewportWheel(scroll)).catch(() => undefined);
  }, [onViewportWheel]);

  const handleScreenWheel = useCallback((event: globalThis.WheelEvent): void => {
    const screen = screenRef.current;

    if (!canSendViewportInput || screen === null || activeTab === null || onViewportWheel === undefined) {
      return;
    }

    const ratio = getBrowserViewportInputRatio(screen, event.clientX, event.clientY);
    const fallbackPoint = getBrowserViewportInputPoint(screen, event.clientX, event.clientY);

    if (ratio === null || fallbackPoint === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const pending = pendingScrollRef.current;

    pendingScrollRef.current = {
      tabId: activeTab.id,
      fallbackPoint,
      ratio,
      deltaX: (pending?.deltaX ?? 0) + event.deltaX,
      deltaY: (pending?.deltaY ?? 0) + event.deltaY,
    };

    if (scrollFrameRef.current === null) {
      scrollFrameRef.current = window.requestAnimationFrame(flushPendingScroll);
    }
  }, [activeTab, canSendViewportInput, flushPendingScroll, onViewportWheel]);

  const handleScreenClick = useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
    const screen = screenRef.current;

    if (!canSendViewportInput || screen === null || activeTab === null || onViewportClick === undefined) {
      return;
    }

    const ratio = getBrowserViewportInputRatio(screen, event.clientX, event.clientY);
    const fallbackPoint = getBrowserViewportInputPoint(screen, event.clientX, event.clientY);

    if (ratio === null || fallbackPoint === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    void Promise.resolve(onViewportClick({
      fallbackPoint,
      ratio,
      tabId: activeTab.id,
    })).catch(() => undefined);
  }, [activeTab, canSendViewportInput, onViewportClick]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const screen = screenRef.current;

      setIsViewportKeyboardActive(
        screen !== null && event.target instanceof Node && screen.contains(event.target) && canSendViewportInput,
      );
    };

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [canSendViewportInput]);

  useEffect(() => {
    if (!isViewportKeyboardActive || !canSendViewportInput || activeTab === null || onViewportKey === undefined) {
      return;
    }

    const handleKeyEvent = (event: KeyboardEvent): void => {
      if (isEditableKeyboardTarget(event.target) || event.isComposing) {
        return;
      }

      const input = toBrowserViewportKeyboardInput(activeTab.id, event);

      if (input === null) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      void Promise.resolve(onViewportKey(input)).catch(() => undefined);
    };

    window.addEventListener("keydown", handleKeyEvent, true);
    window.addEventListener("keyup", handleKeyEvent, true);

    return () => {
      window.removeEventListener("keydown", handleKeyEvent, true);
      window.removeEventListener("keyup", handleKeyEvent, true);
    };
  }, [activeTab, canSendViewportInput, isViewportKeyboardActive, onViewportKey]);

  useEffect(() => {
    const screen = screenRef.current;

    if (screen === null) {
      return;
    }

    screen.addEventListener("wheel", handleScreenWheel, { passive: false });

    return () => {
      screen.removeEventListener("wheel", handleScreenWheel);
    };
  }, [handleScreenWheel]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
  }, []);

  return (
    <section
      ref={panelRef}
      className="browser-control-panel"
      aria-label={`Browser. ${statusText}`}
      style={{
        "--browser-tab-bar-height": `${BROWSER_TAB_BAR_HEIGHT}px`,
        "--browser-tool-bar-height": `${BROWSER_TOOL_BAR_HEIGHT}px`,
        "--browser-top-padding": `${BROWSER_TOP_PADDING}px`,
        "--browser-bottom-padding": `${BROWSER_BOTTOM_PADDING}px`,
        "--browser-screen-width": `${screenWidth}px`,
        "--browser-screen-height": `${screenHeight}px`,
        "--browser-window-height": `${windowHeight}px`,
      } as React.CSSProperties}
    >
      <div className="browser-window-layout">
        <div className="browser-window-tabbar" role="tablist" aria-label="Browser tabs">
          {visibleTabs.map((tab) => (
            <div
              key={tab.id}
              className={activeTab?.id === tab.id ? "browser-window-tab active" : "browser-window-tab"}
              role="tab"
              aria-selected={activeTab?.id === tab.id}
              tabIndex={activeTab?.id === tab.id ? 0 : -1}
              title={tab.title ?? tab.url ?? `Tab ${tab.id}`}
              onClick={() => {
                void Promise.resolve(onSelectTab?.(tab.id)).catch(() => undefined);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                  return;
                }

                event.preventDefault();
                void Promise.resolve(onSelectTab?.(tab.id)).catch(() => undefined);
              }}
            >
              <span className="browser-window-tab-favicon" aria-hidden="true">
                {tab.favIconUrl === undefined || tab.favIconUrl.length === 0 ? (
                  <HugeiconsIcon icon={InternetIcon} size={13} color="currentColor" strokeWidth={1.8} />
                ) : (
                  <img src={tab.favIconUrl} alt="" />
                )}
              </span>
              <span className="browser-window-tab-title">{tab.title ?? tab.url ?? "New tab"}</span>
              <button
                className="browser-window-tab-close"
                type="button"
                aria-label={`Close ${tab.title ?? tab.url ?? "tab"}`}
                title="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  void Promise.resolve(onCloseTab?.(tab.id)).catch(() => undefined);
                }}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={13} color="currentColor" strokeWidth={2} />
              </button>
            </div>
          ))}
          <button
            className="browser-window-new-tab"
            type="button"
            aria-label="New tab"
            title="New tab"
            onClick={() => {
              void Promise.resolve(onNewTab?.()).catch(() => undefined);
            }}
          >
            <HugeiconsIcon icon={Add01Icon} size={14} color="currentColor" strokeWidth={1.9} />
          </button>
        </div>
        <div className="browser-window-toolbar" aria-label="Browser toolbar">
          <div className="browser-window-toolbar-nav" aria-label="Browser navigation">
            <button
              className="browser-window-toolbar-button"
              type="button"
              aria-label="Back"
              title="Back"
              disabled={!canGoBack}
              onClick={() => {
                void Promise.resolve(onBack?.()).catch(() => undefined);
              }}
            >
              <HugeiconsIcon icon={ArrowLeft02Icon} size={16} color="currentColor" strokeWidth={2} />
            </button>
            <button
              className="browser-window-toolbar-button"
              type="button"
              aria-label="Forward"
              title="Forward"
              disabled={!canGoForward}
              onClick={() => {
                void Promise.resolve(onForward?.()).catch(() => undefined);
              }}
            >
              <HugeiconsIcon icon={ArrowRight02Icon} size={16} color="currentColor" strokeWidth={2} />
            </button>
            <button
              className="browser-window-toolbar-button"
              type="button"
              aria-label="Refresh"
              title="Refresh"
              disabled={activeTab === null}
              onClick={() => {
                void Promise.resolve(onRefresh?.()).catch(() => undefined);
              }}
            >
              <HugeiconsIcon icon={Refresh01Icon} size={15} color="currentColor" strokeWidth={2} />
            </button>
          </div>
          <form
            className="browser-window-address-form"
            onSubmit={(event) => {
              event.preventDefault();
              const nextUrl = addressValue.trim();

              if (nextUrl.length === 0 || activeTab === null) {
                return;
              }

              void Promise.resolve(onGoTo?.(nextUrl)).catch(() => undefined);
            }}
          >
            <input
              ref={addressInputRef}
              className="browser-window-address"
              type="text"
              value={addressValue}
              aria-label="Address"
              title={activeTab?.url ?? ""}
              disabled={activeTab === null}
              spellCheck={false}
              onBlur={() => {
                setIsAddressFocused(false);
              }}
              onChange={(event) => {
                setAddressValue(event.currentTarget.value);
              }}
              onFocus={(event) => {
                setIsAddressFocused(true);
                event.currentTarget.select();
              }}
            />
          </form>
        </div>
        <div className="browser-window-stage">
          <div
            ref={screenRef}
            className={activeFrameUrl !== null ? "browser-window-screen has-frame" : "browser-window-screen"}
            data-stream-state={screencastState}
            aria-label="Browser screen"
            onClick={handleScreenClick}
          >
            {activeFrameUrl !== null && !activeTabIsNewTab ? (
              <img
                src={activeFrameUrl}
                alt=""
                onLoad={(event) => {
                  const aspectRatio = readBrowserFrameAspectRatio(
                    event.currentTarget.naturalWidth / event.currentTarget.naturalHeight,
                  );

                  if (aspectRatio !== null) {
                    setFrameAspectRatio(aspectRatio);
                  }
                }}
              />
            ) : null}
            {activeTabIsNewTab ? (
              <div className="browser-window-new-tab-placeholder">
                <span className="browser-window-new-tab-title">New tab</span>
                <span className="browser-window-new-tab-subtitle">enter url to continue</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
};

const FileViewerStack = ({
  openFileTabs,
  activeFilePath,
  filesystemPreviewBaseUrl,
  websocketUrl,
}: {
  readonly openFileTabs: OpenFileTab[];
  readonly activeFilePath: string | null;
  readonly filesystemPreviewBaseUrl?: string;
  readonly websocketUrl: string;
}): React.ReactElement => (
  <>
    {openFileTabs.map((tab) => {
      const isActive = tab.path === activeFilePath;

      return (
        <div
          key={tab.path}
          className={isActive ? "left-pane-surface active" : "left-pane-surface inactive"}
          aria-hidden={!isActive}
        >
          <MemoizedFileViewer
            file={tab}
            filesystemPreviewBaseUrl={filesystemPreviewBaseUrl}
            websocketUrl={websocketUrl}
          />
        </div>
      );
    })}
  </>
);

const DocumentViewerState = ({
  message,
  variant = "info",
}: {
  readonly message: string;
  readonly variant?: "info" | "error";
}): React.ReactElement => (
  <div className={variant === "error" ? "document-viewer-state error" : "document-viewer-state"}>
    <p>{message}</p>
  </div>
);

const DesktopSplitPane = ({
  children,
  leftPaneRatio,
  isRightWorkAreaOpen,
  isRightAgentAreaOpen,
  onLeftPaneRatioChange,
  agentBaseUrl,
  sarvamApiKey,
  selectedThreadId,
  currentPath,
  currentDirectoryName,
  promptDraft,
  promptAttachments,
  workspacePanel,
  capabilitiesBaseUrl,
  uiContext,
  onOpenFilePath,
  onPromptDraftChange,
  onPromptAttachmentsChange,
  onSelectThread,
  onThreadResolved,
}: {
  readonly children: React.ReactNode;
  readonly leftPaneRatio: number;
  readonly isRightWorkAreaOpen: boolean;
  readonly isRightAgentAreaOpen: boolean;
  readonly onLeftPaneRatioChange: (ratio: number) => void;
  readonly agentBaseUrl: string;
  readonly sarvamApiKey?: string;
  readonly selectedThreadId: string | null;
  readonly currentPath: string;
  readonly currentDirectoryName: string;
  readonly promptDraft: string;
  readonly promptAttachments: readonly PromptAttachment[];
  readonly workspacePanel: WorkspacePanel;
  readonly capabilitiesBaseUrl?: string;
  readonly uiContext: AgentUiContext;
  readonly onOpenFilePath: (path: string) => void;
  readonly onPromptDraftChange: Dispatch<SetStateAction<string>>;
  readonly onPromptAttachmentsChange: Dispatch<SetStateAction<PromptAttachment[]>>;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
  readonly onThreadResolved?: (threadId: string) => void;
}): React.ReactElement => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [promptFocusToken, setPromptFocusToken] = useState(0);
  const handleVoiceTranscript = useCallback((transcript: string): void => {
    onPromptDraftChange((currentDraft) => appendPromptTranscript(currentDraft, transcript));
    setPromptFocusToken((currentToken) => currentToken + 1);
  }, [onPromptDraftChange]);
  const voicePrompt = useFilesystemVoicePrompt({
    sarvamApiKey,
    onTranscript: handleVoiceTranscript,
  });
  const handleRightPromptVoiceToggle = useCallback((): void => {
    if (voicePrompt.recordingState === "idle") {
      void voicePrompt.startRecording();
      return;
    }

    if (voicePrompt.recordingState === "recording") {
      voicePrompt.stopRecording();
    }
  }, [voicePrompt]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handleMouseMove = (event: MouseEvent): void => {
      const container = containerRef.current;

      if (container === null) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const styles = window.getComputedStyle(container);
      const paddingRight = Number.parseFloat(styles.paddingRight);
      const resizableWidth = rect.width - (Number.isFinite(paddingRight) ? paddingRight : 0);
      const nextRatio = (event.clientX - rect.left) / resizableWidth;
      onLeftPaneRatioChange(nextRatio);
    };

    const handleMouseUp = (): void => {
      setIsResizing(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizing, onLeftPaneRatioChange]);

  return (
    <div className="split-pane">
      <div
        ref={containerRef}
        className="split-main"
        data-resizing={isResizing ? "true" : undefined}
        data-right-work-area-open={isRightWorkAreaOpen ? "true" : "false"}
        data-right-agent-area-open={isRightAgentAreaOpen ? "true" : "false"}
      >
        <section className="split-left" style={{ flexBasis: `${leftPaneRatio * 100}%` }}>
          {children}
          <FilesystemHoverGrip
            isVisible={!isRightAgentAreaOpen}
            promptDraft={promptDraft}
            promptAttachments={promptAttachments}
            focusToken={promptFocusToken}
            voiceState={voicePrompt.recordingState}
            currentPath={currentPath}
            selectedThreadId={selectedThreadId}
            uiContext={uiContext}
            onPromptDraftChange={onPromptDraftChange}
            onPromptAttachmentsChange={onPromptAttachmentsChange}
            onStartRecording={voicePrompt.startRecording}
            onStopRecording={voicePrompt.stopRecording}
            onOpenFilePath={onOpenFilePath}
            onSelectThread={onSelectThread}
            onThreadResolved={onThreadResolved}
          />
        </section>

        <div
          role="separator"
          aria-label="Resize desktop panels"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(leftPaneRatio * 100)}
          onMouseDown={(event) => {
            event.preventDefault();
            if (!isRightWorkAreaOpen) {
              return;
            }
            setIsResizing(true);
          }}
          className="split-resizer"
        >
          <div className="split-resizer-line" />
          <div className="split-resizer-handle" />
        </div>

        <aside
          className="split-preview"
          aria-hidden={!isRightWorkAreaOpen}
          aria-label={workspacePanel === "connectors" ? "Connectors panel" : "Preview panel"}
        >
          {workspacePanel === "connectors" ? (
            <CapabilitiesPanel capabilitiesBaseUrl={capabilitiesBaseUrl} />
          ) : (
            <AgentPanel
              agentBaseUrl={agentBaseUrl}
              selectedThreadId={selectedThreadId}
              currentPath={currentPath}
              currentDirectoryName={currentDirectoryName}
              uiContext={uiContext}
              promptDraft={promptDraft}
              promptAttachments={promptAttachments}
              promptVoiceState={isRightAgentAreaOpen ? voicePrompt.recordingState : "idle"}
              promptAutoFocusToken={isRightAgentAreaOpen ? promptFocusToken : undefined}
              onOpenFilePath={onOpenFilePath}
              onPromptDraftChange={onPromptDraftChange}
              onPromptAttachmentsChange={onPromptAttachmentsChange}
              onPromptVoiceToggle={isRightAgentAreaOpen ? handleRightPromptVoiceToggle : undefined}
              onSelectThread={onSelectThread}
              onThreadResolved={onThreadResolved}
            />
          )}
        </aside>
      </div>
    </div>
  );
};

const appendPromptTranscript = (draft: string, transcript: string): string => {
  const trimmedTranscript = transcript.trim();

  if (trimmedTranscript.length === 0) {
    return draft;
  }

  const trimmedDraft = draft.trimEnd();
  return trimmedDraft.length === 0 ? trimmedTranscript : `${trimmedDraft}\n${trimmedTranscript}`;
};

const useFilesystemVoicePrompt = ({
  sarvamApiKey,
  onTranscript,
}: {
  readonly sarvamApiKey?: string;
  readonly onTranscript: (transcript: string) => void;
}): {
  readonly recordingState: PromptVoiceState;
  readonly startRecording: () => Promise<void>;
  readonly stopRecording: () => void;
} => {
  const [recordingState, setRecordingState] = useState<PromptVoiceState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingSessionRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const shouldTranscribeOnStopRef = useRef(false);
  const hotkeyRecordingRef = useRef(false);

  const discardRecording = useCallback(() => {
    audioChunksRef.current = [];

    const stream = mediaStreamRef.current;
    mediaStreamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  const handleRecordingStopped = useCallback(async (durationSeconds: number): Promise<void> => {
    const audioType = normalizeSarvamAudioMimeType(audioChunksRef.current[0]?.type || "audio/webm");
    const audioBlob = new Blob(audioChunksRef.current, { type: audioType });

    try {
      const result = await transcribeSarvamRecording({
        apiKey: sarvamApiKey,
        audioBlob,
        durationSeconds,
      });
      const transcript = extractSarvamTranscript(result);

      if (transcript !== null) {
        onTranscript(transcript);
      }
    } catch (error) {
      console.error("Sarvam STT failed.", error);
    } finally {
      discardRecording();
      setRecordingState("idle");
    }
  }, [discardRecording, onTranscript, sarvamApiKey]);

  const stopRecording = useCallback(() => {
    hotkeyRecordingRef.current = false;
    recordingSessionRef.current += 1;
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;

    if (recorder !== null && recorder.state !== "inactive") {
      shouldTranscribeOnStopRef.current = true;
      setRecordingState("transcribing");
      recorder.stop();
    } else {
      discardRecording();
      setRecordingState("idle");
    }
  }, [discardRecording]);

  const startRecording = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      typeof MediaRecorder === "undefined" ||
      navigator.mediaDevices?.getUserMedia === undefined
    ) {
      return;
    }

    setRecordingState("starting");
    const recordingSession = recordingSessionRef.current + 1;
    recordingSessionRef.current = recordingSession;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (recordingSessionRef.current !== recordingSession) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const recordingMimeType = getPreferredRecordingMimeType();
      const recorder = new MediaRecorder(
        stream,
        recordingMimeType === undefined ? undefined : { mimeType: recordingMimeType },
      );

      shouldTranscribeOnStopRef.current = false;
      audioChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = performance.now();
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        if (shouldTranscribeOnStopRef.current) {
          shouldTranscribeOnStopRef.current = false;
          void handleRecordingStopped((performance.now() - recordingStartedAtRef.current) / 1000);
          return;
        }

        discardRecording();
      }, { once: true });
      recorder.start();
      setRecordingState("recording");
    } catch (error) {
      discardRecording();
      setRecordingState("idle");
      console.warn("Microphone recording failed.", error);
    }
  }, [discardRecording, handleRecordingStopped]);

  useEffect(() => {
    const isRecordingHotkey = (event: KeyboardEvent): boolean =>
      event.altKey && (event.code === "KeyM" || event.key.toLowerCase() === "m");

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || !isRecordingHotkey(event)) {
        return;
      }

      event.preventDefault();

      if (recordingState !== "idle") {
        return;
      }

      hotkeyRecordingRef.current = true;
      void startRecording();
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (
        !hotkeyRecordingRef.current ||
        (event.code !== "KeyM" && event.key.toLowerCase() !== "m" && event.key !== "Alt")
      ) {
        return;
      }

      event.preventDefault();
      hotkeyRecordingRef.current = false;
      stopRecording();
    };

    const handleWindowBlur = (): void => {
      if (!hotkeyRecordingRef.current) {
        return;
      }

      hotkeyRecordingRef.current = false;
      stopRecording();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [recordingState, startRecording, stopRecording]);

  useEffect(() => () => {
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    shouldTranscribeOnStopRef.current = false;

    if (recorder !== null && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }

    discardRecording();
  }, [discardRecording]);

  return {
    recordingState,
    startRecording,
    stopRecording,
  };
};

const FilesystemHoverGrip = ({
  isVisible,
  promptDraft,
  promptAttachments,
  focusToken,
  voiceState,
  currentPath,
  selectedThreadId,
  uiContext,
  onPromptDraftChange,
  onPromptAttachmentsChange,
  onStartRecording,
  onStopRecording,
  onOpenFilePath,
  onSelectThread,
  onThreadResolved,
}: {
  readonly isVisible: boolean;
  readonly promptDraft: string;
  readonly promptAttachments: readonly PromptAttachment[];
  readonly focusToken: number;
  readonly voiceState: PromptVoiceState;
  readonly currentPath: string;
  readonly selectedThreadId: string | null;
  readonly uiContext: AgentUiContext;
  readonly onPromptDraftChange: (draft: string) => void;
  readonly onPromptAttachmentsChange: (attachments: PromptAttachment[]) => void;
  readonly onStartRecording: () => Promise<void>;
  readonly onStopRecording: () => void;
  readonly onOpenFilePath: (path: string) => void;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
  readonly onThreadResolved?: (threadId: string) => void;
}): React.ReactElement | null => {
  const activeRun = useAgentChatStore((state) => state.activeRun);
  const messageOrder = useAgentChatStore((state) => state.messageOrder);
  const messagesById = useAgentChatStore((state) => state.messagesById);
  const streamingMessageIds = useAgentChatStore((state) => state.streamingMessageIds);
  const latestAssistantResponse = useMemo<FilesystemAgentStatusResponse | null>(() => {
    if (activeRun === null) {
      return null;
    }

    const lastUserMessageIndex = findLastUserMessageIndex(messageOrder, messagesById);
    let latestResponse: FilesystemAgentStatusResponse | null = null;

    for (const messageId of messageOrder.slice(lastUserMessageIndex + 1)) {
      const message = messagesById[messageId];

      if (message?.role !== "assistant") {
        continue;
      }

      const markdown = getAssistantMarkdown(message);

      if (markdown.length === 0) {
        continue;
      }

      latestResponse = {
        id: messageId,
        markdown,
        isStreaming: streamingMessageIds.includes(messageId),
      };
    }

    return latestResponse;
  }, [activeRun, messageOrder, messagesById, streamingMessageIds]);
  const isAgentRunning = activeRun !== null;
  const [retainedAssistantResponse, setRetainedAssistantResponse] = useState<FilesystemAgentStatusResponse | null>(null);
  const latestAssistantResponseRef = useRef<FilesystemAgentStatusResponse | null>(null);
  const wasAgentRunningRef = useRef(isAgentRunning);
  const { cancel, steer, submit } = useAgentRunMutation({
    currentPath,
    uiContext,
    selectedThreadId,
    onSelectThread,
    onThreadResolved,
  });
  const isRecording = voiceState === "recording";
  const isLoading = voiceState === "starting" || voiceState === "transcribing";
  const isExpanded = voiceState !== "idle";
  const hasPromptContent = promptDraft.trim().length > 0 || promptAttachments.length > 0;
  const previousFocusTokenRef = useRef(focusToken);
  const shouldAutoFocus = previousFocusTokenRef.current !== focusToken;

  useEffect(() => {
    previousFocusTokenRef.current = focusToken;
  }, [focusToken]);

  useEffect(() => {
    if (!isAgentRunning || latestAssistantResponse === null) {
      return;
    }

    latestAssistantResponseRef.current = latestAssistantResponse;
    setRetainedAssistantResponse(null);
  }, [isAgentRunning, latestAssistantResponse]);

  useEffect(() => {
    if (isAgentRunning) {
      wasAgentRunningRef.current = true;
      return;
    }

    if (!wasAgentRunningRef.current) {
      return;
    }

    wasAgentRunningRef.current = false;
    const finalResponse = latestAssistantResponse ?? latestAssistantResponseRef.current;

    if (finalResponse === null) {
      return;
    }

    setRetainedAssistantResponse({ ...finalResponse, isStreaming: false });
    const timeoutId = window.setTimeout(() => {
      setRetainedAssistantResponse(null);
    }, 10_000);

    return () => window.clearTimeout(timeoutId);
  }, [isAgentRunning, latestAssistantResponse]);

  if (!isVisible) {
    return null;
  }

  const visibleAssistantResponse = isAgentRunning ? latestAssistantResponse : retainedAssistantResponse;
  const agentStatusDialog = isAgentRunning || retainedAssistantResponse !== null ? (
    <FilesystemAgentStatusDialog
      response={visibleAssistantResponse}
      currentPath={currentPath}
      onOpenFilePath={onOpenFilePath}
    />
  ) : null;

  return (
    <div className="filesystem-voice-stack" data-with-prompt={hasPromptContent ? "true" : "false"}>
      {agentStatusDialog}
      {hasPromptContent ? (
        <div className="filesystem-voice-prompt-shell">
          <RightPromptComposer
            draft={promptDraft}
            attachments={promptAttachments}
            voiceState={voiceState}
            autoFocus={shouldAutoFocus}
            isRunning={isAgentRunning}
            onDraftChange={onPromptDraftChange}
            onAttachmentsChange={onPromptAttachmentsChange}
            onCancel={cancel}
            onSubmit={async (input) => {
              const didSubmit = isAgentRunning ? await steer(input) : submit(input);
              return didSubmit;
            }}
          />
        </div>
      ) : (
        <button
          className="filesystem-hover-grip"
          type="button"
          aria-label={isRecording ? "Stop recording" : "Start recording"}
          aria-pressed={isRecording}
          data-expanded={isExpanded ? "true" : "false"}
          data-recording={isRecording ? "true" : "false"}
          data-loading={isLoading ? "true" : "false"}
          onClick={() => {
            if (isLoading) {
              return;
            }

            if (voiceState === "idle") {
              void onStartRecording();
              return;
            }

            onStopRecording();
          }}
        >
          {isLoading ? (
            <span className="filesystem-hover-grip-loading" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          ) : (
            <span className="filesystem-hover-grip-dots" aria-hidden="true">
              {Array.from({ length: 8 }, (_, index) => (
                <span key={index} />
              ))}
            </span>
          )}
        </button>
      )}
    </div>
  );
};

type FilesystemAgentStatusResponse = {
  readonly id: string;
  readonly markdown: string;
  readonly isStreaming: boolean;
};

const FilesystemAgentStatusDialog = ({
  response,
  currentPath,
  onOpenFilePath,
}: {
  readonly response: FilesystemAgentStatusResponse | null;
  readonly currentPath: string;
  readonly onOpenFilePath: (path: string) => void;
}): React.ReactElement => (
  <div
    className="filesystem-agent-status-dialog"
    data-state={response === null ? "working" : "response"}
    role="status"
    aria-live="polite"
  >
    {response === null ? (
      <div className="filesystem-agent-status-working">
        <span>Working</span>
      </div>
    ) : (
      <div className="filesystem-agent-status-scroll">
        <div
          key={response.id}
          className="filesystem-agent-status-message"
          data-streaming={response.isStreaming ? "true" : "false"}
        >
          <Suspense fallback={<div className="chat-markdown" />}>
            <ChatMarkdown
              text={response.markdown}
              cwd={currentPath}
              isStreaming={response.isStreaming}
              onOpenFilePath={onOpenFilePath}
            />
          </Suspense>
        </div>
      </div>
    )}
  </div>
);

const findLastUserMessageIndex = (
  messageOrder: readonly string[],
  messagesById: Readonly<Record<string, unknown>>,
): number => {
  for (let index = messageOrder.length - 1; index >= 0; index -= 1) {
    const messageId = messageOrder[index];
    const message = messageId === undefined ? undefined : messagesById[messageId];

    if (
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      message.role === "user"
    ) {
      return index;
    }
  }

  return -1;
};

const SARVAM_API_BASE_URL = "https://api.sarvam.ai";
const SARVAM_SHORT_AUDIO_MAX_SECONDS = 30;
const SARVAM_STT_MODEL = "saaras:v3";
const SARVAM_STT_MODE = "translit";
const SARVAM_BATCH_POLL_INTERVAL_MS = 2_000;
const SARVAM_BATCH_TIMEOUT_MS = 20 * 60 * 1_000;

type SarvamJobState = "Accepted" | "Pending" | "Running" | "Completed" | "Failed";

type SarvamSignedUrlDetails = {
  readonly file_url: string;
  readonly file_metadata?: Record<string, unknown> | null;
};

type SarvamTaskFileDetails = {
  readonly file_name: string;
  readonly file_id: string;
};

type SarvamTaskDetail = {
  readonly outputs?: SarvamTaskFileDetails[];
  readonly state?: string;
  readonly error_message?: string | null;
};

type SarvamBatchStatusResponse = {
  readonly job_state: SarvamJobState;
  readonly job_id: string;
  readonly job_details?: SarvamTaskDetail[];
  readonly error_message?: string;
};

type SarvamBatchInitResponse = {
  readonly job_id: string;
};

type SarvamUploadLinksResponse = {
  readonly upload_urls: Record<string, SarvamSignedUrlDetails>;
  readonly storage_container_type?: string;
};

type SarvamDownloadLinksResponse = {
  readonly download_urls: Record<string, SarvamSignedUrlDetails>;
};

const getPreferredRecordingMimeType = (): string | undefined => {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }

  return [
    "audio/ogg;codecs=opus",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
};

const normalizeSarvamAudioMimeType = (mimeType: string): string => {
  const normalizedMimeType = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";

  if (normalizedMimeType === "audio/webm" || normalizedMimeType === "video/webm") {
    return "audio/webm";
  }

  if (normalizedMimeType === "audio/ogg" || normalizedMimeType === "audio/opus") {
    return normalizedMimeType;
  }

  if (normalizedMimeType === "audio/mp4" || normalizedMimeType === "audio/x-m4a") {
    return normalizedMimeType;
  }

  if (normalizedMimeType === "audio/wav" || normalizedMimeType === "audio/x-wav" || normalizedMimeType === "audio/wave") {
    return normalizedMimeType;
  }

  if (normalizedMimeType === "audio/mpeg" || normalizedMimeType === "audio/mp3") {
    return normalizedMimeType;
  }

  return "audio/webm";
};

const transcribeSarvamRecording = async ({
  apiKey,
  audioBlob,
  durationSeconds,
}: {
  readonly apiKey?: string;
  readonly audioBlob: Blob;
  readonly durationSeconds: number;
}): Promise<unknown> => {
  if (audioBlob.size === 0) {
    console.warn("Sarvam STT skipped because the recording was empty.");
    return null;
  }

  if (apiKey === undefined || apiKey.length === 0) {
    console.warn("Sarvam STT skipped because NEXT_PUBLIC_SARVAM_API_KEY is not set.");
    return null;
  }

  const fileName = createSarvamAudioFileName(audioBlob.type);
  const result = durationSeconds < SARVAM_SHORT_AUDIO_MAX_SECONDS
    ? await transcribeShortSarvamAudio({ apiKey, audioBlob, fileName })
    : await transcribeBatchSarvamAudio({ apiKey, audioBlob, fileName });

  return result;
};

const extractSarvamTranscript = (result: unknown): string | null => {
  if (typeof result === "string") {
    const trimmed = result.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  if (Array.isArray(result)) {
    const joined = result
      .map((item) => extractSarvamTranscript(item))
      .filter((transcript): transcript is string => transcript !== null)
      .join("\n")
      .trim();

    return joined.length === 0 ? null : joined;
  }

  if (typeof result !== "object" || result === null) {
    return null;
  }

  const record = result as Record<string, unknown>;

  if (typeof record["transcript"] === "string") {
    const transcript = record["transcript"].trim();
    return transcript.length === 0 ? null : transcript;
  }

  if ("output" in record) {
    return extractSarvamTranscript(record["output"]);
  }

  if (Array.isArray(record["transcripts"])) {
    return extractSarvamTranscript(record["transcripts"]);
  }

  return null;
};

const transcribeShortSarvamAudio = async ({
  apiKey,
  audioBlob,
  fileName,
}: {
  readonly apiKey: string;
  readonly audioBlob: Blob;
  readonly fileName: string;
}): Promise<unknown> => {
  const formData = new FormData();
  formData.set("model", SARVAM_STT_MODEL);
  formData.set("mode", SARVAM_STT_MODE);
  formData.set("file", audioBlob, fileName);

  const response = await fetch(`${SARVAM_API_BASE_URL}/speech-to-text`, {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey,
    },
    body: formData,
  });

  return readSarvamJsonResponse(response);
};

const transcribeBatchSarvamAudio = async ({
  apiKey,
  audioBlob,
  fileName,
}: {
  readonly apiKey: string;
  readonly audioBlob: Blob;
  readonly fileName: string;
}): Promise<unknown> => {
  const initResponse = await sarvamJsonFetch<SarvamBatchInitResponse>("/speech-to-text/job/v1", apiKey, {
    method: "POST",
    body: JSON.stringify({
      job_parameters: {
        model: SARVAM_STT_MODEL,
        mode: SARVAM_STT_MODE,
      },
    }),
  });
  const jobId = initResponse.job_id;
  const uploadLinksResponse = await sarvamJsonFetch<SarvamUploadLinksResponse>(
    "/speech-to-text/job/v1/upload-files",
    apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        job_id: jobId,
        files: [fileName],
      }),
    },
  );
  const uploadUrl = getSarvamSignedUrl(uploadLinksResponse.upload_urls, fileName);
  const uploadHeaders = createSarvamUploadHeaders(
    uploadUrl.file_metadata,
    audioBlob.type,
    uploadLinksResponse.storage_container_type,
  );
  const uploadResponse = await fetch(uploadUrl.file_url, {
    method: "PUT",
    headers: uploadHeaders,
    body: audioBlob,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Sarvam batch upload failed with ${uploadResponse.status}: ${await uploadResponse.text()}`);
  }

  await sarvamJsonFetch(`/speech-to-text/job/v1/${encodeURIComponent(jobId)}/start`, apiKey, {
    method: "POST",
    body: JSON.stringify({}),
  });

  const status = await waitForSarvamBatchJob(apiKey, jobId);
  const outputFileNames = getSarvamOutputFileNames(status);
  const downloadLinksResponse = await sarvamJsonFetch<SarvamDownloadLinksResponse>(
    "/speech-to-text/job/v1/download-files",
    apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        job_id: jobId,
        files: outputFileNames,
      }),
    },
  );

  return Promise.all(outputFileNames.map(async (outputFileName) => {
    const downloadUrl = getSarvamSignedUrl(downloadLinksResponse.download_urls, outputFileName);
    const response = await fetch(downloadUrl.file_url);

    if (!response.ok) {
      throw new Error(`Sarvam batch download failed with ${response.status}: ${await response.text()}`);
    }

    return {
      fileName: outputFileName,
      output: await readPossiblyJsonResponse(response),
    };
  }));
};

const waitForSarvamBatchJob = async (
  apiKey: string,
  jobId: string,
): Promise<SarvamBatchStatusResponse> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SARVAM_BATCH_TIMEOUT_MS) {
    const status = await sarvamJsonFetch<SarvamBatchStatusResponse>(
      `/speech-to-text/job/v1/${encodeURIComponent(jobId)}/status`,
      apiKey,
      { method: "GET" },
    );

    if (status.job_state === "Completed") {
      return status;
    }

    if (status.job_state === "Failed") {
      throw new Error(status.error_message || "Sarvam batch speech-to-text job failed.");
    }

    await wait(SARVAM_BATCH_POLL_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for Sarvam batch speech-to-text job.");
};

const sarvamJsonFetch = async <ResponseBody,>(
  path: string,
  apiKey: string,
  init: RequestInit,
): Promise<ResponseBody> => {
  const response = await fetch(`${SARVAM_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "api-subscription-key": apiKey,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  return readSarvamJsonResponse(response) as Promise<ResponseBody>;
};

const readSarvamJsonResponse = async (response: Response): Promise<unknown> => {
  const body = await readPossiblyJsonResponse(response);

  if (!response.ok) {
    throw new Error(`Sarvam API failed with ${response.status}: ${formatSarvamResponseBody(body)}`);
  }

  return body;
};

const readPossiblyJsonResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();

  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const formatSarvamResponseBody = (body: unknown): string => {
  if (typeof body === "string") {
    return body;
  }

  return JSON.stringify(body);
};

const getSarvamSignedUrl = (
  urls: Record<string, SarvamSignedUrlDetails>,
  fileName: string,
): SarvamSignedUrlDetails => {
  const url = urls[fileName] ?? Object.values(urls)[0];

  if (url === undefined) {
    throw new Error(`Sarvam did not return a signed URL for ${fileName}.`);
  }

  return url;
};

const createSarvamUploadHeaders = (
  metadata: Record<string, unknown> | null | undefined,
  contentType: string,
  storageContainerType: string | undefined,
): Headers => {
  const headers = new Headers();

  if (metadata !== null && metadata !== undefined) {
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== null && value !== undefined) {
        headers.set(key, String(value));
      }
    }
  }

  if (!headers.has("Content-Type") && contentType.length > 0) {
    headers.set("Content-Type", contentType);
  }

  if (storageContainerType?.toLowerCase().startsWith("azure") === true && !headers.has("x-ms-blob-type")) {
    headers.set("x-ms-blob-type", "BlockBlob");
  }

  return headers;
};

const getSarvamOutputFileNames = (status: SarvamBatchStatusResponse): string[] => {
  const outputFileNames = status.job_details
    ?.filter((detail) => detail.state === undefined || detail.state === "Success")
    .flatMap((detail) => detail.outputs ?? [])
    .map((output) => output.file_name)
    .filter((fileName) => fileName.length > 0) ?? [];

  if (outputFileNames.length === 0) {
    const failedDetail = status.job_details?.find((detail) => detail.error_message !== null && detail.error_message !== undefined);
    throw new Error(failedDetail?.error_message ?? "Sarvam batch job completed without an output file.");
  }

  return outputFileNames;
};

const createSarvamAudioFileName = (mimeType: string): string => {
  const extension = getAudioFileExtension(mimeType);
  return `heysnap-recording-${Date.now()}.${extension}`;
};

const getAudioFileExtension = (mimeType: string): string => {
  const normalizedMimeType = mimeType.toLowerCase();

  if (normalizedMimeType.includes("ogg")) {
    return "ogg";
  }

  if (normalizedMimeType.includes("mp4")) {
    return "m4a";
  }

  if (normalizedMimeType.includes("mpeg") || normalizedMimeType.includes("mp3")) {
    return "mp3";
  }

  if (normalizedMimeType.includes("wav")) {
    return "wav";
  }

  return "webm";
};

const wait = (durationMs: number): Promise<void> => new Promise((resolve) => {
  window.setTimeout(resolve, durationMs);
});

const FinderBody = ({
  error,
  isLoading,
  entries,
  selectedPaths,
  renamingPath,
  onSelect,
  onSelectionChange,
  onActivate,
  onBackgroundClick,
  onCreateNewFolder,
  onUploadFiles,
  onUploadFolder,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onOpenEntry,
  onGetInfo,
  onTrashEntries,
  onDownloadEntries,
}: {
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly entries: FilesystemEntry[];
  readonly selectedPaths: string[];
  readonly renamingPath: string | null;
  readonly onSelect: (entry: FilesystemEntry, event: React.MouseEvent) => void;
  readonly onSelectionChange: (paths: string[]) => void;
  readonly onActivate: (entry: FilesystemEntry) => void;
  readonly onBackgroundClick: () => void;
  readonly onCreateNewFolder: () => void;
  readonly onUploadFiles: () => void;
  readonly onUploadFolder: () => void;
  readonly onRenameStart: (entry: FilesystemEntry) => void;
  readonly onRenameCommit: (entry: FilesystemEntry, nextName: string) => void;
  readonly onRenameCancel: () => void;
  readonly onOpenEntry: (entry: FilesystemEntry) => void;
  readonly onGetInfo: (entry: FilesystemEntry) => void;
  readonly onTrashEntries: (entries: readonly FilesystemEntry[]) => void;
  readonly onDownloadEntries: (entries: readonly FilesystemEntry[]) => void;
}): React.ReactElement => {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const didDragSelectRef = useRef(false);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const selectionBox = selectionRect === null ? null : getNormalizedSelectionBox(selectionRect);

  useEffect(() => {
    if (contextMenu === null) {
      return;
    }

    const closeMenu = (): void => {
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        selectedPaths.length === 0 ||
        renamingPath !== null ||
        (event.key !== "Delete" && event.key !== "Backspace") ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      const selectedEntries = entries.filter((entry) => selectedPaths.includes(entry.path));

      if (selectedEntries.length === 0) {
        return;
      }

      event.preventDefault();
      setContextMenu(null);
      onTrashEntries(selectedEntries);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [entries, onTrashEntries, renamingPath, selectedPaths]);

  if (isLoading) {
    return <FinderEmptyState message="Loading folder..." />;
  }

  if (error !== null) {
    return <FinderEmptyState message={error} variant="error" />;
  }

  const isEmpty = entries.length === 0;

  return (
    <div
      ref={bodyRef}
      className={isEmpty ? "finder-body tiles empty" : "finder-body tiles"}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }

        const target = event.target;

        if (target instanceof Element && target.closest(".finder-item")) {
          return;
        }

        const body = bodyRef.current;

        if (body === null) {
          return;
        }

        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = getContentPoint(event, body);
        setSelectionRect({
          originX: point.x,
          originY: point.y,
          currentX: point.x,
          currentY: point.y,
        });
        didDragSelectRef.current = false;
        onSelectionChange([]);
      }}
      onPointerMove={(event) => {
        const body = bodyRef.current;

        if (selectionRect === null || body === null) {
          return;
        }

        const point = getContentPoint(event, body);
        const nextRect = {
          ...selectionRect,
          currentX: point.x,
          currentY: point.y,
        };

        setSelectionRect(nextRect);
        didDragSelectRef.current =
          Math.abs(nextRect.currentX - nextRect.originX) > 3 ||
          Math.abs(nextRect.currentY - nextRect.originY) > 3;
        onSelectionChange(getIntersectingEntryPaths(body, getNormalizedSelectionBox(nextRect)));
      }}
      onPointerUp={(event) => {
        if (selectionRect === null) {
          return;
        }

        event.currentTarget.releasePointerCapture(event.pointerId);
        setSelectionRect(null);
      }}
      onPointerCancel={() => {
        setSelectionRect(null);
      }}
      onContextMenu={(event) => {
        const target = event.target;

        if (target instanceof Element && target.closest(".finder-item")) {
          return;
        }

        event.preventDefault();
        setContextMenu({
          kind: "background",
          ...getContextMenuPosition(event.clientX, event.clientY, BACKGROUND_CONTEXT_MENU_HEIGHT),
        });
        onBackgroundClick();
      }}
      onClick={(event) => {
        if (didDragSelectRef.current) {
          didDragSelectRef.current = false;
          return;
        }

        if (event.target === event.currentTarget) {
          onBackgroundClick();
        }
      }}
    >
      {isEmpty ? (
        <div className="finder-empty-inline">
          <p>This folder is empty.</p>
        </div>
      ) : (
        <FinderTiles
          entries={entries}
          selectedPaths={selectedPaths}
          renamingPath={renamingPath}
          onSelect={onSelect}
          onContextMenu={(entry, event) => {
            event.preventDefault();
            event.stopPropagation();

            if (selectedPaths.length > 1 && selectedPaths.includes(entry.path)) {
              const selectedEntries = entries.filter((currentEntry) => selectedPaths.includes(currentEntry.path));

              setContextMenu({
                kind: "selection",
                ...getContextMenuPosition(event.clientX, event.clientY, MULTI_ENTRY_CONTEXT_MENU_HEIGHT),
                entries: selectedEntries,
              });
              return;
            }

            onSelect(entry, event);
            setContextMenu({
              kind: "entry",
              ...getContextMenuPosition(event.clientX, event.clientY, ENTRY_CONTEXT_MENU_HEIGHT),
              entry,
            });
          }}
          onActivate={onActivate}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
        />
      )}
      {contextMenu === null ? null : contextMenu.kind === "background" ? (
        <DesktopContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onCreateNewFolder={() => {
            setContextMenu(null);
            onCreateNewFolder();
          }}
          onUploadFiles={() => {
            setContextMenu(null);
            onUploadFiles();
          }}
          onUploadFolder={() => {
            setContextMenu(null);
            onUploadFolder();
          }}
        />
      ) : contextMenu.kind === "entry" ? (
        <DesktopEntryContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          onOpen={(entry) => {
            setContextMenu(null);
            onOpenEntry(entry);
          }}
          onRename={(entry) => {
            setContextMenu(null);
            onRenameStart(entry);
          }}
          onGetInfo={(entry) => {
            setContextMenu(null);
            onGetInfo(entry);
          }}
          onTrash={(entry) => {
            setContextMenu(null);
            onTrashEntries([entry]);
          }}
          onDownload={(entry) => {
            setContextMenu(null);
            onDownloadEntries([entry]);
          }}
        />
      ) : (
        <DesktopSelectionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entries={contextMenu.entries}
          onTrash={(selectedEntries) => {
            setContextMenu(null);
            onTrashEntries(selectedEntries);
          }}
          onDownload={(selectedEntries) => {
            setContextMenu(null);
            onDownloadEntries(selectedEntries);
          }}
        />
      )}
      {selectionBox === null ? null : (
        <div
          className="selection-rectangle"
          style={{
            left: selectionBox.left,
            top: selectionBox.top,
            width: selectionBox.width,
            height: selectionBox.height,
          }}
        />
      )}
    </div>
  );
};

const FinderTiles = ({
  entries,
  selectedPaths,
  renamingPath,
  onSelect,
  onContextMenu,
  onActivate,
  onRenameCommit,
  onRenameCancel,
}: {
  readonly entries: FilesystemEntry[];
  readonly selectedPaths: string[];
  readonly renamingPath: string | null;
  readonly onSelect: (entry: FilesystemEntry, event: React.MouseEvent) => void;
  readonly onContextMenu: (entry: FilesystemEntry, event: React.MouseEvent) => void;
  readonly onActivate: (entry: FilesystemEntry) => void;
  readonly onRenameCommit: (entry: FilesystemEntry, nextName: string) => void;
  readonly onRenameCancel: () => void;
}): React.ReactElement => (
  <div className="finder-tiles">
    {entries.map((entry) => (
      <FinderItem
        key={entry.path}
        entry={entry}
        isSelected={selectedPaths.includes(entry.path)}
        isRenaming={entry.path === renamingPath}
        onSelect={(event) => onSelect(entry, event)}
        onContextMenu={(event) => onContextMenu(entry, event)}
        onActivate={() => onActivate(entry)}
        onRenameCommit={(nextName) => onRenameCommit(entry, nextName)}
        onRenameCancel={onRenameCancel}
      />
    ))}
  </div>
);

const FinderEmptyState = ({
  message,
  variant = "info",
}: {
  readonly message: string;
  readonly variant?: "info" | "error";
}): React.ReactElement => (
  <div className="finder-empty">
    <p className={variant === "error" ? "error" : ""}>{message}</p>
  </div>
);

const FinderItem = ({
  entry,
  isSelected,
  isRenaming,
  onSelect,
  onContextMenu,
  onActivate,
  onRenameCommit,
  onRenameCancel,
}: {
  readonly entry: FilesystemEntry;
  readonly isSelected: boolean;
  readonly isRenaming: boolean;
  readonly onSelect: (event: React.MouseEvent) => void;
  readonly onContextMenu: (event: React.MouseEvent) => void;
  readonly onActivate: () => void;
  readonly onRenameCommit: (nextName: string) => void;
  readonly onRenameCancel: () => void;
}): React.ReactElement => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasCommittedRef = useRef(false);
  const [draftName, setDraftName] = useState(entry.name);

  useEffect(() => {
    setDraftName(entry.name);
    hasCommittedRef.current = false;
  }, [entry.name, isRenaming]);

  useEffect(() => {
    if (!isRenaming) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isRenaming]);

  const commitRename = (): void => {
    if (hasCommittedRef.current) {
      return;
    }

    hasCommittedRef.current = true;
    onRenameCommit(draftName);
  };

  return (
    <button
      type="button"
      onClick={(event) => {
        if (!isRenaming) {
          onSelect(event);
        }
      }}
      onDoubleClick={() => {
        if (!isRenaming) {
          onActivate();
        }
      }}
      onContextMenu={(event) => {
        if (!isRenaming) {
          onContextMenu(event);
        }
      }}
      onKeyDown={(event) => {
        if (isRenaming) {
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          onActivate();
        }
      }}
      className={isSelected ? "finder-item selected" : "finder-item"}
      data-entry-path={entry.path}
    >
      <div className="finder-item-icon">
        <EntryIcon entry={entry} />
      </div>
      {isRenaming ? (
        <input
          ref={inputRef}
          className="finder-rename-input"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              hasCommittedRef.current = true;
              onRenameCancel();
            }
          }}
          onBlur={commitRename}
        />
      ) : (
        <span className="finder-item-label" title={entry.name}>
          {entry.name}
        </span>
      )}
    </button>
  );
};

const DesktopContextMenu = ({
  x,
  y,
  onCreateNewFolder,
  onUploadFiles,
  onUploadFolder,
}: {
  readonly x: number;
  readonly y: number;
  readonly onCreateNewFolder: () => void;
  readonly onUploadFiles: () => void;
  readonly onUploadFolder: () => void;
}): React.ReactElement => (
  <div
    className="desktop-context-menu"
    style={{ left: x, top: y }}
    role="menu"
    onClick={(event) => event.stopPropagation()}
    onContextMenu={(event) => event.preventDefault()}
  >
    <button
      type="button"
      className="context-menu-item"
      role="menuitem"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onCreateNewFolder();
      }}
    >
      <HugeiconsIcon icon={FolderAddIcon} size={16} color="currentColor" strokeWidth={1.8} />
      <span>New Folder</span>
    </button>
    <div className="context-menu-separator" />
    <ContextMenuDummyItem icon={<InfoIcon />} label="Get Info" />
    <ContextMenuDummyItem label="Change Wallpaper" inset />
    <ContextMenuActionItem
      icon={<HugeiconsIcon icon={FileUploadIcon} size={16} color="currentColor" strokeWidth={1.8} />}
      label="Upload Files"
      onSelect={onUploadFiles}
    />
    <ContextMenuActionItem
      icon={<HugeiconsIcon icon={FolderUploadIcon} size={16} color="currentColor" strokeWidth={1.8} />}
      label="Upload Folder"
      onSelect={onUploadFolder}
    />
  </div>
);

const DesktopEntryContextMenu = ({
  x,
  y,
  entry,
  onOpen,
  onRename,
  onGetInfo,
  onTrash,
  onDownload,
}: {
  readonly x: number;
  readonly y: number;
  readonly entry: FilesystemEntry;
  readonly onOpen: (entry: FilesystemEntry) => void;
  readonly onRename: (entry: FilesystemEntry) => void;
  readonly onGetInfo: (entry: FilesystemEntry) => void;
  readonly onTrash: (entry: FilesystemEntry) => void;
  readonly onDownload: (entry: FilesystemEntry) => void;
}): React.ReactElement => (
  <div
    className="desktop-context-menu"
    style={{ left: x, top: y }}
    role="menu"
    onClick={(event) => event.stopPropagation()}
    onContextMenu={(event) => event.preventDefault()}
  >
    <ContextMenuActionItem icon={<ViewIcon />} label="Open" onSelect={() => onOpen(entry)} />
    <ContextMenuActionItem icon={<RenameIcon />} label="Rename" onSelect={() => onRename(entry)} />
    <ContextMenuActionItem icon={<InfoIcon />} label="Get Info" onSelect={() => onGetInfo(entry)} />
    <div className="context-menu-separator" />
    <ContextMenuActionItem icon={<TrashIcon />} label="Trash" onSelect={() => onTrash(entry)} />
    <ContextMenuActionItem
      icon={<HugeiconsIcon icon={Download05Icon} size={16} color="currentColor" strokeWidth={1.8} />}
      label="Download"
      onSelect={() => onDownload(entry)}
    />
  </div>
);

const DesktopSelectionContextMenu = ({
  x,
  y,
  entries,
  onTrash,
  onDownload,
}: {
  readonly x: number;
  readonly y: number;
  readonly entries: FilesystemEntry[];
  readonly onTrash: (entries: readonly FilesystemEntry[]) => void;
  readonly onDownload: (entries: readonly FilesystemEntry[]) => void;
}): React.ReactElement => (
  <div
    className="desktop-context-menu"
    style={{ left: x, top: y }}
    role="menu"
    onClick={(event) => event.stopPropagation()}
    onContextMenu={(event) => event.preventDefault()}
  >
    <ContextMenuActionItem icon={<TrashIcon />} label="Trash" onSelect={() => onTrash(entries)} />
    <ContextMenuActionItem
      icon={<HugeiconsIcon icon={Download05Icon} size={16} color="currentColor" strokeWidth={1.8} />}
      label="Download"
      onSelect={() => onDownload(entries)}
    />
  </div>
);

const ContextMenuActionItem = ({
  icon,
  label,
  onSelect,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onSelect: () => void;
}): React.ReactElement => (
  <button
    type="button"
    className="context-menu-item"
    role="menuitem"
    onPointerDown={(event) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect();
    }}
  >
    <span className="context-menu-icon" aria-hidden="true">
      {icon}
    </span>
    <span className="context-menu-label">{label}</span>
  </button>
);

const ContextMenuDummyItem = ({
  icon,
  label,
  arrow = false,
  inset = false,
}: {
  readonly icon?: React.ReactNode;
  readonly label: string;
  readonly arrow?: boolean;
  readonly inset?: boolean;
}): React.ReactElement => (
  <button type="button" className="context-menu-item disabled" role="menuitem" disabled>
    <span className="context-menu-icon" aria-hidden="true">
      {icon}
    </span>
    <span className={inset ? "context-menu-label inset" : "context-menu-label"}>{label}</span>
    {arrow ? <span className="context-menu-arrow">›</span> : null}
  </button>
);

const ChevronIcon = ({
  direction,
}: {
  readonly direction: "left" | "right";
}): React.ReactElement => {
  const rotate = direction === "left" ? 90 : -90;

  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      style={{ transform: `rotate(${rotate}deg)` }}
      aria-hidden="true"
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const Spinner = (): React.ReactElement => (
  <span className="spinner" role="status" aria-label="Loading" />
);

const EntryIcon = ({
  entry,
  size = 52,
}: {
  readonly entry: FilesystemEntry;
  readonly size?: number;
}): React.ReactElement => {
  const typedFileIconSrc = entry.type === "file" ? getTypedFileIconSrc(entry.name) : null;
  const src = getAssetSrc(entry.type === "directory" ? folderIconSrc : typedFileIconSrc ?? fileIconSrc);

  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className="entry-icon"
      style={{
        width: entry.type === "directory" ? 1.15 * size : 0.75 * size,
        height: size,
      }}
    />
  );
};

const getTypedFileIconSrc = (fileName: string): string | null => {
  if (isPdfFile(fileName)) {
    return getAssetSrc(pdfFileIconSrc);
  }

  if (isDocxFile(fileName)) {
    return getAssetSrc(docxFileIconSrc);
  }

  if (isSpreadsheetFile(fileName)) {
    return getAssetSrc(xlsxFileIconSrc);
  }

  return null;
};

const getAssetSrc = (asset: unknown): string => {
  if (typeof asset === "string") {
    return asset;
  }

  if (
    typeof asset === "object" &&
    asset !== null &&
    "src" in asset &&
    typeof (asset as { readonly src: unknown }).src === "string"
  ) {
    return (asset as { readonly src: string }).src;
  }

  return "";
};

const IconPath = ({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    {children}
  </svg>
);

const ViewIcon = (): React.ReactElement => (
  <IconPath>
    <path
      d="M3.5 12s3-5.5 8.5-5.5S20.5 12 20.5 12s-3 5.5-8.5 5.5S3.5 12 3.5 12Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z" stroke="currentColor" strokeWidth="1.7" />
  </IconPath>
);

const RenameIcon = (): React.ReactElement => (
  <IconPath>
    <path d="M4 17.5h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path
      d="M5 15.5 15.7 4.8a2.1 2.1 0 0 1 3 3L8 18.5l-4 .9 1-3.9Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </IconPath>
);

const TrashIcon = (): React.ReactElement => (
  <IconPath>
    <path d="M5 7h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M7 7.5 8 19a2 2 0 0 0 2 1.8h4a2 2 0 0 0 2-1.8l1-11.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M10.5 11v5.5M13.5 11v5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </IconPath>
);

const InfoIcon = (): React.ReactElement => (
  <IconPath>
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 11v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M12 8h.01" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
  </IconPath>
);

const CloseIcon = (): React.ReactElement => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path
      d="m3.2 3.2 5.6 5.6M8.8 3.2 3.2 8.8"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
);

const getContentPoint = (
  event: React.PointerEvent<HTMLElement>,
  container: HTMLElement,
): { readonly x: number; readonly y: number } => {
  const rect = container.getBoundingClientRect();

  return {
    x: event.clientX - rect.left + container.scrollLeft,
    y: event.clientY - rect.top + container.scrollTop,
  };
};

const getNormalizedSelectionBox = (rect: SelectionRect): SelectionBox => {
  const left = Math.min(rect.originX, rect.currentX);
  const top = Math.min(rect.originY, rect.currentY);
  const right = Math.max(rect.originX, rect.currentX);
  const bottom = Math.max(rect.originY, rect.currentY);

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
};

const getIntersectingEntryPaths = (container: HTMLElement, selectionBox: SelectionBox): string[] => {
  const containerRect = container.getBoundingClientRect();

  return [...container.querySelectorAll<HTMLElement>(".finder-item[data-entry-path]")]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const box = {
        left: rect.left - containerRect.left + container.scrollLeft,
        top: rect.top - containerRect.top + container.scrollTop,
        right: rect.right - containerRect.left + container.scrollLeft,
        bottom: rect.bottom - containerRect.top + container.scrollTop,
      };

      return (
        box.left < selectionBox.right &&
        box.right > selectionBox.left &&
        box.top < selectionBox.bottom &&
        box.bottom > selectionBox.top
      );
    })
    .map((element) => element.dataset.entryPath)
    .filter((path): path is string => typeof path === "string");
};

const getContextMenuPosition = (
  clientX: number,
  clientY: number,
  menuHeight: number,
): { readonly x: number; readonly y: number } => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  return {
    x: Math.min(clientX, viewportWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_VIEWPORT_MARGIN),
    y: Math.min(clientY, viewportHeight - menuHeight - CONTEXT_MENU_VIEWPORT_MARGIN),
  };
};

const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
};

const isFilesystemEntry = (value: unknown): value is FilesystemEntry => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record["name"] === "string" &&
    typeof record["path"] === "string" &&
    (record["type"] === "file" || record["type"] === "directory")
  );
};

const toOpenFileTab = (entry: FilesystemEntry): OpenFileTab => ({
  name: entry.name,
  path: entry.path,
  size: entry.size,
  updatedAt: entry.updatedAt,
});

const normalizeOpenFilePath = (rawPath: string): string | null => {
  const path = rawPath.trim().replaceAll("\\", "/");
  if (path.length === 0 || path.includes("\0")) {
    return null;
  }

  if (path.startsWith("/")) {
    if (path === "/workspace") {
      return "";
    }
    if (path.startsWith("/workspace/")) {
      const relativePath = path.slice("/workspace/".length);
      return !relativePath.split("/").includes("..") ? relativePath : null;
    }

    const desktopIndex = path.indexOf("/Desktop/");
    if (desktopIndex < 0) {
      return null;
    }

    const relativePath = path.slice(desktopIndex + "/Desktop/".length);
    return relativePath.length > 0 && !relativePath.split("/").includes("..") ? relativePath : null;
  }

  const relativePath = path;
  if (relativePath.startsWith("/") || relativePath.split("/").includes("..")) {
    return null;
  }

  return relativePath;
};

const getParentPath = (path: string): string => {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "";
  }

  return parts.slice(0, -1).join("/");
};

const toFilesystemUploadFile = async (source: Extract<BrowserUploadSource, { readonly type: "file" }>): Promise<FilesystemUploadFile> => ({
  type: "file",
  relativePath: source.relativePath,
  contentBase64: arrayBufferToBase64(await source.file.arrayBuffer()),
  updatedAt: Number.isFinite(source.file.lastModified) ? new Date(source.file.lastModified).toISOString() : undefined,
});

const getDirectoryUploadSources = async (directoryHandle: BrowserDirectoryHandle): Promise<BrowserUploadSource[]> => {
  const sources: BrowserUploadSource[] = [{
    type: "directory",
    relativePath: directoryHandle.name,
  }];

  await appendDirectoryUploadSources(directoryHandle, directoryHandle.name, sources);

  return sources;
};

const appendDirectoryUploadSources = async (
  directoryHandle: BrowserDirectoryHandle,
  relativePath: string,
  sources: BrowserUploadSource[],
): Promise<void> => {
  for await (const childHandle of directoryHandle.values()) {
    const childPath = `${relativePath}/${childHandle.name}`;

    if (childHandle.kind === "directory") {
      sources.push({
        type: "directory",
        relativePath: childPath,
      });
      await appendDirectoryUploadSources(childHandle as BrowserDirectoryHandle, childPath, sources);
      continue;
    }

    const file = await (childHandle as BrowserFileHandle).getFile();
    sources.push({
      type: "file",
      relativePath: childPath,
      file,
    });
  }
};

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

const getBrowserRelativePath = (file: File): string => {
  const relativePath = (file as File & { readonly webkitRelativePath?: string }).webkitRelativePath?.trim();

  return relativePath && relativePath.length > 0 ? relativePath : file.name;
};

const getUploadSelectionPaths = (
  directoryPath: string,
  files: readonly FilesystemUploadFile[],
): string[] => {
  const selectedTopLevelPaths = new Set<string>();

  files.forEach((file) => {
    const topLevelName = file.relativePath.split("/")[0];

    if (topLevelName !== undefined && topLevelName.length > 0) {
      selectedTopLevelPaths.add(joinClientPath(directoryPath, topLevelName));
    }
  });

  return [...selectedTopLevelPaths];
};

const joinClientPath = (directoryPath: string, name: string): string =>
  directoryPath.length === 0 ? name : `${directoryPath}/${name}`;

const isPdfFile = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith(".pdf");

const isDocxFile = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith(".docx");

const isSpreadsheetFile = (fileName: string): boolean =>
  /\.(xls|xlsx)$/iu.test(fileName);

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
};

const buildFilesystemDownloadUrl = (
  filesystemWebsocketUrl: string,
  paths: readonly string[],
): string => {
  const baseUrl = typeof window !== "undefined" && typeof window.location?.href === "string" ? window.location.href : "http://localhost";
  const url = new URL(filesystemWebsocketUrl, baseUrl);

  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  url.pathname = url.pathname.replace(/\/filesystem\/?$/u, "/filesystem/download");
  url.searchParams.delete("path");
  url.searchParams.delete("showHidden");
  url.searchParams.delete("v");
  paths.forEach((path) => {
    url.searchParams.append("path", path);
  });

  return url.toString();
};

const isBrowserNewTabUrl = (url: string | undefined): boolean => {
  if (url === undefined || url.length === 0) {
    return true;
  }

  return url === "about:blank" || url === "chrome://newtab" || url === "chrome://newtab/";
};

const toBrowserViewportKeyboardInput = (
  tabId: number,
  event: KeyboardEvent,
): BrowserViewportKeyboardInput | null => {
  if (event.type !== "keydown" && event.type !== "keyup") {
    return null;
  }

  return {
    altKey: event.altKey,
    code: event.code,
    ctrlKey: event.ctrlKey,
    key: event.key,
    keyCode: event.keyCode,
    location: event.location,
    metaKey: event.metaKey,
    repeat: event.repeat,
    shiftKey: event.shiftKey,
    tabId,
    text: getBrowserKeyboardText(event),
    type: event.type === "keydown" ? "keyDown" : "keyUp",
  };
};

const getBrowserKeyboardText = (event: KeyboardEvent): string | undefined => {
  if (event.type !== "keydown" || event.ctrlKey || event.metaKey || event.altKey) {
    return undefined;
  }

  if (event.key.length === 1) {
    return event.key;
  }

  return event.key === "Enter" ? "\r" : undefined;
};

const getBrowserViewportInputPoint = (
  viewport: HTMLDivElement,
  clientX: number,
  clientY: number,
): BrowserViewportInputPoint | null => {
  const image = viewport.querySelector("img");
  const rect = getBrowserViewportInputRect(viewport);

  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const naturalWidth = image?.naturalWidth || rect.width;
  const naturalHeight = image?.naturalHeight || rect.height;

  return {
    x: clampNumber(((clientX - rect.left) / rect.width) * naturalWidth, 0, naturalWidth),
    y: clampNumber(((clientY - rect.top) / rect.height) * naturalHeight, 0, naturalHeight),
  };
};

const getBrowserViewportInputRatio = (
  viewport: HTMLDivElement,
  clientX: number,
  clientY: number,
): BrowserViewportInputPoint | null => {
  const rect = getBrowserViewportInputRect(viewport);

  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return {
    x: clampNumber((clientX - rect.left) / rect.width, 0, 1),
    y: clampNumber((clientY - rect.top) / rect.height, 0, 1),
  };
};

const getBrowserViewportInputRect = (viewport: HTMLDivElement): DOMRectReadOnly => {
  const image = viewport.querySelector("img");

  if (image === null || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    return viewport.getBoundingClientRect();
  }

  const rect = image.getBoundingClientRect();
  const objectFit = window.getComputedStyle(image).objectFit;

  if (objectFit !== "contain" && objectFit !== "cover" && objectFit !== "scale-down") {
    return rect;
  }

  const naturalAspectRatio = image.naturalWidth / image.naturalHeight;
  const renderedAspectRatio = rect.width / rect.height;
  const shouldFitWidth = objectFit === "cover"
    ? renderedAspectRatio > naturalAspectRatio
    : renderedAspectRatio < naturalAspectRatio;
  const width = shouldFitWidth ? rect.width : rect.height * naturalAspectRatio;
  const height = shouldFitWidth ? rect.width / naturalAspectRatio : rect.height;

  return new DOMRectReadOnly(
    rect.left + ((rect.width - width) / 2),
    rect.top + ((rect.height - height) / 2),
    width,
    height,
  );
};

const readBrowserFrameAspectRatio = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0.1 && value < 10 ? value : null;

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return window.btoa(binary);
};
