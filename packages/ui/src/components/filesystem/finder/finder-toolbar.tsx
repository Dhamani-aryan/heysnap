import {
  Add01Icon,
  Cancel01Icon,
  ChatFeedbackIcon,
  File02Icon,
  InternetIcon,
  SidebarRightIcon,
  SquareArrowExpand01Icon,
  SquareArrowShrink02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactElement, ReactNode } from "react";

import { ChevronIcon, CloseIcon, Spinner, getTypedFileIconSrc } from "./finder-icons";
import type { ActiveLeftPaneSurface, OpenFileTab } from "./finder-types";

export const FinderToolbar = ({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  title,
  isFetching,
  browserTabTitle,
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
  readonly browserTabTitle: string;
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
}): ReactElement => (
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
            title={browserTabTitle}
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
}): ReactElement => {
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
}): ReactElement => {
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
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly ariaLabel: string;
  readonly title?: string;
  readonly active?: boolean;
  readonly pressed?: boolean;
}): ReactElement => (
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
