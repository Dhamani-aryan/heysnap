import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { toast } from 'sonner'
import {
  getActiveFilesystemManager,
  useFilesystemStore,
} from '../../../stores/filesystem/filesystem-store.ts'
import type { FilesystemEntry } from '../../../lib/filesystem/types.ts'
import {
  folderPickerAttributes,
  getBrowserRelativePath,
  getDirectoryUploadSources,
  getUploadSelectionPaths,
  uploadBrowserSourcesToFilesystem,
  type BrowserUploadSource,
  type DirectoryPickerWindow,
  type FilesystemBrowserUploadProgress,
} from '../../../lib/filesystem/filesystem-upload.ts'
import { FilesystemUploadDialog } from './filesystem-upload-dialog.tsx'
import {
  BACKGROUND_MENU_HEIGHT,
  BackgroundContextMenu,
  CONTEXT_MENU_WIDTH,
  ENTRY_MENU_HEIGHT,
  EntryContextMenu,
  SELECTION_MENU_HEIGHT,
  SelectionContextMenu,
  type ContextMenuState,
} from './filesystem-context-menus.tsx'

const VIEWPORT_MARGIN = 8
const DRAG_THRESHOLD_PX = 3

type SelectionRect = {
  originX: number
  originY: number
  currentX: number
  currentY: number
}

export function FilesystemPane() {
  const listing = useFilesystemStore((s) => s.listing)
  const isFetching = useFilesystemStore((s) => s.isFetching)
  const listingError = useFilesystemStore((s) => s.listingError)
  const currentPath = useFilesystemStore((s) => s.currentPath)
  const navigate = useFilesystemStore((s) => s.navigate)
  const openFile = useFilesystemStore((s) => s.openFile)
  const filesystemClipboard = useFilesystemStore((s) => s.filesystemClipboard)
  const setFilesystemClipboard = useFilesystemStore(
    (s) => s.setFilesystemClipboard,
  )
  const clearFilesystemClipboard = useFilesystemStore(
    (s) => s.clearFilesystemClipboard,
  )

  const bodyRef = useRef<HTMLDivElement | null>(null)
  const filesInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const didDragRef = useRef(false)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [anchorPath, setAnchorPath] = useState<string | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [uploadProgress, setUploadProgress] =
    useState<FilesystemBrowserUploadProgress | null>(null)
  const [trackedPath, setTrackedPath] = useState(currentPath)

  if (trackedPath !== currentPath) {
    setTrackedPath(currentPath)
    setSelectedPaths([])
    setAnchorPath(null)
    setRenamingPath(null)
    setContextMenu(null)
  }

  const entries = listing?.entries ?? []

  const handleSelect = (
    entry: FilesystemEntry,
    event: ReactMouseEvent,
  ): void => {
    if (event.shiftKey && anchorPath !== null) {
      const anchorIndex = entries.findIndex((e) => e.path === anchorPath)
      const targetIndex = entries.findIndex((e) => e.path === entry.path)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] =
          anchorIndex < targetIndex
            ? [anchorIndex, targetIndex]
            : [targetIndex, anchorIndex]
        setSelectedPaths(entries.slice(start, end + 1).map((e) => e.path))
        return
      }
    }

    if (event.metaKey || event.ctrlKey) {
      setSelectedPaths((current) =>
        current.includes(entry.path)
          ? current.filter((p) => p !== entry.path)
          : [...current, entry.path],
      )
      setAnchorPath(entry.path)
      return
    }

    setSelectedPaths([entry.path])
    setAnchorPath(entry.path)
  }

  const handleEntryContextMenu = (
    entry: FilesystemEntry,
    event: ReactMouseEvent,
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    if (selectedPaths.length > 1 && selectedPaths.includes(entry.path)) {
      const picked = entries.filter((e) => selectedPaths.includes(e.path))
      setContextMenu({
        kind: 'selection',
        ...clampMenuPosition(event.clientX, event.clientY, SELECTION_MENU_HEIGHT),
        entries: picked,
      })
      return
    }
    setSelectedPaths([entry.path])
    setAnchorPath(entry.path)
    setContextMenu({
      kind: 'entry',
      ...clampMenuPosition(event.clientX, event.clientY, ENTRY_MENU_HEIGHT),
      entry,
    })
  }

  const openEntry = (entry: FilesystemEntry): void => {
    if (entry.type === 'directory') {
      void navigate(entry.path)
      return
    }
    openFile(entry)
  }

  const createFolder = async (): Promise<void> => {
    const manager = getActiveFilesystemManager()
    if (!manager) return
    try {
      const entry = await manager.createFolder(currentPath)
      if (entry) {
        setSelectedPaths([entry.path])
        setAnchorPath(entry.path)
        setRenamingPath(entry.path)
      }
    } catch (error) {
      console.error('Failed to create folder:', error)
    }
  }

  const performUpload = async (
    sources: readonly BrowserUploadSource[],
  ): Promise<void> => {
    const manager = getActiveFilesystemManager()
    if (!manager || sources.length === 0) return
    setUploadProgress({
      phase: 'preparing',
      completedBytes: 0,
      totalBytes: 0,
      detail: 'Preparing upload…',
    })
    try {
      await uploadBrowserSourcesToFilesystem({
        uploadUrl: manager.getUploadUrl(),
        directoryPath: currentPath,
        sources,
        onProgress: (progress) => setUploadProgress(progress),
      })
      await manager.subscribe(currentPath)
      const uploadedPaths = getUploadSelectionPaths(currentPath, sources)
      if (uploadedPaths.length > 0) {
        setSelectedPaths(uploadedPaths)
        setAnchorPath(uploadedPaths[0] ?? null)
      }
    } catch (error) {
      console.error('Failed to upload:', error)
      await manager.subscribe(currentPath).catch(() => undefined)
    } finally {
      setUploadProgress(null)
    }
  }

  const uploadFiles = (): void => {
    filesInputRef.current?.click()
  }

  const uploadFolder = async (): Promise<void> => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker
    if (!picker) {
      folderInputRef.current?.click()
      return
    }
    try {
      const handle = await picker({ mode: 'read' })
      const sources = await getDirectoryUploadSources(handle)
      await performUpload(sources)
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === 'AbortError' || error.name === 'NotAllowedError')
      ) {
        return
      }
      console.error('Failed to choose folder:', error)
    }
  }

  const trashEntries = useCallback(
    async (targets: readonly FilesystemEntry[]): Promise<void> => {
      const manager = getActiveFilesystemManager()
      if (!manager || targets.length === 0) return
      const paths = targets.map((entry) => entry.path)
      try {
        await manager.trash(paths)
        setSelectedPaths((current) => current.filter((p) => !paths.includes(p)))
        setAnchorPath((current) =>
          current !== null && paths.includes(current) ? null : current,
        )
        setRenamingPath((current) =>
          current !== null && paths.includes(current) ? null : current,
        )
      } catch (error) {
        console.error('Failed to trash:', error)
      }
    },
    [],
  )

  const downloadEntries = (targets: readonly FilesystemEntry[]): void => {
    const manager = getActiveFilesystemManager()
    if (!manager || targets.length === 0) return
    try {
      const url = manager.getDownloadUrl(targets.map((entry) => entry.path))
      const link = document.createElement('a')
      link.href = url
      link.download =
        targets.length === 1 ? (targets[0]?.name ?? '') : 'download.zip'
      document.body.append(link)
      link.click()
      link.remove()
    } catch (error) {
      console.error('Failed to download:', error)
    }
  }

  const copyEntries = (targets: readonly FilesystemEntry[]): void => {
    if (targets.length === 0) return
    setFilesystemClipboard('copy', targets)
  }

  const cutEntries = (targets: readonly FilesystemEntry[]): void => {
    if (targets.length === 0) return
    setFilesystemClipboard('cut', targets)
  }

  const pasteClipboard = async (): Promise<void> => {
    const manager = getActiveFilesystemManager()
    const clipboard = useFilesystemStore.getState().filesystemClipboard
    if (!manager || clipboard === null || clipboard.entries.length === 0) return

    try {
      const result = await manager.paste(
        clipboard.mode === 'cut' ? 'move' : 'copy',
        clipboard.entries.map((entry) => entry.path),
        currentPath,
      )
      const pastedPaths = result?.entries.map((entry) => entry.path) ?? []
      if (pastedPaths.length > 0) {
        setSelectedPaths(pastedPaths)
        setAnchorPath(pastedPaths[0] ?? null)
      }
      if (clipboard.mode === 'cut') {
        clearFilesystemClipboard()
      }
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const commitRename = async (
    entry: FilesystemEntry,
    nextName: string,
  ): Promise<void> => {
    const manager = getActiveFilesystemManager()
    const cleanName = nextName.trim()
    if (!manager || cleanName.length === 0 || cleanName === entry.name) {
      setRenamingPath(null)
      return
    }
    try {
      const renamed = await manager.rename(entry.path, cleanName)
      const nextPath = renamed?.path ?? entry.path
      setSelectedPaths([nextPath])
      setAnchorPath(nextPath)
      setRenamingPath(null)
    } catch (error) {
      console.error('Failed to rename:', error)
      setRenamingPath(null)
    }
  }

  useEffect(() => {
    if (contextMenu === null) return
    const close = () => setContextMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (renamingPath !== null) return
      if (selectedPaths.length === 0) return
      if (isEditableKeyboardTarget(event.target)) return
      const picked = (listing?.entries ?? []).filter((entry) =>
        selectedPaths.includes(entry.path),
      )
      if (picked.length === 0) return
      event.preventDefault()
      void trashEntries(picked)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listing, selectedPaths, renamingPath, trashEntries])

  if (listingError !== null) {
    return <FilesystemEmpty message={listingError} variant="error" />
  }

  if (!listing && isFetching) {
    return <FilesystemEmpty message="Loading folder..." />
  }

  const selectionBox =
    selectionRect === null ? null : normalizeSelectionRect(selectionRect)

  return (
    <div
      ref={bodyRef}
      className="relative h-full select-none overflow-y-auto pb-[12px] pl-[12px] pr-[2px] pt-[12px]"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        if (
          event.target instanceof Element &&
          event.target.closest('[data-entry-path]')
        ) {
          return
        }
        const body = bodyRef.current
        if (!body) return
        event.currentTarget.setPointerCapture(event.pointerId)
        const point = getContentPoint(event, body)
        setSelectionRect({
          originX: point.x,
          originY: point.y,
          currentX: point.x,
          currentY: point.y,
        })
        didDragRef.current = false
        setSelectedPaths([])
        setAnchorPath(null)
      }}
      onPointerMove={(event) => {
        const body = bodyRef.current
        if (!selectionRect || !body) return
        const point = getContentPoint(event, body)
        const nextRect = {
          ...selectionRect,
          currentX: point.x,
          currentY: point.y,
        }
        setSelectionRect(nextRect)
        const dragged =
          Math.abs(nextRect.currentX - nextRect.originX) > DRAG_THRESHOLD_PX ||
          Math.abs(nextRect.currentY - nextRect.originY) > DRAG_THRESHOLD_PX
        didDragRef.current = dragged
        if (dragged) {
          setSelectedPaths(
            getIntersectingPaths(body, normalizeSelectionRect(nextRect)),
          )
        }
      }}
      onPointerUp={(event) => {
        if (!selectionRect) return
        event.currentTarget.releasePointerCapture(event.pointerId)
        setSelectionRect(null)
      }}
      onPointerCancel={() => setSelectionRect(null)}
      onClick={(event) => {
        if (didDragRef.current) {
          didDragRef.current = false
          return
        }
        if (event.target === event.currentTarget) {
          setSelectedPaths([])
          setAnchorPath(null)
        }
      }}
      onContextMenu={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[data-entry-path]')
        ) {
          return
        }
        event.preventDefault()
        setContextMenu({
          kind: 'background',
          ...clampMenuPosition(
            event.clientX,
            event.clientY,
            BACKGROUND_MENU_HEIGHT,
          ),
        })
      }}
    >
      <input
        ref={filesInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const input = event.currentTarget
          const sources = fileListToSources(input.files, false)
          void performUpload(sources).finally(() => {
            input.value = ''
          })
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        {...folderPickerAttributes}
        onChange={(event) => {
          const input = event.currentTarget
          const sources = fileListToSources(input.files, true)
          void performUpload(sources).finally(() => {
            input.value = ''
          })
        }}
      />

      {entries.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-[24px] text-center">
          <p className="m-0 text-[12px] font-medium leading-[1.3] tracking-[-0.005em] text-black/[0.34] dark:text-white/[0.32]">
            This folder is empty.
          </p>
        </div>
      ) : (
        <div className="grid gap-x-[12px] gap-y-[8px] [grid-template-columns:repeat(auto-fill,96px)]">
          {entries.map((entry) => (
            <FilesystemTile
              key={entry.path}
              entry={entry}
              isSelected={selectedPaths.includes(entry.path)}
              isRenaming={renamingPath === entry.path}
              onSelect={(event) => handleSelect(entry, event)}
              onContextMenu={(event) => handleEntryContextMenu(entry, event)}
              onActivate={() => openEntry(entry)}
              onRenameCommit={(name) => void commitRename(entry, name)}
              onRenameCancel={() => setRenamingPath(null)}
            />
          ))}
        </div>
      )}

      {selectionBox === null ? null : (
        <div
          className="pointer-events-none absolute z-[10] rounded-[3px] border border-[rgba(0,100,225,0.75)] bg-[rgba(0,100,225,0.16)] dark:border-[rgba(66,149,255,0.82)] dark:bg-[rgba(66,149,255,0.2)]"
          style={{
            left: selectionBox.left,
            top: selectionBox.top,
            width: selectionBox.width,
            height: selectionBox.height,
          }}
        />
      )}

      {contextMenu === null ? null : contextMenu.kind === 'background' ? (
        <BackgroundContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canPaste={
            filesystemClipboard !== null &&
            filesystemClipboard.entries.length > 0
          }
          onCreateFolder={() => {
            setContextMenu(null)
            void createFolder()
          }}
          onPaste={() => {
            setContextMenu(null)
            void pasteClipboard()
          }}
          onUploadFiles={() => {
            setContextMenu(null)
            uploadFiles()
          }}
          onUploadFolder={() => {
            setContextMenu(null)
            void uploadFolder()
          }}
        />
      ) : contextMenu.kind === 'entry' ? (
        <EntryContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          onOpen={(entry) => {
            setContextMenu(null)
            openEntry(entry)
          }}
          onCopy={(entry) => {
            setContextMenu(null)
            copyEntries([entry])
          }}
          onCut={(entry) => {
            setContextMenu(null)
            cutEntries([entry])
          }}
          onRename={(entry) => {
            setContextMenu(null)
            setRenamingPath(entry.path)
          }}
          onGetInfo={() => setContextMenu(null)}
          onTrash={(entry) => {
            setContextMenu(null)
            void trashEntries([entry])
          }}
          onDownload={(entry) => {
            setContextMenu(null)
            downloadEntries([entry])
          }}
        />
      ) : (
        <SelectionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entries={contextMenu.entries}
          onCopy={(picked) => {
            setContextMenu(null)
            copyEntries(picked)
          }}
          onCut={(picked) => {
            setContextMenu(null)
            cutEntries(picked)
          }}
          onTrash={(picked) => {
            setContextMenu(null)
            void trashEntries(picked)
          }}
          onDownload={(picked) => {
            setContextMenu(null)
            downloadEntries(picked)
          }}
        />
      )}

      {uploadProgress === null ? null : (
        <FilesystemUploadDialog progress={uploadProgress} />
      )}
    </div>
  )
}

function FilesystemTile({
  entry,
  isSelected,
  isRenaming,
  onSelect,
  onContextMenu,
  onActivate,
  onRenameCommit,
  onRenameCancel,
}: {
  entry: FilesystemEntry
  isSelected: boolean
  isRenaming: boolean
  onSelect: (event: ReactMouseEvent) => void
  onContextMenu: (event: ReactMouseEvent) => void
  onActivate: () => void
  onRenameCommit: (name: string) => void
  onRenameCancel: () => void
}) {
  return (
    <button
      type="button"
      data-entry-path={entry.path}
      onClick={(event) => {
        if (!isRenaming) onSelect(event)
      }}
      onDoubleClick={() => {
        if (!isRenaming) onActivate()
      }}
      onContextMenu={(event) => {
        if (!isRenaming) onContextMenu(event)
      }}
      className="group flex flex-col items-center gap-[4px] rounded-lg px-[8px] pb-[8px] pt-[12px] text-center outline-none"
    >
      <div
        className={`flex h-[58px] w-[76px] max-w-[76px] flex-shrink-0 items-center justify-center rounded-lg transition-colors duration-[120ms] ${
          isSelected
            ? 'bg-black/[0.08] dark:bg-white/[0.12]'
            : 'group-hover:bg-black/[0.04] dark:group-hover:bg-white/[0.07]'
        }`}
      >
        <EntryImage entry={entry} />
      </div>
      {isRenaming ? (
        <RenameInput
          initial={entry.name}
          onCommit={onRenameCommit}
          onCancel={onRenameCancel}
        />
      ) : (
        <span
          title={entry.name}
          className={`max-w-[96px] overflow-hidden text-ellipsis whitespace-nowrap rounded-full px-[8px] py-[2px] text-[11px] leading-[1.2] transition-colors duration-[120ms] ${
            isSelected
              ? 'bg-[#0064e1] text-white'
              : 'text-black/[0.82] group-hover:bg-black/[0.04] dark:text-white/[0.82] dark:group-hover:bg-white/[0.07]'
          }`}
        >
          {entry.name}
        </span>
      )}
    </button>
  )
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const committedRef = useRef(false)
  const [value, setValue] = useState(initial)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const commit = () => {
    if (committedRef.current) return
    committedRef.current = true
    onCommit(value)
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          committedRef.current = true
          onCancel()
        }
      }}
      onBlur={commit}
      className="max-w-[92px] rounded-[3px] border border-[#0064e1] bg-white px-[5px] py-[1px] text-center text-[11px] leading-[1.2] text-black outline-none dark:border-[#4d9bff] dark:bg-[#242426] dark:text-white"
    />
  )
}

function EntryImage({ entry }: { entry: FilesystemEntry }) {
  const isDirectory = entry.type === 'directory'
  const src = isDirectory ? '/filesystem/Folder.png' : '/filesystem/File.png'
  const width = isDirectory ? 60 : 39
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      style={{ width, height: 52 }}
      className="select-none object-contain [filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.18))]"
    />
  )
}

function FilesystemEmpty({
  message,
  variant = 'info',
}: {
  message: string
  variant?: 'info' | 'error'
}) {
  return (
    <div className="flex h-full flex-1 items-center justify-center px-[24px] py-[48px] text-center">
      <p
        className={
          variant === 'error'
            ? 'm-0 max-w-[384px] text-[14px] text-[#c13e3e] dark:text-[#ff8a8a]'
            : 'm-0 max-w-[384px] text-[14px] text-black/[0.46] dark:text-white/[0.46]'
        }
      >
        {message}
      </p>
    </div>
  )
}

function fileListToSources(
  files: FileList | null,
  includeFolderPath: boolean,
): BrowserUploadSource[] {
  if (!files) return []
  return Array.from(files).map((file) => ({
    type: 'file',
    relativePath: includeFolderPath ? getBrowserRelativePath(file) : file.name,
    file,
  }))
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  )
}

function getContentPoint(
  event: ReactPointerEvent<HTMLElement>,
  container: HTMLElement,
): { x: number; y: number } {
  const rect = container.getBoundingClientRect()
  return {
    x: event.clientX - rect.left + container.scrollLeft,
    y: event.clientY - rect.top + container.scrollTop,
  }
}

function normalizeSelectionRect(rect: SelectionRect) {
  const left = Math.min(rect.originX, rect.currentX)
  const top = Math.min(rect.originY, rect.currentY)
  const right = Math.max(rect.originX, rect.currentX)
  const bottom = Math.max(rect.originY, rect.currentY)
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

function getIntersectingPaths(
  container: HTMLElement,
  box: { left: number; top: number; right: number; bottom: number },
): string[] {
  const containerRect = container.getBoundingClientRect()
  return Array.from(container.querySelectorAll<HTMLElement>('[data-entry-path]'))
    .filter((element) => {
      const rect = element.getBoundingClientRect()
      const itemBox = {
        left: rect.left - containerRect.left + container.scrollLeft,
        top: rect.top - containerRect.top + container.scrollTop,
        right: rect.right - containerRect.left + container.scrollLeft,
        bottom: rect.bottom - containerRect.top + container.scrollTop,
      }
      return (
        itemBox.left < box.right &&
        itemBox.right > box.left &&
        itemBox.top < box.bottom &&
        itemBox.bottom > box.top
      )
    })
    .map((element) => element.dataset.entryPath)
    .filter((path): path is string => typeof path === 'string')
}

function clampMenuPosition(
  clientX: number,
  clientY: number,
  menuHeight: number,
): { x: number; y: number } {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  return {
    x: Math.min(clientX, viewportWidth - CONTEXT_MENU_WIDTH - VIEWPORT_MARGIN),
    y: Math.min(clientY, viewportHeight - menuHeight - VIEWPORT_MARGIN),
  }
}
