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
export const BACKGROUND_MENU_HEIGHT = 180
export const ENTRY_MENU_HEIGHT = 260
export const SELECTION_MENU_HEIGHT = 128

export type ContextMenuState =
  | { kind: 'background'; x: number; y: number }
  | { kind: 'entry'; x: number; y: number; entry: FilesystemEntry }
  | { kind: 'selection'; x: number; y: number; entries: FilesystemEntry[] }

export function BackgroundContextMenu({
  x,
  y,
  onCreateFolder,
  onPaste,
  canPaste,
  onUploadFiles,
  onUploadFolder,
}: {
  x: number
  y: number
  onCreateFolder: () => void
  onPaste: () => void
  canPaste: boolean
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
      <MenuItem
        icon={<PasteGlyph />}
        label="Paste"
        onSelect={onPaste}
        disabled={!canPaste}
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
  onCopy,
  onCut,
  onRename,
  onGetInfo,
  onTrash,
  onDownload,
}: {
  x: number
  y: number
  entry: FilesystemEntry
  onOpen: (entry: FilesystemEntry) => void
  onCopy: (entry: FilesystemEntry) => void
  onCut: (entry: FilesystemEntry) => void
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
        icon={<CopyGlyph />}
        label="Copy"
        onSelect={() => onCopy(entry)}
      />
      <MenuItem
        icon={<CutGlyph />}
        label="Cut"
        onSelect={() => onCut(entry)}
      />
      <MenuSeparator />
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
  onCopy,
  onCut,
  onTrash,
  onDownload,
}: {
  x: number
  y: number
  entries: FilesystemEntry[]
  onCopy: (entries: readonly FilesystemEntry[]) => void
  onCut: (entries: readonly FilesystemEntry[]) => void
  onTrash: (entries: readonly FilesystemEntry[]) => void
  onDownload: (entries: readonly FilesystemEntry[]) => void
}): ReactElement {
  return (
    <MenuShell x={x} y={y}>
      <MenuItem
        icon={<CopyGlyph />}
        label="Copy"
        onSelect={() => onCopy(entries)}
      />
      <MenuItem
        icon={<CutGlyph />}
        label="Cut"
        onSelect={() => onCut(entries)}
      />
      <MenuSeparator />
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
      className="flex min-h-[24px] w-full items-center gap-[8px] rounded-[6px] px-[8px] py-[2px] text-left text-[13px] font-normal leading-none tracking-[-0.005em] text-current outline-none transition-none hover:enabled:bg-[#0064e1] hover:enabled:text-white disabled:cursor-default disabled:opacity-45"
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

function CopyGlyph(): ReactElement {
  return (
    <GlyphSvg>
      <path
        d="M8 8.5V6.8A2.8 2.8 0 0 1 10.8 4h5.4A2.8 2.8 0 0 1 19 6.8v5.4a2.8 2.8 0 0 1-2.8 2.8h-1.7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="5"
        y="9"
        width="10"
        height="10"
        rx="2.6"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </GlyphSvg>
  )
}

function CutGlyph(): ReactElement {
  return (
    <GlyphSvg>
      <path
        d="M5.5 5.5 18.5 18.5M18.5 5.5 12.7 11.3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="6.5" cy="17.5" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6.5" cy="6.5" r="2.2" stroke="currentColor" strokeWidth="1.7" />
    </GlyphSvg>
  )
}

function PasteGlyph(): ReactElement {
  return (
    <GlyphSvg>
      <path
        d="M9 5.5h6M9.5 4h5a1.5 1.5 0 0 1 1.5 1.5v1A1.5 1.5 0 0 1 14.5 8h-5A1.5 1.5 0 0 1 8 6.5v-1A1.5 1.5 0 0 1 9.5 4Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 6H6.8A2.8 2.8 0 0 0 4 8.8v8.4A2.8 2.8 0 0 0 6.8 20h10.4a2.8 2.8 0 0 0 2.8-2.8V8.8A2.8 2.8 0 0 0 17.2 6H16"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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
