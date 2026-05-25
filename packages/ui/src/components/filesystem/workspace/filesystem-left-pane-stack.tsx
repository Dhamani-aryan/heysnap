import type { MouseEvent, ReactElement } from "react";

import type { BrowserControlStatus } from "../../../cloud/browser-control-bridge";
import type { FilesystemConnectionStatus } from "../../../filesystem/filesystem-client";
import type { FilesystemEntry } from "../../../filesystem/types";
import { BrowserControlPanel } from "../browser/browser-control-panel";
import type {
  BrowserScreencastState,
  BrowserViewportClickInput,
  BrowserViewportKeyboardInput,
  BrowserViewportWheelInput,
  BrowserWindowTab,
} from "../browser/browser-types";
import { FileViewerStack } from "../dialogs/file-viewer-stack";
import { FinderBody } from "../finder/finder-body";
import type { ActiveLeftPaneSurface, OpenFileTab } from "../finder/finder-types";
import { MachineStatusControl } from "./machine-status-control";

export const FilesystemLeftPaneStack = ({
  activeLeftPaneSurface,
  directoryError,
  isDirectoryLoading,
  entries,
  selectedPaths,
  renamingPath,
  onSelectEntry,
  onSelectionChange,
  onActivateEntry,
  onDirectoryBackgroundClick,
  onCreateNewFolder,
  onUploadFiles,
  onUploadFolder,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onOpenEntry,
  onGetEntryInfo,
  onTrashEntries,
  onDownloadEntries,
  browserError,
  isBrowserOpening,
  browserStatus,
  browserTabs,
  browserWindowId,
  browserCanGoBack,
  browserCanGoForward,
  browserScreencastAspectRatio,
  browserScreencastFrameUrl,
  browserScreencastState,
  browserScreencastTabId,
  onBrowserBack,
  onBrowserForward,
  onBrowserGoTo,
  onBrowserRefresh,
  onSelectBrowserTab,
  onCloseBrowserTab,
  onNewBrowserTab,
  onBrowserViewportClick,
  onBrowserViewportKey,
  onBrowserViewportWheel,
  openFileTabs,
  activeFilePath,
  websocketUrl,
  filesystemPreviewBaseUrl,
  canSleepMachine,
  machineName,
  connectionStatus,
  onBackToMachines,
  onSleepMachine,
}: {
  readonly activeLeftPaneSurface: ActiveLeftPaneSurface;
  readonly directoryError: string | null;
  readonly isDirectoryLoading: boolean;
  readonly entries: FilesystemEntry[];
  readonly selectedPaths: string[];
  readonly renamingPath: string | null;
  readonly onSelectEntry: (entry: FilesystemEntry, event: MouseEvent) => void;
  readonly onSelectionChange: (paths: string[]) => void;
  readonly onActivateEntry: (entry: FilesystemEntry) => void;
  readonly onDirectoryBackgroundClick: () => void;
  readonly onCreateNewFolder: () => void;
  readonly onUploadFiles: () => void;
  readonly onUploadFolder: () => void;
  readonly onRenameStart: (entry: FilesystemEntry) => void;
  readonly onRenameCommit: (entry: FilesystemEntry, nextName: string) => void;
  readonly onRenameCancel: () => void;
  readonly onOpenEntry: (entry: FilesystemEntry) => void;
  readonly onGetEntryInfo: (entry: FilesystemEntry) => void;
  readonly onTrashEntries: (entries: readonly FilesystemEntry[]) => void;
  readonly onDownloadEntries: (entries: readonly FilesystemEntry[]) => void;
  readonly browserError: string | null;
  readonly isBrowserOpening: boolean;
  readonly browserStatus?: BrowserControlStatus;
  readonly browserTabs: BrowserWindowTab[];
  readonly browserWindowId: number | null;
  readonly browserCanGoBack: boolean;
  readonly browserCanGoForward: boolean;
  readonly browserScreencastAspectRatio: number | null;
  readonly browserScreencastFrameUrl: string | null;
  readonly browserScreencastState: BrowserScreencastState;
  readonly browserScreencastTabId: number | null;
  readonly onBrowserBack?: () => Promise<void> | void;
  readonly onBrowserForward?: () => Promise<void> | void;
  readonly onBrowserGoTo?: (url: string) => Promise<void> | void;
  readonly onBrowserRefresh?: () => Promise<void> | void;
  readonly onSelectBrowserTab?: (tabId: number) => Promise<void> | void;
  readonly onCloseBrowserTab?: (tabId: number) => Promise<void> | void;
  readonly onNewBrowserTab?: () => Promise<void> | void;
  readonly onBrowserViewportClick?: (input: BrowserViewportClickInput) => Promise<void> | void;
  readonly onBrowserViewportKey?: (input: BrowserViewportKeyboardInput) => Promise<void> | void;
  readonly onBrowserViewportWheel?: (input: BrowserViewportWheelInput) => Promise<void> | void;
  readonly openFileTabs: OpenFileTab[];
  readonly activeFilePath: string | null;
  readonly websocketUrl: string;
  readonly filesystemPreviewBaseUrl?: string;
  readonly canSleepMachine: boolean;
  readonly machineName: string;
  readonly connectionStatus: FilesystemConnectionStatus;
  readonly onBackToMachines?: () => void;
  readonly onSleepMachine?: () => Promise<void>;
}): ReactElement => (
  <>
    <div className="left-pane-surface-stack">
      <div
        className={activeLeftPaneSurface === "directory" ? "left-pane-surface active" : "left-pane-surface inactive"}
        aria-hidden={activeLeftPaneSurface !== "directory"}
      >
        <FinderBody
          error={directoryError}
          isLoading={isDirectoryLoading}
          entries={entries}
          selectedPaths={selectedPaths}
          renamingPath={renamingPath}
          onSelect={onSelectEntry}
          onSelectionChange={onSelectionChange}
          onActivate={onActivateEntry}
          onBackgroundClick={onDirectoryBackgroundClick}
          onCreateNewFolder={onCreateNewFolder}
          onUploadFiles={onUploadFiles}
          onUploadFolder={onUploadFolder}
          onRenameStart={onRenameStart}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
          onOpenEntry={onOpenEntry}
          onGetInfo={onGetEntryInfo}
          onTrashEntries={onTrashEntries}
          onDownloadEntries={onDownloadEntries}
        />
      </div>
      <div
        className={activeLeftPaneSurface === "browser" ? "left-pane-surface active" : "left-pane-surface inactive"}
        aria-hidden={activeLeftPaneSurface !== "browser"}
      >
        <BrowserControlPanel
          error={browserError}
          isOpening={isBrowserOpening}
          status={browserStatus}
          tabs={browserTabs}
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
        activeFilePath={activeFilePath}
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
  </>
);
