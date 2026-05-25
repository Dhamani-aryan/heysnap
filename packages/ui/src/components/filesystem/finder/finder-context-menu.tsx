import {
  Download05Icon,
  FileUploadIcon,
  FolderAddIcon,
  FolderUploadIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactElement, ReactNode } from "react";

import type { FilesystemEntry } from "../../../filesystem/types";
import { InfoIcon, RenameIcon, TrashIcon, ViewIcon } from "./finder-icons";

export const DesktopContextMenu = ({
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
}): ReactElement => (
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

export const DesktopEntryContextMenu = ({
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
}): ReactElement => (
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

export const DesktopSelectionContextMenu = ({
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
}): ReactElement => (
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
  readonly icon: ReactNode;
  readonly label: string;
  readonly onSelect: () => void;
}): ReactElement => (
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
  readonly icon?: ReactNode;
  readonly label: string;
  readonly arrow?: boolean;
  readonly inset?: boolean;
}): ReactElement => (
  <button type="button" className="context-menu-item disabled" role="menuitem" disabled>
    <span className="context-menu-icon" aria-hidden="true">
      {icon}
    </span>
    <span className={inset ? "context-menu-label inset" : "context-menu-label"}>{label}</span>
    {arrow ? <span className="context-menu-arrow">›</span> : null}
  </button>
);
