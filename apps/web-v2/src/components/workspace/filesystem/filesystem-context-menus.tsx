import type { ReactElement, ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Download05Icon,
  FileUploadIcon,
  FolderAddIcon,
  FolderUploadIcon,
} from '@hugeicons/core-free-icons'
import type { FilesystemEntry } from '../../../lib/filesystem/types.ts'

export const CONTEXT_MENU_WIDTH = 200
export const BACKGROUND_MENU_HEIGHT = 148
export const ENTRY_MENU_HEIGHT = 196
export const SELECTION_MENU_HEIGHT = 64

export type ContextMenuState =
  | { kind: 'background'; x: number; y: number }
  | { kind: 'entry'; x: number; y: number; entry: FilesystemEntry }
  | { kind: 'selection'; x: number; y: number; entries: FilesystemEntry[] }

export function BackgroundContextMenu({
  x,
  y,
  onCreateFolder,
  onUploadFiles,
  onUploadFolder,
}: {
  x: number
  y: number
  onCreateFolder: () => void
  onUploadFiles: () => void
  onUploadFolder: () => void
}): ReactElement {
  return (
    <MenuShell x={x} y={y}>
      <MenuItem
        icon={
          <HugeiconsIcon
            icon={FolderAddIcon}
            size={16}
            color="currentColor"
            strokeWidth={1.8}
          />
        }
        label="New Folder"
        onSelect={onCreateFolder}
      />
      <MenuSeparator />
      <MenuItem icon={<InfoGlyph />} label="Get Info" disabled />
      <MenuItem label="Change Wallpaper" disabled />
      <MenuItem
        icon={
          <HugeiconsIcon
            icon={FileUploadIcon}
            size={16}
            color="currentColor"
            strokeWidth={1.8}
          />
        }
        label="Upload Files"
        onSelect={onUploadFiles}
      />
      <MenuItem
        icon={
          <HugeiconsIcon
            icon={FolderUploadIcon}
            size={16}
            color="currentColor"
            strokeWidth={1.8}
          />
        }
        label="Upload Folder"
        onSelect={onUploadFolder}
      />
    </MenuShell>
  )
}

export function EntryContextMenu({
  x,
  y,
  entry,
  onOpen,
  onRename,
  onGetInfo,
  onTrash,
  onDownload,
}: {
  x: number
  y: number
  entry: FilesystemEntry
  onOpen: (entry: FilesystemEntry) => void
  onRename: (entry: FilesystemEntry) => void
  onGetInfo: (entry: FilesystemEntry) => void
  onTrash: (entry: FilesystemEntry) => void
  onDownload: (entry: FilesystemEntry) => void
}): ReactElement {
  return (
    <MenuShell x={x} y={y}>
      <MenuItem
        icon={<ViewGlyph />}
        label="Open"
        onSelect={() => onOpen(entry)}
      />
      <MenuItem
        icon={<RenameGlyph />}
        label="Rename"
        onSelect={() => onRename(entry)}
      />
      <MenuItem
        icon={<InfoGlyph />}
        label="Get Info"
        onSelect={() => onGetInfo(entry)}
      />
      <MenuSeparator />
      <MenuItem
        icon={<TrashGlyph />}
        label="Trash"
        onSelect={() => onTrash(entry)}
      />
      <MenuItem
        icon={
          <HugeiconsIcon
            icon={Download05Icon}
            size={16}
            color="currentColor"
            strokeWidth={1.8}
          />
        }
        label="Download"
        onSelect={() => onDownload(entry)}
      />
    </MenuShell>
  )
}

export function SelectionContextMenu({
  x,
  y,
  entries,
  onTrash,
  onDownload,
}: {
  x: number
  y: number
  entries: FilesystemEntry[]
  onTrash: (entries: readonly FilesystemEntry[]) => void
  onDownload: (entries: readonly FilesystemEntry[]) => void
}): ReactElement {
  return (
    <MenuShell x={x} y={y}>
      <MenuItem
        icon={<TrashGlyph />}
        label="Trash"
        onSelect={() => onTrash(entries)}
      />
      <MenuItem
        icon={
          <HugeiconsIcon
            icon={Download05Icon}
            size={16}
            color="currentColor"
            strokeWidth={1.8}
          />
        }
        label="Download"
        onSelect={() => onDownload(entries)}
      />
    </MenuShell>
  )
}

function MenuShell({
  x,
  y,
  children,
}: {
  x: number
  y: number
  children: ReactNode
}): ReactElement {
  return (
    <div
      role="menu"
      style={{ left: x, top: y, width: CONTEXT_MENU_WIDTH }}
      className="fixed z-[1000] flex flex-col gap-[1px] rounded-[10px] border border-black/10 bg-card p-[5px] text-card-foreground shadow-[0_10px_32px_rgba(0,0,0,0.18)] dark:border-white/10 dark:shadow-[0_10px_32px_rgba(0,0,0,0.45)]"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onSelect,
  disabled = false,
}: {
  icon?: ReactNode
  label: string
  onSelect?: () => void
  disabled?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onPointerDown={(event) => {
        if (disabled) return
        event.preventDefault()
        event.stopPropagation()
        onSelect?.()
      }}
      className="flex min-h-[24px] w-full items-center gap-[8px] rounded-[6px] px-[8px] py-[2px] text-left text-[13px] font-normal leading-none tracking-[-0.005em] text-current outline-none transition-none hover:enabled:bg-[#0064e1] hover:enabled:text-white disabled:cursor-default"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center opacity-85"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {label}
      </span>
    </button>
  )
}

function MenuSeparator(): ReactElement {
  return (
    <div className="mx-[6px] my-[5px] h-[1px] bg-black/10 dark:bg-white/10" />
  )
}

function GlyphSvg({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      {children}
    </svg>
  )
}

function ViewGlyph(): ReactElement {
  return (
    <GlyphSvg>
      <path
        d="M3.5 12s3-5.5 8.5-5.5S20.5 12 20.5 12s-3 5.5-8.5 5.5S3.5 12 3.5 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </GlyphSvg>
  )
}

function RenameGlyph(): ReactElement {
  return (
    <GlyphSvg>
      <path d="M4 17.5h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M5 15.5 15.7 4.8a2.1 2.1 0 0 1 3 3L8 18.5l-4 .9 1-3.9Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </GlyphSvg>
  )
}

function TrashGlyph(): ReactElement {
  return (
    <GlyphSvg>
      <path d="M5 7h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M7 7.5 8 19a2 2 0 0 0 2 1.8h4a2 2 0 0 0 2-1.8l1-11.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 11v5.5M13.5 11v5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </GlyphSvg>
  )
}

function InfoGlyph(): ReactElement {
  return (
    <GlyphSvg>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 8h.01" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </GlyphSvg>
  )
}
