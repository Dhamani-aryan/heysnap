"use client";

import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowLeft02Icon,
  Download05Icon,
  File02Icon,
  FileUploadIcon,
  FolderAddIcon,
  Folder01Icon,
  FolderUploadIcon,
  Moon02Icon,
  PlugSocketIcon,
  PowerIcon,
  Search01Icon,
  SidebarRightIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentPanel } from "../agent/agent-panel";
import { useAgentThreadGroupsQuery } from "../agent/agent-queries";
import {
  AgentRuntimeProvider,
  useAgentChatStore,
  useAgentThreadListStore,
  useOptionalAgentRuntime,
} from "../agent/agent-runtime";
import { selectHasThreads } from "../agent/agent-thread-list-store";
import type { AgentThreadGroup, AgentThreadSummary, AgentUiContext } from "../agent/types";
import { CapabilitiesPanel } from "../cloud/capabilities-panel";
import docxFileIconSrc from "../../../../apps/assets/files/docx_file_icon.png";
import pdfFileIconSrc from "../../../../apps/assets/files/pdf_file_icon.png";
import xlsxFileIconSrc from "../../../../apps/assets/files/xlsx_file_icon.png";
import fileIconSrc from "./assets/macos/File.png";
import folderIconSrc from "./assets/macos/Folder.png";
import { FilesystemClient, type FilesystemConnectionStatus } from "./filesystem-client";
import type { FilesystemEntry, FilesystemListing, FilesystemUploadFile } from "./types";

const HeySnapAudioPlayer = lazy(() =>
  import("heysnap-web-viewers/audio").then((module) => ({ default: module.HeySnapAudioPlayer })),
);
const HeySnapCodeViewer = lazy(() =>
  import("heysnap-web-viewers/code").then((module) => ({ default: module.HeySnapCodeViewer })),
);
const HeySnapDocxViewer = lazy(() =>
  import("heysnap-web-viewers/docx").then((module) => ({ default: module.HeySnapDocxViewer })),
);
const HeySnapHtmlViewer = lazy(() =>
  import("heysnap-web-viewers/html").then((module) => ({ default: module.HeySnapHtmlViewer })),
);
const HeySnapImageViewer = lazy(() =>
  import("heysnap-web-viewers/image").then((module) => ({ default: module.HeySnapImageViewer })),
);
const HeySnapMarkdownViewer = lazy(() =>
  import("heysnap-web-viewers/markdown").then((module) => ({ default: module.HeySnapMarkdownViewer })),
);
const HeySnapPdfViewer = lazy(() =>
  import("heysnap-web-viewers/pdf").then((module) => ({ default: module.HeySnapPdfViewer })),
);
const HeySnapPPTViewer = lazy(() =>
  import("heysnap-web-viewers/ppt").then((module) => ({ default: module.HeySnapPPTViewer })),
);
const HeySnapVideoViewer = lazy(() =>
  import("heysnap-web-viewers/video").then((module) => ({ default: module.HeySnapVideoViewer })),
);
const HeySnapXlsxViewer = lazy(() =>
  import("heysnap-web-viewers/xlsx").then((module) => ({ default: module.HeySnapXlsxViewer })),
);

const HISTORY_LIMIT = 64;
const DEFAULT_LEFT_PANE_RATIO = 0.5;
const MIN_PANE_RATIO = 0.25;
const MAX_PANE_RATIO = 0.75;
const LEFT_PANE_RATIO_STORAGE_KEY = "filesystem-explorer:left-pane-ratio";
const RIGHT_SIDEBAR_OPEN_STORAGE_KEY = "filesystem-explorer:right-sidebar-open";
const PPT_VIEWER_SERVER_URL = "http://13.126.207.124/Kd5QihM3zhwV2WztLXAnBc6n07Goa6O3mByrs-rqWjU/ppt";
const XLSX_ASSET_ID_HEADER = "x-heysnap-xlsx-asset-id";
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
  readonly agentBaseUrl?: string;
  readonly capabilitiesBaseUrl?: string;
  readonly selectedThreadId?: string | null;
  readonly workspacePanel?: WorkspacePanel;
  readonly initialPath?: string;
  readonly machineName?: string;
  readonly canSleepMachine?: boolean;
  readonly onFilesystemOpen?: () => void;
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
  agentBaseUrl = "http://localhost:4000/agent",
  capabilitiesBaseUrl,
  selectedThreadId = null,
  workspacePanel,
  initialPath,
  machineName = "Machine",
  canSleepMachine = true,
  onFilesystemOpen,
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
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [openFileTabs, setOpenFileTabs] = useState<OpenFileTab[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<FilesystemConnectionStatus>("connecting");
  const [internalWorkspacePanel, setInternalWorkspacePanel] = useState<WorkspacePanel>("chat");
  const activeWorkspacePanel = workspacePanel ?? internalWorkspacePanel;
  const currentPath = listing?.path ?? "";
  const currentDirectoryName = listing?.name ?? "workspace";
  const activeFileTab = activeFilePath === null
    ? null
    : openFileTabs.find((tab) => tab.path === activeFilePath) ?? null;
  const openFileWatchKey = useMemo(
    () => openFileTabs.map((tab) => tab.path).sort((left, right) => left.localeCompare(right)).join("\0"),
    [openFileTabs],
  );
  const agentUiContext = useMemo<AgentUiContext>(() => ({
    openFiles: openFileTabs.map((tab) => ({
      path: tab.path,
      isFocused: tab.path === activeFilePath,
    })),
  }), [activeFilePath, openFileTabs]);
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
    if (activeFilePath === null || openFileTabs.length < 2) {
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
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeFilePath, openFileTabs]);

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
      onFileUpdates: ({ entries }) => {
        setOpenFileTabs((currentTabs) => syncOpenFileTabsFromEntries(currentTabs, entries));
      },
      onViewState: (viewState) => {
        setOpenFileTabs(viewState.openFiles.map(toOpenFileTab));
        setActiveFilePath(null);
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

    void clientRef.current?.watchFiles(paths).catch((error) => {
      setListingError(toListingErrorMessage(error instanceof Error ? error.message : "Failed to watch open files."));
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

  const handleNewThread = useCallback((): void => {
    showChatPanel();
    onNewThread?.();
  }, [onNewThread, showChatPanel]);

  const handleSelectThread = useCallback((thread: AgentThreadSummary): void => {
    showChatPanel();
    onSelectThread?.(thread);
  }, [onSelectThread, showChatPanel]);

  const subscribeTo = useCallback(async (
    nextPath: string,
    shouldPushHistory: boolean,
  ): Promise<FilesystemListing | undefined> => {
    setIsFetching(true);
    setListingError(null);
    setActiveFilePath(null);
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

        return nextTabs[closedIndex]?.path ?? nextTabs[closedIndex - 1]?.path ?? null;
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
        currentActivePath !== null && pathsToTrash.includes(currentActivePath) ? null : currentActivePath,
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
          onToggleRightSidebar={() => setIsRightSidebarOpen((current) => !current)}
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
        onNewThread={handleNewThread}
        isRightSidebarOpen={isRightSidebarOpen}
        onToggleRightSidebar={() => setIsRightSidebarOpen((current) => !current)}
        openFileTabs={openFileTabs}
        activeFilePath={activeFileTab?.path ?? null}
        onShowDirectory={() => setActiveFilePath(null)}
        onSelectFileTab={setActiveFilePath}
        onCloseFileTab={closeFileTab}
      />

      <DesktopSplitPane
        leftPaneRatio={leftPaneRatio}
        onLeftPaneRatioChange={handleLeftPaneRatioChange}
        agentBaseUrl={agentBaseUrl}
        selectedThreadId={selectedThreadId}
        currentPath={currentPath}
        currentDirectoryName={currentDirectoryName}
        workspacePanel={activeWorkspacePanel}
        capabilitiesBaseUrl={capabilitiesBaseUrl}
        uiContext={agentUiContext}
        onOpenFilePath={openFilePath}
        onSelectThread={handleSelectThread}
        onThreadResolved={onThreadResolved}
      >
        <div className="left-pane-surface-stack">
          <div
            className={activeFileTab === null ? "left-pane-surface active" : "left-pane-surface inactive"}
            aria-hidden={activeFileTab !== null}
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
          <FileViewerStack
            openFileTabs={openFileTabs}
            activeFilePath={activeFileTab?.path ?? null}
            websocketUrl={websocketUrl}
          />
        </div>
        <MachineStatusControl
          canSleepMachine={canSleepMachine}
          compact={activeFileTab !== null}
          machineName={machineName}
          status={connectionStatus}
          onBack={onBackToMachines}
          onSleep={onSleepMachine}
        />
      </DesktopSplitPane>
      {rightSidebar}
      {uploadProgress === null ? null : <UploadProgressDialog progress={uploadProgress} />}
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

const FinderToolbar = ({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  title,
  isFetching,
  onNewThread,
  isRightSidebarOpen,
  onToggleRightSidebar,
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
  readonly onNewThread?: () => void;
  readonly isRightSidebarOpen: boolean;
  readonly onToggleRightSidebar: () => void;
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
          className={activeFilePath === null ? "directory-tab active" : "directory-tab"}
          onClick={onShowDirectory}
        >
          <span className="directory-tab-title">{title}</span>
        </button>

        <div className="tab-strip" role="tablist" aria-label="Open files">
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
  websocketUrl,
}: {
  readonly file: OpenFileTab;
  readonly websocketUrl: string;
}): React.ReactElement => {
  const fileVersion = getOpenFileTabVersion(file);

  if (isPdfFile(file.name)) {
    return (
      <PdfViewer
        fileName={file.name}
        fileUrl={buildFilesystemPreviewUrl(websocketUrl, file.path, "pdf", fileVersion)}
      />
    );
  }

  if (isDocxFile(file.name)) {
    return (
      <DocxViewer
        fileName={file.name}
        fileUrl={buildFilesystemDownloadUrl(websocketUrl, [file.path], fileVersion)}
      />
    );
  }

  if (isPptxFile(file.name)) {
    return (
      <PptViewer
        fileName={file.name}
        fileUrl={buildFilesystemDownloadUrl(websocketUrl, [file.path], fileVersion)}
      />
    );
  }

  if (isXlsxFile(file.name)) {
    return (
      <XlsxViewer
        fileName={file.name}
        xlsxUrl={buildFilesystemXlsxUrl(websocketUrl, file.path, fileVersion)}
      />
    );
  }

  if (isOfficePdfPreviewFile(file.name)) {
    return (
      <PdfViewer
        fileName={file.name}
        fileUrl={buildFilesystemPreviewUrl(websocketUrl, file.path, "pdf", fileVersion)}
      />
    );
  }

  if (isDelimitedTextFile(file.name)) {
    return (
      <DelimitedTextViewer
        fileName={file.name}
        fileUrl={buildFilesystemDownloadUrl(websocketUrl, [file.path], fileVersion)}
        delimiter={getDelimitedTextDelimiter(file.name)}
      />
    );
  }

  if (isImageFile(file.name)) {
    return (
      <ImageViewer
        fileName={file.name}
        fileUrl={buildFilesystemDownloadUrl(websocketUrl, [file.path], fileVersion)}
      />
    );
  }

  if (isMarkdownFile(file.name)) {
    return (
      <MarkdownViewer
        fileName={file.name}
        fileUrl={buildFilesystemDownloadUrl(websocketUrl, [file.path], fileVersion)}
      />
    );
  }

  if (isHtmlFile(file.name)) {
    return (
      <HtmlViewer
        fileName={file.name}
        fileUrl={buildFilesystemDownloadUrl(websocketUrl, [file.path], fileVersion)}
      />
    );
  }

  if (isCodeFile(file.name)) {
    return (
      <CodeViewer
        fileName={file.name}
        fileUrl={buildFilesystemDownloadUrl(websocketUrl, [file.path], fileVersion)}
      />
    );
  }

  if (isPlainTextFile(file.name)) {
    return (
      <PlainTextViewer
        fileName={file.name}
        fileUrl={buildFilesystemDownloadUrl(websocketUrl, [file.path], fileVersion)}
      />
    );
  }

  if (isAudioFile(file.name)) {
    return (
      <AudioViewer
        fileName={file.name}
        fileUrl={buildFilesystemDownloadUrl(websocketUrl, [file.path], fileVersion)}
      />
    );
  }

  if (isVideoFile(file.name)) {
    return (
      <VideoViewer
        fileName={file.name}
        fileUrl={buildFilesystemDownloadUrl(websocketUrl, [file.path], fileVersion)}
      />
    );
  }

  return <FileViewerPlaceholder file={file} />;
};

const MemoizedFileViewer = memo(FileViewer);

const FileViewerStack = ({
  openFileTabs,
  activeFilePath,
  websocketUrl,
}: {
  readonly openFileTabs: OpenFileTab[];
  readonly activeFilePath: string | null;
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
          <MemoizedFileViewer file={tab} websocketUrl={websocketUrl} />
        </div>
      );
    })}
  </>
);

const FileViewerPlaceholder = ({
  file,
}: {
  readonly file: OpenFileTab;
}): React.ReactElement => (
  <section className="file-viewer-placeholder" aria-label={file.name}>
    <h1>{file.name}</h1>
  </section>
);

const PdfViewer = ({
  fileName,
  fileUrl,
}: {
  readonly fileName: string;
  readonly fileUrl: string;
}): React.ReactElement => {
  const { file, error } = useFetchedViewerFile(fileName, fileUrl, "application/pdf");

  if (error !== null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message={error} variant="error" />
      </section>
    );
  }

  if (file === null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message="Loading PDF..." />
      </section>
    );
  }

  return (
    <section className="heysnap-document-viewer" aria-label={fileName}>
      <Suspense fallback={<DocumentViewerState message="Loading PDF viewer..." />}>
        <HeySnapPdfViewer
          src={file}
          bodyBackground="var(--heysnap-document-viewer-body-background)"
          headerBackground="var(--heysnap-document-viewer-header-background)"
          headerForeground="var(--heysnap-document-viewer-header-foreground)"
          sidebarBackground="var(--heysnap-document-viewer-sidebar-background)"
        />
      </Suspense>
    </section>
  );
};

const DocxViewer = ({
  fileName,
  fileUrl,
}: {
  readonly fileName: string;
  readonly fileUrl: string;
}): React.ReactElement => {
  const { file, error } = useFetchedViewerFile(
    fileName,
    fileUrl,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );

  if (error !== null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message={error} variant="error" />
      </section>
    );
  }

  if (file === null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message="Loading DOCX..." />
      </section>
    );
  }

  return (
    <section className="heysnap-document-viewer" aria-label={fileName}>
      <Suspense fallback={<DocumentViewerState message="Loading DOCX viewer..." />}>
        <HeySnapDocxViewer
          src={file}
          documentName={fileName}
          bodyBackground="var(--heysnap-document-viewer-body-background)"
          headerBackground="var(--heysnap-document-viewer-header-background)"
          headerForeground="var(--heysnap-document-viewer-header-foreground)"
        />
      </Suspense>
    </section>
  );
};

const PptViewer = ({
  fileName,
  fileUrl,
}: {
  readonly fileName: string;
  readonly fileUrl: string;
}): React.ReactElement => {
  const { file, error } = useFetchedViewerFile(
    fileName,
    fileUrl,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );

  if (error !== null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message={error} variant="error" />
      </section>
    );
  }

  if (file === null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message="Loading PPTX..." />
      </section>
    );
  }

  return (
    <section className="heysnap-document-viewer" aria-label={fileName}>
      <Suspense fallback={<DocumentViewerState message="Loading PPTX viewer..." />}>
        <HeySnapPPTViewer
          src={file}
          serverUrl={PPT_VIEWER_SERVER_URL}
          documentName={fileName}
          bodyBackground="var(--heysnap-document-viewer-body-background)"
          headerBackground="var(--heysnap-document-viewer-header-background)"
          headerForeground="var(--heysnap-document-viewer-header-foreground)"
          sidebarBackground="var(--heysnap-document-viewer-sidebar-background)"
        />
      </Suspense>
    </section>
  );
};

const XlsxViewer = ({
  fileName,
  xlsxUrl,
}: {
  readonly fileName: string;
  readonly xlsxUrl: string;
}): React.ReactElement => {
  const { workbook, error } = useFetchedXlsxWorkbook(xlsxUrl);
  const theme = useResolvedTheme();
  const className = [
    "heysnap-document-viewer",
    "heysnap-xlsx-viewer",
    theme === "dark" ? "theme-dark" : "theme-light",
  ].join(" ");

  if (error !== null) {
    return (
      <section className={className} aria-label={fileName}>
        <DocumentViewerState message={error} variant="error" />
      </section>
    );
  }

  if (workbook === null) {
    return (
      <section className={className} aria-label={fileName}>
        <DocumentViewerState message="Loading XLSX..." />
      </section>
    );
  }

  return (
    <section className={className} aria-label={fileName}>
      <Suspense fallback={<DocumentViewerState message="Loading XLSX viewer..." />}>
        <HeySnapXlsxViewer workbook={workbook} title={fileName} />
      </Suspense>
    </section>
  );
};

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

const useFetchedViewerFile = (
  fileName: string,
  fileUrl: string,
  fallbackMimeType: string,
): {
  readonly file: File | null;
  readonly error: string | null;
} => {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let isCancelled = false;

    setFile(null);
    setError(null);

    const fetchFile = async (): Promise<void> => {
      const response = await fetch(fileUrl, { signal: abortController.signal });

      if (!response.ok) {
        throw new Error(await readPreviewErrorMessage(response, fileUrl));
      }

      const blob = await response.blob();
      const mimeType = blob.type.length > 0 && blob.type !== "application/octet-stream"
        ? blob.type
        : fallbackMimeType;
      const viewerFile = new File([blob], fileName, {
        type: mimeType,
      });

      if (!isCancelled) {
        setFile(viewerFile);
      }
    };

    void fetchFile().catch((fetchError) => {
      if (!isCancelled && !isAbortError(fetchError)) {
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load file.");
      }
    });

    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [fallbackMimeType, fileName, fileUrl]);

  return { file, error };
};

const useFetchedXlsxWorkbook = (
  xlsxUrl: string,
): {
  readonly workbook: unknown | null;
  readonly error: string | null;
} => {
  const [workbook, setWorkbook] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let isCancelled = false;

    setWorkbook(null);
    setError(null);

    const fetchWorkbook = async (): Promise<void> => {
      const response = await fetch(xlsxUrl, { signal: abortController.signal });

      if (!response.ok) {
        throw new Error(await readPreviewErrorMessage(response, xlsxUrl));
      }

      const assetId = response.headers.get(XLSX_ASSET_ID_HEADER);

      if (assetId === null || assetId.length === 0) {
        throw new Error("Server did not return XLSX asset metadata.");
      }

      const parsedWorkbook = await response.json() as unknown;
      attachXlsxAssetUrls(parsedWorkbook, (assetPath) => buildFilesystemXlsxAssetUrl(xlsxUrl, assetId, assetPath));

      if (!isCancelled) {
        setWorkbook(parsedWorkbook);
      }
    };

    void fetchWorkbook().catch((fetchError) => {
      if (!isCancelled && !isAbortError(fetchError)) {
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load XLSX.");
      }
    });

    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [xlsxUrl]);

  return { workbook, error };
};

const DelimitedTextViewer = ({
  fileName,
  fileUrl,
  delimiter,
}: {
  readonly fileName: string;
  readonly fileUrl: string;
  readonly delimiter: "," | "\t";
}): React.ReactElement => {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let isCancelled = false;

    setRows(null);
    setError(null);

    const loadRows = async (): Promise<void> => {
      const response = await fetch(fileUrl, { signal: abortController.signal });

      if (!response.ok) {
        throw new Error(`Failed to load ${delimiter === "\t" ? "TSV" : "CSV"} (${String(response.status)}).`);
      }

      const text = await response.text();
      const parsedRows = parseDelimitedText(text, delimiter);

      if (!isCancelled) {
        setRows(parsedRows);
      }
    };

    void loadRows().catch((loadError) => {
      if (!isCancelled && !isAbortError(loadError)) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load file.");
      }
    });

    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [delimiter, fileUrl]);

  if (error !== null) {
    return (
      <section className="delimited-viewer" aria-label={fileName}>
        <DelimitedViewerState message={error} variant="error" />
      </section>
    );
  }

  if (rows === null) {
    return (
      <section className="delimited-viewer" aria-label={fileName}>
        <DelimitedViewerState message={`Loading ${delimiter === "\t" ? "TSV" : "CSV"}...`} />
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section className="delimited-viewer" aria-label={fileName}>
        <DelimitedViewerState message="This file is empty." />
      </section>
    );
  }

  const columnCount = Math.max(...rows.map((row) => row.length));

  return (
    <section className="delimited-viewer" aria-label={fileName}>
      <div className="delimited-table-wrap">
        <table className="delimited-table">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`row:${String(rowIndex)}`}>
                {Array.from({ length: columnCount }, (_, columnIndex) => (
                  <td key={`cell:${String(rowIndex)}:${String(columnIndex)}`}>
                    {row[columnIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const DelimitedViewerState = ({
  message,
  variant = "info",
}: {
  readonly message: string;
  readonly variant?: "info" | "error";
}): React.ReactElement => (
  <div className={variant === "error" ? "delimited-viewer-state error" : "delimited-viewer-state"}>
    <p>{message}</p>
  </div>
);

const ImageViewer = ({
  fileName,
  fileUrl,
}: {
  readonly fileName: string;
  readonly fileUrl: string;
}): React.ReactElement => {
  const { file, error } = useFetchedViewerFile(fileName, fileUrl, getImageMimeType(fileName));

  if (error !== null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message={error} variant="error" />
      </section>
    );
  }

  if (file === null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message="Loading image..." />
      </section>
    );
  }

  return (
    <section className="heysnap-document-viewer" aria-label={fileName}>
      <Suspense fallback={<DocumentViewerState message="Loading image viewer..." />}>
        <HeySnapImageViewer
          src={file}
          alt={fileName}
          documentName={fileName}
          bodyBackground="var(--heysnap-document-viewer-body-background)"
          headerBackground="var(--heysnap-document-viewer-header-background)"
          headerForeground="var(--heysnap-document-viewer-header-foreground)"
        />
      </Suspense>
    </section>
  );
};

const PlainTextViewer = ({
  fileName,
  fileUrl,
}: {
  readonly fileName: string;
  readonly fileUrl: string;
}): React.ReactElement => {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let isCancelled = false;

    setText(null);
    setError(null);

    const loadText = async (): Promise<void> => {
      const response = await fetch(fileUrl, { signal: abortController.signal });

      if (!response.ok) {
        throw new Error(`Failed to load text (${String(response.status)}).`);
      }

      const nextText = await response.text();

      if (!isCancelled) {
        setText(nextText);
      }
    };

    void loadText().catch((loadError) => {
      if (!isCancelled && !isAbortError(loadError)) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load text.");
      }
    });

    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [fileUrl]);

  if (error !== null) {
    return (
      <section className="text-viewer" aria-label={fileName}>
        <TextViewerState message={error} variant="error" />
      </section>
    );
  }

  if (text === null) {
    return (
      <section className="text-viewer" aria-label={fileName}>
        <TextViewerState message="Loading text..." />
      </section>
    );
  }

  return (
    <section className="text-viewer" aria-label={fileName}>
      <pre className="text-viewer-content">{text}</pre>
    </section>
  );
};

const TextViewerState = ({
  message,
  variant = "info",
}: {
  readonly message: string;
  readonly variant?: "info" | "error";
}): React.ReactElement => (
  <div className={variant === "error" ? "text-viewer-state error" : "text-viewer-state"}>
    <p>{message}</p>
  </div>
);

const CodeViewer = ({
  fileName,
  fileUrl,
}: {
  readonly fileName: string;
  readonly fileUrl: string;
}): React.ReactElement => {
  const { file, error } = useFetchedViewerFile(fileName, fileUrl, "text/plain");
  const theme = useResolvedTheme();

  if (error !== null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message={error} variant="error" />
      </section>
    );
  }

  if (file === null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message="Loading code..." />
      </section>
    );
  }

  return (
    <section className="heysnap-document-viewer" aria-label={fileName}>
      <Suspense fallback={<DocumentViewerState message="Loading code viewer..." />}>
        <HeySnapCodeViewer
          src={file}
          documentName={fileName}
          theme={theme === "dark" ? "heysnap-dark" : "heysnap-light"}
          headerBackground="var(--heysnap-document-viewer-header-background)"
          headerForeground="var(--heysnap-document-viewer-header-foreground)"
          bodyBackground="var(--heysnap-document-viewer-header-background)"
        />
      </Suspense>
    </section>
  );
};

const MarkdownViewer = ({
  fileName,
  fileUrl,
}: {
  readonly fileName: string;
  readonly fileUrl: string;
}): React.ReactElement => {
  const { file, error } = useFetchedViewerFile(fileName, fileUrl, "text/markdown");
  const theme = useResolvedTheme();

  if (error !== null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message={error} variant="error" />
      </section>
    );
  }

  if (file === null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message="Loading markdown..." />
      </section>
    );
  }

  return (
    <section className="heysnap-document-viewer" aria-label={fileName}>
      <Suspense fallback={<DocumentViewerState message="Loading markdown viewer..." />}>
        <HeySnapMarkdownViewer
          src={file}
          documentName={fileName}
          headerBackground="var(--heysnap-document-viewer-header-background)"
          headerForeground="var(--heysnap-document-viewer-header-foreground)"
          bodyBackground="var(--heysnap-document-viewer-header-background)"
          codeTheme={theme === "dark" ? "heysnap-dark" : "heysnap-light"}
        />
      </Suspense>
    </section>
  );
};

const HtmlViewer = ({
  fileName,
  fileUrl,
}: {
  readonly fileName: string;
  readonly fileUrl: string;
}): React.ReactElement => {
  const { file, error } = useFetchedViewerFile(fileName, fileUrl, "text/html");
  const theme = useResolvedTheme();

  if (error !== null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message={error} variant="error" />
      </section>
    );
  }

  if (file === null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message="Loading HTML..." />
      </section>
    );
  }

  return (
    <section className="heysnap-document-viewer" aria-label={fileName}>
      <Suspense fallback={<DocumentViewerState message="Loading HTML viewer..." />}>
        <HeySnapHtmlViewer
          src={file}
          documentName={fileName}
          headerBackground="var(--heysnap-document-viewer-header-background)"
          headerForeground="var(--heysnap-document-viewer-header-foreground)"
          bodyBackground="var(--heysnap-document-viewer-header-background)"
          codeTheme={theme === "dark" ? "heysnap-dark" : "heysnap-light"}
        />
      </Suspense>
    </section>
  );
};

const AudioViewer = ({
  fileName,
  fileUrl,
}: {
  readonly fileName: string;
  readonly fileUrl: string;
}): React.ReactElement => {
  const { file, error } = useFetchedViewerFile(fileName, fileUrl, getAudioMimeType(fileName));

  if (error !== null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message={error} variant="error" />
      </section>
    );
  }

  if (file === null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message="Loading audio..." />
      </section>
    );
  }

  return (
    <section className="heysnap-document-viewer" aria-label={fileName}>
      <Suspense fallback={<DocumentViewerState message="Loading audio player..." />}>
        <HeySnapAudioPlayer
          src={file}
          documentName={fileName}
          headerBackground="var(--heysnap-document-viewer-header-background)"
          headerForeground="var(--heysnap-document-viewer-header-foreground)"
          bodyBackground="var(--heysnap-document-viewer-sidebar-background)"
        />
      </Suspense>
    </section>
  );
};

const VideoViewer = ({
  fileName,
  fileUrl,
}: {
  readonly fileName: string;
  readonly fileUrl: string;
}): React.ReactElement => {
  const { file, error } = useFetchedViewerFile(fileName, fileUrl, getVideoMimeType(fileName));

  if (error !== null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message={error} variant="error" />
      </section>
    );
  }

  if (file === null) {
    return (
      <section className="heysnap-document-viewer" aria-label={fileName}>
        <DocumentViewerState message="Loading video..." />
      </section>
    );
  }

  return (
    <section className="heysnap-document-viewer" aria-label={fileName}>
      <Suspense fallback={<DocumentViewerState message="Loading video player..." />}>
        <HeySnapVideoViewer
          src={file}
          documentName={fileName}
          headerBackground="var(--heysnap-document-viewer-header-background)"
          headerForeground="var(--heysnap-document-viewer-header-foreground)"
        />
      </Suspense>
    </section>
  );
};

const DesktopSplitPane = ({
  children,
  leftPaneRatio,
  onLeftPaneRatioChange,
  agentBaseUrl,
  selectedThreadId,
  currentPath,
  currentDirectoryName,
  workspacePanel,
  capabilitiesBaseUrl,
  uiContext,
  onOpenFilePath,
  onSelectThread,
  onThreadResolved,
}: {
  readonly children: React.ReactNode;
  readonly leftPaneRatio: number;
  readonly onLeftPaneRatioChange: (ratio: number) => void;
  readonly agentBaseUrl: string;
  readonly selectedThreadId: string | null;
  readonly currentPath: string;
  readonly currentDirectoryName: string;
  readonly workspacePanel: WorkspacePanel;
  readonly capabilitiesBaseUrl?: string;
  readonly uiContext: AgentUiContext;
  readonly onOpenFilePath: (path: string) => void;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
  readonly onThreadResolved?: (threadId: string) => void;
}): React.ReactElement => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isResizing, setIsResizing] = useState(false);

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
      >
        <section className="split-left" style={{ flexBasis: `${leftPaneRatio * 100}%` }}>
          {children}
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
            setIsResizing(true);
          }}
          className="split-resizer"
        >
          <div className="split-resizer-line" />
          <div className="split-resizer-handle" />
        </div>

        <aside
          className="split-preview"
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
              onOpenFilePath={onOpenFilePath}
              onSelectThread={onSelectThread}
              onThreadResolved={onThreadResolved}
            />
          )}
        </aside>
      </div>
    </div>
  );
};

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

const syncOpenFileTabsFromEntries = (
  currentTabs: OpenFileTab[],
  entries: readonly FilesystemEntry[],
): OpenFileTab[] => {
  if (currentTabs.length === 0) {
    return currentTabs;
  }

  const fileEntriesByPath = new Map(
    entries
      .filter((entry) => entry.type === "file")
      .map((entry) => [entry.path, entry]),
  );
  let didChange = false;
  const nextTabs = currentTabs.map((tab) => {
    const entry = fileEntriesByPath.get(tab.path);

    if (entry === undefined) {
      return tab;
    }

    const nextTab = toOpenFileTab(entry);

    if (
      tab.name === nextTab.name &&
      tab.path === nextTab.path &&
      tab.size === nextTab.size &&
      tab.updatedAt === nextTab.updatedAt
    ) {
      return tab;
    }

    didChange = true;
    return nextTab;
  });

  return didChange ? nextTabs : currentTabs;
};

const getOpenFileTabVersion = (file: OpenFileTab): string => `${file.updatedAt}:${String(file.size ?? "")}`;

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

const isPptxFile = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith(".pptx");

const isXlsxFile = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith(".xlsx");

const isSpreadsheetFile = (fileName: string): boolean =>
  /\.(xls|xlsx)$/iu.test(fileName);

const isOfficePdfPreviewFile = (fileName: string): boolean =>
  /\.(ppt|xls)$/iu.test(fileName);

const isDelimitedTextFile = (fileName: string): boolean =>
  /\.(csv|tsv)$/iu.test(fileName);

const isImageFile = (fileName: string): boolean =>
  /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/iu.test(fileName);

const isMarkdownFile = (fileName: string): boolean =>
  /\.(md|markdown|mdx)$/iu.test(fileName);

const isHtmlFile = (fileName: string): boolean =>
  /\.html?$/iu.test(fileName);

const isCodeFile = (fileName: string): boolean =>
  /(^|\/)(dockerfile|makefile|\.dockerignore|\.editorconfig|\.eslintignore|\.eslintrc|\.gitignore|\.npmrc|\.prettierignore|\.prettierrc)$/iu.test(fileName) ||
  /(^|\/)\.env(?:\..+)?$/iu.test(fileName) ||
  /\.(bash|c|cc|cjs|cljs|clj|conf|cpp|cs|css|cxx|dart|env|erl|ex|exs|fish|fs|go|gql|graphql|h|handlebars|hbs|hh|hpp|ini|java|js|json|jsonc|jsx|kt|kts|less|lua|mjs|php|pl|proto|ps1|py|r|rb|rs|scala|scss|sh|sql|svelte|swift|toml|ts|tsx|vue|xml|ya?ml|zsh)$/iu.test(fileName);

const isPlainTextFile = (fileName: string): boolean =>
  /\.(log|text|txt)$/iu.test(fileName);

const isAudioFile = (fileName: string): boolean =>
  /\.(aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|weba)$/iu.test(fileName);

const isVideoFile = (fileName: string): boolean =>
  /\.(m4v|mov|mp4|mpeg|mpg|ogv|webm)$/iu.test(fileName);

const getImageMimeType = (fileName: string): string => {
  const mimeTypeByExtension: Record<string, string> = {
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
    ico: "image/x-icon",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
  };

  return mimeTypeByExtension[getFileExtension(fileName)] ?? "application/octet-stream";
};

const getAudioMimeType = (fileName: string): string => {
  const mimeTypeByExtension: Record<string, string> = {
    aac: "audio/aac",
    aif: "audio/aiff",
    aiff: "audio/aiff",
    flac: "audio/flac",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    oga: "audio/ogg",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    wav: "audio/wav",
    weba: "audio/webm",
  };

  return mimeTypeByExtension[getFileExtension(fileName)] ?? "application/octet-stream";
};

const getVideoMimeType = (fileName: string): string => {
  const mimeTypeByExtension: Record<string, string> = {
    m4v: "video/mp4",
    mov: "video/quicktime",
    mp4: "video/mp4",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    ogv: "video/ogg",
    webm: "video/webm",
  };

  return mimeTypeByExtension[getFileExtension(fileName)] ?? "application/octet-stream";
};

const getFileExtension = (fileName: string): string => {
  const extensionIndex = fileName.lastIndexOf(".");

  return extensionIndex >= 0 ? fileName.slice(extensionIndex + 1).toLowerCase() : "";
};

const useResolvedTheme = (): "light" | "dark" => {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) {
      return "dark";
    }

    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    const updateTheme = (): void => {
      setTheme(root.classList.contains("dark") ? "dark" : "light");
    };
    const observer = new MutationObserver(updateTheme);

    updateTheme();
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return theme;
};

const getDelimitedTextDelimiter = (fileName: string): "," | "\t" =>
  fileName.toLowerCase().endsWith(".tsv") ? "\t" : ",";

const parseDelimitedText = (text: string, delimiter: "," | "\t"): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let index = 0;
  let isQuoted = false;

  while (index < text.length) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (isQuoted) {
      if (character === "\"" && nextCharacter === "\"") {
        cell += "\"";
        index += 2;
        continue;
      }

      if (character === "\"") {
        isQuoted = false;
        index += 1;
        continue;
      }

      cell += character;
      index += 1;
      continue;
    }

    if (character === "\"" && cell.length === 0) {
      isQuoted = true;
      index += 1;
      continue;
    }

    if (character === delimiter) {
      row.push(cell);
      cell = "";
      index += 1;
      continue;
    }

    if (character === "\n" || character === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index += character === "\r" && nextCharacter === "\n" ? 2 : 1;
      continue;
    }

    cell += character;
    index += 1;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
};

const attachXlsxAssetUrls = (
  workbook: unknown,
  assetUrlForPath: (assetPath: string) => string,
): void => {
  const root = toMutableRecord(workbook);
  const workbookRecord = toMutableRecord(root?.["workbook"]);
  const sheets = Array.isArray(workbookRecord?.["sheets"]) ? workbookRecord["sheets"] : [];

  for (const sheetValue of sheets) {
    const sheet = toMutableRecord(sheetValue);

    if (sheet === null) {
      continue;
    }

    const drawings = Array.isArray(sheet["drawings"]) ? sheet["drawings"] : [];
    for (const drawingValue of drawings) {
      const drawing = toMutableRecord(drawingValue);
      const images = Array.isArray(drawing?.["images"]) ? drawing["images"] : [];
      images.forEach((image) => attachXlsxAssetUrl(image, assetUrlForPath));
    }

    const images = Array.isArray(sheet["images"]) ? sheet["images"] : [];
    images.forEach((image) => attachXlsxAssetUrl(image, assetUrlForPath));
  }
};

const attachXlsxAssetUrl = (
  imageValue: unknown,
  assetUrlForPath: (assetPath: string) => string,
): void => {
  const image = toMutableRecord(imageValue);
  const assetPath = image?.["assetPath"];

  if (image === null || typeof assetPath !== "string" || assetPath.length === 0) {
    return;
  }

  image["assetUrl"] = assetUrlForPath(assetPath);
};

const toMutableRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : null;

const readPreviewErrorMessage = async (response: Response, url: string): Promise<string> => {
  try {
    const body = await response.json() as {
      readonly code?: unknown;
      readonly message?: unknown;
      readonly error?: {
        readonly code?: unknown;
        readonly message?: unknown;
      };
    };

    if (typeof body.message === "string" && body.message.length > 0) {
      return body.message;
    }

    if (typeof body.error?.message === "string" && body.error.message.length > 0) {
      if (response.status === 404 && url.includes("/filesystem/preview")) {
        return "File preview is not available on this server yet. Restart or update the web/cloud server and the machine server.";
      }

      return body.error.message;
    }
  } catch {
    // Fall through to the status-based message when the response is not JSON.
  }

  if (response.status === 404 && url.includes("/filesystem/preview")) {
    return "File preview is not available on this server yet. Restart or update the web/cloud server and the machine server.";
  }

  return `Failed to load preview (${String(response.status)}).`;
};

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
  version?: string,
): string => {
  const baseUrl = typeof window === "undefined" ? "http://localhost" : window.location.href;
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
  if (version !== undefined) {
    url.searchParams.set("v", version);
  }

  return url.toString();
};

const buildFilesystemPreviewUrl = (
  filesystemWebsocketUrl: string,
  path: string,
  format: "pdf",
  version?: string,
): string => {
  const baseUrl = typeof window === "undefined" ? "http://localhost" : window.location.href;
  const url = new URL(filesystemWebsocketUrl, baseUrl);

  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  url.pathname = url.pathname.replace(/\/filesystem\/?$/u, "/filesystem/preview");
  url.searchParams.delete("path");
  url.searchParams.delete("showHidden");
  url.searchParams.delete("v");
  url.searchParams.set("path", path);
  url.searchParams.set("format", format);
  if (version !== undefined) {
    url.searchParams.set("v", version);
  }

  return url.toString();
};

const buildFilesystemXlsxUrl = (
  filesystemWebsocketUrl: string,
  path: string,
  version?: string,
): string => {
  const baseUrl = typeof window === "undefined" ? "http://localhost" : window.location.href;
  const url = new URL(filesystemWebsocketUrl, baseUrl);

  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  url.pathname = url.pathname.replace(/\/filesystem\/?$/u, "/filesystem/xlsx");
  url.searchParams.delete("path");
  url.searchParams.delete("showHidden");
  url.searchParams.delete("v");
  url.searchParams.set("path", path);
  if (version !== undefined) {
    url.searchParams.set("v", version);
  }

  return url.toString();
};

const buildFilesystemXlsxAssetUrl = (
  xlsxUrl: string,
  assetId: string,
  assetPath: string,
): string => {
  const url = new URL(xlsxUrl);
  const encodedAssetPath = assetPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");

  url.pathname = url.pathname.replace(
    /\/filesystem\/xlsx\/?$/u,
    `/filesystem/xlsx-assets/${encodeURIComponent(assetId)}/${encodedAssetPath}`,
  );
  url.searchParams.delete("path");
  url.searchParams.delete("showHidden");
  url.searchParams.delete("v");

  return url.toString();
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return window.btoa(binary);
};
