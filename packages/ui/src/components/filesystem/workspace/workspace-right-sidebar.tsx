import {
  Add01Icon,
  ArrowLeft01Icon,
  PlugSocketIcon,
  Search01Icon,
  SidebarRightIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { ReactElement, ReactNode } from "react";

import type { AgentThreadSummary } from "../../../agent/types";
import { RightSidebarChats } from "./right-sidebar-chats";
import type { WorkspacePanel } from "./workspace-types";

export const WorkspaceRightSidebar = ({
  activeWorkspacePanel,
  agentBaseUrl,
  isOpen,
  selectedThreadId,
  onNewThread,
  onOpenConnectors,
  onSelectThread,
}: {
  readonly activeWorkspacePanel: WorkspacePanel;
  readonly agentBaseUrl: string;
  readonly isOpen: boolean;
  readonly selectedThreadId: string | null;
  readonly onNewThread: () => void;
  readonly onOpenConnectors: () => void;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
}): ReactElement => (
  <aside className="split-right-sidebar" aria-label="Right sidebar" aria-hidden={!isOpen}>
    <div className="split-right-sidebar-actions">
      <RightSidebarAction
        icon={Add01Icon}
        label="New Chat"
        isActive={activeWorkspacePanel === "chat" && selectedThreadId === null}
        onClick={onNewThread}
      />
      <RightSidebarAction icon={Search01Icon} label="Search" />
      <RightSidebarAction
        icon={PlugSocketIcon}
        label="Connectors"
        isActive={activeWorkspacePanel === "connectors"}
        onClick={onOpenConnectors}
      />
    </div>
    <RightSidebarChats
      agentBaseUrl={agentBaseUrl}
      isOpen={isOpen}
      selectedThreadId={selectedThreadId}
      onSelectThread={onSelectThread}
    />
  </aside>
);

export const ConnectorsWorkspaceToolbar = ({
  isRightSidebarOpen,
  onBack,
  onToggleRightSidebar,
}: {
  readonly isRightSidebarOpen: boolean;
  readonly onBack: () => void;
  readonly onToggleRightSidebar: () => void;
}): ReactElement => (
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
}): ReactElement => (
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
