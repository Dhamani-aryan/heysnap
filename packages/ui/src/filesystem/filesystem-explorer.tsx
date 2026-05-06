"use client";

import {
  Add01Icon,
  Download05Icon,
  FileUploadIcon,
  FolderAddIcon,
  FolderUploadIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentPanel } from "../agent/agent-panel";
import { ThreadHistoryButton } from "../agent/thread-history";
import type { AgentThreadSummary } from "../agent/types";
import fileIconSrc from "./assets/macos/File.png";
import folderIconSrc from "./assets/macos/Folder.png";
import { FilesystemClient } from "./filesystem-client";
import { ThemeToggle } from "./theme-toggle";
import type { FilesystemEntry, FilesystemListing, FilesystemUploadFile } from "./types";

type ReactPdfModule = typeof import("react-pdf");
type ReactPdfComponents = Pick<ReactPdfModule, "Document" | "Page">;
type DocxPreviewModule = typeof import("docx-preview");
type MonacoEditorModule = typeof import("@monaco-editor/react");
type PromiseWithResolversResult<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
};
type PromiseWithResolvers = <T>() => PromiseWithResolversResult<T>;

const PDF_WORKER_SRC = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const HISTORY_LIMIT = 64;
const DEFAULT_LEFT_PANE_RATIO = 0.5;
const MIN_PANE_RATIO = 0.25;
const MAX_PANE_RATIO = 0.75;
const LEFT_PANE_RATIO_STORAGE_KEY = "filesystem-explorer:left-pane-ratio";
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

export interface FilesystemExplorerProps {
  readonly websocketUrl?: string;
  readonly agentWebsocketUrl?: string;
  readonly onFilesystemOpen?: () => void;
}

export function FilesystemExplorer({
  websocketUrl = "ws://localhost:4000/filesystem",
  agentWebsocketUrl = "ws://localhost:4000/agent",
  onFilesystemOpen,
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
  const [selectedThread, setSelectedThread] = useState<AgentThreadSummary | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [openFileTabs, setOpenFileTabs] = useState<OpenFileTab[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const currentPath = listing?.path ?? "";
  const activeFileTab = activeFilePath === null
    ? null
    : openFileTabs.find((tab) => tab.path === activeFilePath) ?? null;
  const openFileWatchKey = useMemo(
    () => openFileTabs.map((tab) => tab.path).sort((left, right) => left.localeCompare(right)).join("\0"),
    [openFileTabs],
  );

  useEffect(() => {
    const client = new FilesystemClient(websocketUrl, {
      onListing: (nextListing) => {
        setListing(nextListing);
        setOpenFileTabs((currentTabs) => syncOpenFileTabsFromListing(currentTabs, nextListing));
      },
      onFileUpdates: ({ entries }) => {
        setOpenFileTabs((currentTabs) => syncOpenFileTabsFromEntries(currentTabs, entries));
      },
      onLoading: setIsFetching,
      onError: setListingError,
      onOpen: onFilesystemOpen,
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [onFilesystemOpen, websocketUrl]);

  useEffect(() => {
    const paths = openFileWatchKey.length === 0 ? [] : openFileWatchKey.split("\0");

    void clientRef.current?.watchFiles(paths).catch((error) => {
      setListingError(error instanceof Error ? error.message : "Failed to watch open files.");
    });
  }, [openFileWatchKey]);

  const handleLeftPaneRatioChange = useCallback((ratio: number): void => {
    const nextRatio = clampPaneRatio(ratio);

    setLeftPaneRatio(nextRatio);
    window.localStorage.setItem(LEFT_PANE_RATIO_STORAGE_KEY, String(nextRatio));
  }, []);

  const subscribeTo = useCallback(async (nextPath: string, shouldPushHistory: boolean): Promise<void> => {
    setIsFetching(true);
    setListingError(null);
    setActiveFilePath(null);
    await clientRef.current?.subscribe(nextPath);
    setSelectedPaths([]);
    setSelectionAnchorPath(null);
    setRenamingPath(null);

    if (!shouldPushHistory) {
      return;
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
  }, [currentPath, historyIndex, listing]);

  const navigateTo = useCallback(
    (nextPath: string) => {
      void subscribeTo(nextPath, true).catch((error) => {
        setListingError(error instanceof Error ? error.message : "Failed to load folder.");
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
      setListingError(error instanceof Error ? error.message : "Failed to load folder.");
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
      setListingError(error instanceof Error ? error.message : "Failed to load folder.");
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
      setListingError(error instanceof Error ? error.message : "Failed to create folder.");
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
      setListingError(error instanceof Error ? error.message : "Failed to rename item.");
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
      setListingError(error instanceof Error ? error.message : "Failed to move items to Trash.");
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
      setListingError(error instanceof Error ? error.message : "Failed to start download.");
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
      setListingError(error instanceof Error ? error.message : "Failed to upload items.");
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

        setListingError(error instanceof Error ? error.message : "Failed to upload folder.");
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

  return (
    <main className="finder-shell">
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
        title={listing?.name ?? "Desktop"}
        isFetching={isFetching}
        agentWebsocketUrl={agentWebsocketUrl}
        selectedThreadId={selectedThread?.id ?? null}
        onSelectThread={setSelectedThread}
        onNewThread={() => setSelectedThread(null)}
        openFileTabs={openFileTabs}
        activeFilePath={activeFileTab?.path ?? null}
        onShowDirectory={() => setActiveFilePath(null)}
        onSelectFileTab={setActiveFilePath}
        onCloseFileTab={closeFileTab}
      />

      <DesktopSplitPane
        leftPaneRatio={leftPaneRatio}
        onLeftPaneRatioChange={handleLeftPaneRatioChange}
        agentWebsocketUrl={agentWebsocketUrl}
        selectedThreadId={selectedThread?.id ?? null}
        currentPath={currentPath}
        onSelectThread={setSelectedThread}
      >
        {activeFileTab === null ? (
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
        ) : (
          <FileViewer file={activeFileTab} websocketUrl={websocketUrl} />
        )}
      </DesktopSplitPane>
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

const FinderToolbar = ({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  title,
  isFetching,
  agentWebsocketUrl,
  selectedThreadId,
  onSelectThread,
  onNewThread,
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
  readonly agentWebsocketUrl: string;
  readonly selectedThreadId: string | null;
  readonly onSelectThread: (thread: AgentThreadSummary) => void;
  readonly onNewThread: () => void;
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
      <button
        type="button"
        className="new-thread-button"
        aria-label="New chat"
        title="New chat"
        onClick={onNewThread}
      >
        <HugeiconsIcon icon={Add01Icon} size={18} color="currentColor" strokeWidth={1.8} />
      </button>
      <ThreadHistoryButton
        websocketUrl={agentWebsocketUrl}
        selectedThreadId={selectedThreadId}
        onSelectThread={onSelectThread}
      />
      <ThemeToggle />
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
}): React.ReactElement => (
  <div className={isActive ? "file-tab active" : "file-tab"} role="tab" aria-selected={isActive}>
    <button
      type="button"
      className="file-tab-activate"
      title={tab.path}
      onClick={onSelect}
      tabIndex={isActive ? 0 : -1}
    >
      <span className="file-tab-title">{tab.name}</span>
    </button>
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
  </div>
);

const ToolbarButton = ({
  children,
  disabled,
  onClick,
  ariaLabel,
}: {
  readonly children: React.ReactNode;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly ariaLabel: string;
}): React.ReactElement => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel}
    className="toolbar-button"
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
        fileUrl={buildFilesystemDownloadUrl(websocketUrl, [file.path], fileVersion)}
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

  if (isSpreadsheetFile(file.name)) {
    return (
      <PreviewPdfViewer
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
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageWidth, setPageWidth] = useState(720);
  const [reactPdf, setReactPdf] = useState<ReactPdfComponents | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (viewport === null) {
      return;
    }

    const updateWidth = (): void => {
      const nextWidth = Math.floor(viewport.getBoundingClientRect().width - 48);
      setPageWidth(Math.max(240, nextWidth));
    };

    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(viewport);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    installPdfJsPolyfills();
    void import("react-pdf")
      .then((module) => {
        module.pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

        if (!isCancelled) {
          setReactPdf({
            Document: module.Document,
            Page: module.Page,
          });
          setLoadError(null);
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          setLoadError(toViewerErrorMessage(error, "Failed to load PDF viewer."));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    setNumPages(0);
  }, [fileUrl]);

  if (loadError !== null) {
    return (
      <section ref={viewportRef} className="pdf-viewer" aria-label={fileName}>
        <PdfViewerState message={loadError} variant="error" />
      </section>
    );
  }

  if (reactPdf === null) {
    return (
      <section ref={viewportRef} className="pdf-viewer" aria-label={fileName}>
        <PdfViewerState message="Loading PDF viewer..." />
      </section>
    );
  }

  const { Document: PdfDocument, Page: PdfPage } = reactPdf;

  return (
    <section ref={viewportRef} className="pdf-viewer" aria-label={fileName}>
      <PdfDocument
        key={fileUrl}
        file={fileUrl}
        loading={<PdfViewerState message="Loading PDF..." />}
        error={<PdfViewerState message="Failed to load PDF." variant="error" />}
        onLoadSuccess={(document) => setNumPages(document.numPages)}
        onLoadError={() => setNumPages(0)}
      >
        <div className="pdf-pages">
          {Array.from({ length: numPages }, (_, index) => (
            <PdfPage
              key={`${fileUrl}:${String(index + 1)}`}
              pageNumber={index + 1}
              width={pageWidth}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              loading={<div className="pdf-page-loading">Loading page...</div>}
            />
          ))}
        </div>
      </PdfDocument>
    </section>
  );
};

const PdfViewerState = ({
  message,
  variant = "info",
}: {
  readonly message: string;
  readonly variant?: "info" | "error";
}): React.ReactElement => (
  <div className={variant === "error" ? "pdf-viewer-state error" : "pdf-viewer-state"}>
    <p>{message}</p>
  </div>
);

const PreviewPdfViewer = ({
  fileName,
  fileUrl,
}: {
  readonly fileName: string;
  readonly fileUrl: string;
}): React.ReactElement => {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let objectUrl: string | null = null;
    let isCancelled = false;

    setPdfUrl(null);
    setError(null);

    const fetchPreview = async (): Promise<void> => {
      const response = await fetch(fileUrl, { signal: abortController.signal });

      if (!response.ok) {
        throw new Error(await readPreviewErrorMessage(response, fileUrl));
      }

      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);

      if (!isCancelled) {
        setPdfUrl(objectUrl);
      }
    };

    void fetchPreview().catch((fetchError) => {
      if (!isCancelled && !isAbortError(fetchError)) {
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load preview.");
      }
    });

    return () => {
      isCancelled = true;
      abortController.abort();

      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [fileUrl]);

  if (error !== null) {
    return (
      <section className="pdf-viewer" aria-label={fileName}>
        <PdfViewerState message={error} variant="error" />
      </section>
    );
  }

  if (pdfUrl === null) {
    return (
      <section className="pdf-viewer" aria-label={fileName}>
        <PdfViewerState message="Preparing spreadsheet preview..." />
      </section>
    );
  }

  return <PdfViewer fileName={fileName} fileUrl={pdfUrl} />;
};

const DocxViewer = ({
  fileName,
  fileUrl,
}: {
  readonly fileName: string;
  readonly fileUrl: string;
}): React.ReactElement => {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const styleRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const bodyContainer = bodyRef.current;
    const styleContainer = styleRef.current;

    if (bodyContainer === null || styleContainer === null) {
      return;
    }

    const abortController = new AbortController();
    let isCancelled = false;

    bodyContainer.replaceChildren();
    styleContainer.replaceChildren();
    setStatus("loading");

    const renderDocument = async (): Promise<void> => {
      const [module, response] = await Promise.all([
        import("docx-preview") as Promise<DocxPreviewModule>,
        fetch(fileUrl, { signal: abortController.signal }),
      ]);

      if (!response.ok) {
        throw new Error("Failed to load DOCX.");
      }

      const blob = await response.blob();

      if (isCancelled) {
        return;
      }

      await module.renderAsync(blob, bodyContainer, styleContainer, {
        className: "docx-document",
        inWrapper: true,
      });

      if (!isCancelled) {
        setStatus("ready");
      }
    };

    void renderDocument().catch((error) => {
      if (!isCancelled && !isAbortError(error)) {
        bodyContainer.replaceChildren();
        styleContainer.replaceChildren();
        setStatus("error");
      }
    });

    return () => {
      isCancelled = true;
      abortController.abort();
      bodyContainer.replaceChildren();
      styleContainer.replaceChildren();
    };
  }, [fileUrl]);

  return (
    <section className="docx-viewer" aria-label={fileName}>
      <div ref={styleRef} className="docx-style-host" />
      {status === "loading" ? <DocxViewerState message="Loading DOCX..." /> : null}
      {status === "error" ? <DocxViewerState message="Failed to load DOCX." variant="error" /> : null}
      <div ref={bodyRef} className="docx-body" aria-hidden={status !== "ready" ? "true" : undefined} />
    </section>
  );
};

const DocxViewerState = ({
  message,
  variant = "info",
}: {
  readonly message: string;
  readonly variant?: "info" | "error";
}): React.ReactElement => (
  <div className={variant === "error" ? "docx-viewer-state error" : "docx-viewer-state"}>
    <p>{message}</p>
  </div>
);

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
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [fileUrl]);

  if (hasError) {
    return (
      <section className="image-viewer" aria-label={fileName}>
        <ImageViewerState message="Failed to load image." variant="error" />
      </section>
    );
  }

  return (
    <section className="image-viewer" aria-label={fileName}>
      <img
        src={fileUrl}
        alt={fileName}
        className="image-viewer-image"
        draggable={false}
        onError={() => setHasError(true)}
      />
    </section>
  );
};

const ImageViewerState = ({
  message,
  variant = "info",
}: {
  readonly message: string;
  readonly variant?: "info" | "error";
}): React.ReactElement => (
  <div className={variant === "error" ? "image-viewer-state error" : "image-viewer-state"}>
    <p>{message}</p>
  </div>
);

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
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorModule, setEditorModule] = useState<MonacoEditorModule | null>(null);
  const theme = useResolvedTheme();

  useEffect(() => {
    let isCancelled = false;

    void import("@monaco-editor/react")
      .then((module) => {
        if (!isCancelled) {
          setEditorModule(module);
        }
      })
      .catch((loadError) => {
        if (!isCancelled) {
          setError(toViewerErrorMessage(loadError, "Failed to load code editor."));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    let isCancelled = false;

    setCode(null);
    setError(null);

    const loadCode = async (): Promise<void> => {
      const response = await fetch(fileUrl, { signal: abortController.signal });

      if (!response.ok) {
        throw new Error(`Failed to load code (${String(response.status)}).`);
      }

      const nextCode = await response.text();

      if (!isCancelled) {
        setCode(nextCode);
      }
    };

    void loadCode().catch((loadError) => {
      if (!isCancelled && !isAbortError(loadError)) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load code.");
      }
    });

    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [fileUrl]);

  if (error !== null) {
    return (
      <section className="code-viewer" aria-label={fileName}>
        <CodeViewerState message={error} variant="error" />
      </section>
    );
  }

  if (editorModule === null || code === null) {
    return (
      <section className="code-viewer" aria-label={fileName}>
        <CodeViewerState message="Loading code..." />
      </section>
    );
  }

  const Editor = editorModule.default;

  return (
    <section className="code-viewer" aria-label={fileName}>
      <Editor
        value={code}
        language={getCodeLanguage(fileName)}
        theme={theme === "dark" ? "vs-dark" : "vs"}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontFamily: "var(--font-geist-mono), ui-monospace, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          lineHeight: 19,
          renderLineHighlight: "none",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          automaticLayout: true,
        }}
      />
    </section>
  );
};

const CodeViewerState = ({
  message,
  variant = "info",
}: {
  readonly message: string;
  readonly variant?: "info" | "error";
}): React.ReactElement => (
  <div className={variant === "error" ? "code-viewer-state error" : "code-viewer-state"}>
    <p>{message}</p>
  </div>
);

const AudioViewer = ({
  fileName,
  fileUrl,
}: {
  readonly fileName: string;
  readonly fileUrl: string;
}): React.ReactElement => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [fileUrl]);

  if (hasError) {
    return (
      <section className="media-viewer" aria-label={fileName}>
        <MediaViewerState message="Failed to load audio." variant="error" />
      </section>
    );
  }

  return (
    <section className="media-viewer" aria-label={fileName}>
      <div className="audio-player-shell">
        <p>{fileName}</p>
        <audio
          src={fileUrl}
          controls
          className="audio-player"
          onError={() => setHasError(true)}
        />
      </div>
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
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [fileUrl]);

  if (hasError) {
    return (
      <section className="media-viewer" aria-label={fileName}>
        <MediaViewerState message="Failed to load video." variant="error" />
      </section>
    );
  }

  return (
    <section className="media-viewer" aria-label={fileName}>
      <video
        src={fileUrl}
        controls
        className="video-player"
        onError={() => setHasError(true)}
      />
    </section>
  );
};

const MediaViewerState = ({
  message,
  variant = "info",
}: {
  readonly message: string;
  readonly variant?: "info" | "error";
}): React.ReactElement => (
  <div className={variant === "error" ? "media-viewer-state error" : "media-viewer-state"}>
    <p>{message}</p>
  </div>
);

const DesktopSplitPane = ({
  children,
  leftPaneRatio,
  onLeftPaneRatioChange,
  agentWebsocketUrl,
  selectedThreadId,
  currentPath,
  onSelectThread,
}: {
  readonly children: React.ReactNode;
  readonly leftPaneRatio: number;
  readonly onLeftPaneRatioChange: (ratio: number) => void;
  readonly agentWebsocketUrl: string;
  readonly selectedThreadId: string | null;
  readonly currentPath: string;
  readonly onSelectThread: (thread: AgentThreadSummary) => void;
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
      const nextRatio = (event.clientX - rect.left) / rect.width;
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
    <div ref={containerRef} className="split-pane">
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

      <aside className="split-preview" aria-label="Preview panel">
        <AgentPanel
          websocketUrl={agentWebsocketUrl}
          selectedThreadId={selectedThreadId}
          currentPath={currentPath}
          onSelectThread={onSelectThread}
        />
      </aside>
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
  const src = getAssetSrc(entry.type === "directory" ? folderIconSrc : fileIconSrc);

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
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path
      d="m3.2 3.2 5.6 5.6M8.8 3.2 3.2 8.8"
      stroke="currentColor"
      strokeWidth="1.5"
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

const syncOpenFileTabsFromListing = (
  currentTabs: OpenFileTab[],
  listing: FilesystemListing,
): OpenFileTab[] => syncOpenFileTabsFromEntries(currentTabs, listing.entries);

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

const isSpreadsheetFile = (fileName: string): boolean =>
  /\.(xls|xlsx)$/iu.test(fileName);

const isDelimitedTextFile = (fileName: string): boolean =>
  /\.(csv|tsv)$/iu.test(fileName);

const isImageFile = (fileName: string): boolean =>
  /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/iu.test(fileName);

const isCodeFile = (fileName: string): boolean =>
  /\.(c|cc|conf|cpp|cs|css|env|go|h|hpp|html?|ini|java|js|json|jsx|md|mjs|py|rb|rs|sh|sql|toml|ts|tsx|xml|ya?ml)$/iu.test(fileName);

const isPlainTextFile = (fileName: string): boolean =>
  /\.(log|text|txt)$/iu.test(fileName);

const isAudioFile = (fileName: string): boolean =>
  /\.(aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|weba)$/iu.test(fileName);

const isVideoFile = (fileName: string): boolean =>
  /\.(m4v|mov|mp4|mpeg|mpg|ogv|webm)$/iu.test(fileName);

const getCodeLanguage = (fileName: string): string => {
  const extension = getFileExtension(fileName);
  const languageByExtension: Record<string, string> = {
    c: "c",
    cc: "cpp",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    go: "go",
    h: "cpp",
    hpp: "cpp",
    htm: "html",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    md: "markdown",
    mjs: "javascript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "shell",
    sql: "sql",
    ts: "typescript",
    tsx: "typescript",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
  };

  return languageByExtension[extension] ?? "plaintext";
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

const installPdfJsPolyfills = (): void => {
  const promiseConstructor = Promise as PromiseConstructor & {
    withResolvers?: PromiseWithResolvers;
  };

  if (promiseConstructor.withResolvers !== undefined) {
    return;
  }

  promiseConstructor.withResolvers = <T,>(): PromiseWithResolversResult<T> => {
    let resolveValue: (value: T | PromiseLike<T>) => void = () => {};
    let rejectValue: (reason?: unknown) => void = () => {};
    const promise = new Promise<T>((resolve, reject) => {
      resolveValue = resolve;
      rejectValue = reject;
    });

    return {
      promise,
      resolve: resolveValue,
      reject: rejectValue,
    };
  };
};

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
        return "Spreadsheet preview is not available on this server yet. Restart or update the web/cloud server and the machine server.";
      }

      return body.error.message;
    }
  } catch {
    // Fall through to the status-based message when the response is not JSON.
  }

  if (response.status === 404 && url.includes("/filesystem/preview")) {
    return "Spreadsheet preview is not available on this server yet. Restart or update the web/cloud server and the machine server.";
  }

  return `Failed to load preview (${String(response.status)}).`;
};

const toViewerErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.length > 0) {
    return `${fallback}: ${error.message}`;
  }

  return fallback;
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

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return window.btoa(binary);
};
