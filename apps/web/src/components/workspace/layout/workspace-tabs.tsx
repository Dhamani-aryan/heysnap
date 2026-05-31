import { HugeiconsIcon } from '@hugeicons/react'
import { File02Icon, InternetIcon } from '@hugeicons/core-free-icons'
import { useEffect } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useFilesystemStore } from '../../../stores/filesystem/filesystem-store.ts'
import { useBrowserStore } from '../../../stores/browser/browser-store.ts'
import type { FilesystemEntry } from '../../../lib/filesystem/types.ts'
import { getFilesystemFileTypeIconSrc } from '../../../lib/filesystem/filesystem-icons.ts'

const LONG_NAME_THRESHOLD = 24

export function WorkspaceTabsStrip() {
  const directoryName = useFilesystemStore((s) => s.listing?.name ?? '')
  const activeSurface = useFilesystemStore((s) => s.activeLeftPaneSurface)
  const openFileTabs = useFilesystemStore((s) => s.openFileTabs)
  const activeFilePath = useFilesystemStore((s) => s.activeFilePath)
  const selectFileTab = useFilesystemStore((s) => s.selectFileTab)
  const closeFileTab = useFilesystemStore((s) => s.closeFileTab)
  const showDirectory = useFilesystemStore((s) => s.showDirectory)
  const showBrowser = useFilesystemStore((s) => s.showBrowser)
  const extensionStatus = useBrowserStore((s) => s.extensionStatus)
  const windowId = useBrowserStore((s) => s.windowId)
  const isWindowHydrated = useBrowserStore((s) => s.isWindowHydrated)
  const isOpeningWindow = useBrowserStore((s) => s.isOpeningWindow)
  const ensureBrowserWindow = useBrowserStore((s) => s.ensureBrowserWindow)
  const closeBrowserWindow = useBrowserStore((s) => s.closeBrowserWindow)
  const windowError = useBrowserStore((s) => s.windowError)

  const handleOpenBrowser = (): void => {
    showBrowser()
    if (windowId === null && !isOpeningWindow) {
      void ensureBrowserWindow()
    }
  }

  useEffect(() => {
    if (
      activeSurface === 'browser' &&
      isWindowHydrated &&
      windowId === null &&
      !isOpeningWindow &&
      windowError === null
    ) {
      showDirectory()
    }
  }, [
    activeSurface,
    isWindowHydrated,
    windowId,
    isOpeningWindow,
    windowError,
    showDirectory,
  ])

  return (
    <div className="flex min-w-0 flex-1 items-center gap-[8px] overflow-hidden">
      <DirectoryTab
        title={directoryName}
        isActive={activeSurface === 'directory'}
        onSelect={showDirectory}
      />
      {extensionStatus === 'available' ? (
        windowId === null ? (
          <BrowserCollapsedTab
            isActive={activeSurface === 'browser'}
            isOpening={isOpeningWindow}
            onSelect={handleOpenBrowser}
          />
        ) : (
          <BrowserExpandedTab
            isActive={activeSurface === 'browser'}
            onSelect={handleOpenBrowser}
            onClose={() => {
              showDirectory()
              void closeBrowserWindow()
            }}
          />
        )
      ) : null}
      <div
        role="tablist"
        aria-label="Open files"
        className="flex min-w-0 flex-1 items-center gap-[4px] overflow-hidden"
      >
        {openFileTabs.map((tab) => (
          <FileTab
            key={tab.path}
            tab={tab}
            isActive={
              activeSurface === 'file' && tab.path === activeFilePath
            }
            onSelect={() => selectFileTab(tab.path)}
            onClose={() => closeFileTab(tab.path)}
          />
        ))}
      </div>
    </div>
  )
}

function DirectoryTab({
  title,
  isActive,
  onSelect,
}: {
  title: string
  isActive: boolean
  onSelect: () => void
}) {
  if (title.length === 0) return null
  return (
    <button
      type="button"
      title={title}
      onClick={onSelect}
      className={`inline-flex min-w-0 flex-shrink-0 items-center gap-[6px] overflow-hidden whitespace-nowrap rounded-[6px] px-[8px] py-[4px] text-[12px] font-medium tracking-[0] transition-colors duration-[120ms] hover:bg-black/[0.045] dark:hover:bg-white/[0.08] ${
        isActive
          ? 'text-black/[0.82] dark:text-white/[0.86]'
          : 'text-black/[0.5] dark:text-white/[0.5]'
      }`}
    >
      <span className="min-w-0 overflow-hidden text-ellipsis">{title}</span>
    </button>
  )
}

function BrowserCollapsedTab({
  isActive,
  isOpening,
  onSelect,
}: {
  isActive: boolean
  isOpening: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      title={isOpening ? 'Opening browser…' : 'Open browser'}
      aria-label="Open browser"
      aria-pressed={isActive}
      onClick={onSelect}
      className={`group inline-flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-[8px] transition-colors duration-[120ms] ${
        isActive
          ? 'bg-black/[0.06] text-black/[0.82] dark:bg-white/[0.10] dark:text-white/[0.86]'
          : 'text-black/[0.55] hover:bg-black/[0.045] hover:text-black/[0.82] dark:text-white/[0.55] dark:hover:bg-white/[0.08] dark:hover:text-white/[0.86]'
      } ${isOpening ? 'animate-pulse' : ''}`}
    >
      <HugeiconsIcon
        icon={InternetIcon}
        size={14}
        color="currentColor"
        strokeWidth={1.8}
      />
    </button>
  )
}

function BrowserExpandedTab({
  isActive,
  onSelect,
  onClose,
}: {
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}) {
  return (
    <div
      role="tab"
      aria-selected={isActive}
      className={`group relative flex h-[32px] min-w-[64px] max-w-[160px] flex-shrink-0 items-center gap-[8px] overflow-hidden rounded-[8px] pl-[10px] pr-[12px] transition-colors duration-[120ms] ${
        isActive
          ? 'bg-black/[0.045] text-black/[0.82] dark:bg-white/[0.08] dark:text-white/[0.86]'
          : 'text-black/[0.58] hover:bg-black/[0.045] hover:text-black/[0.82] dark:text-white/[0.58] dark:hover:bg-white/[0.08] dark:hover:text-white/[0.86]'
      }`}
    >
      <span className="relative inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center">
        <span className="pointer-events-none inline-flex items-center justify-center opacity-[0.86] transition-opacity duration-[120ms] group-hover:opacity-0">
          <HugeiconsIcon
            icon={InternetIcon}
            size={14}
            color="currentColor"
            strokeWidth={1.8}
          />
        </span>
        <button
          type="button"
          aria-label="Close browser"
          title="Close browser"
          onClick={(event: ReactMouseEvent) => {
            event.stopPropagation()
            onClose()
          }}
          className="pointer-events-none absolute inset-[1px] inline-flex h-[16px] w-[16px] items-center justify-center rounded-full bg-black/[0.22] text-white opacity-0 transition-[background-color,opacity,color] duration-[120ms] group-hover:pointer-events-auto group-hover:opacity-100 hover:!bg-black/[0.32] dark:bg-white/[0.48] dark:text-[#111] dark:hover:!bg-white/[0.62]"
        >
          <CloseGlyph />
        </button>
      </span>
      <button
        type="button"
        title="Browser"
        onClick={onSelect}
        tabIndex={isActive ? 0 : -1}
        className="flex min-w-0 flex-shrink basis-auto items-center self-stretch p-0 text-left text-inherit"
      >
        <span className="block min-w-0 overflow-hidden whitespace-nowrap text-[12px] font-medium leading-[16px]">
          Browser
        </span>
      </button>
    </div>
  )
}

function FileTab({
  tab,
  isActive,
  onSelect,
  onClose,
}: {
  tab: FilesystemEntry
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}) {
  const iconSrc = getFilesystemFileTypeIconSrc(tab.name)
  const isLongName = tab.name.length > LONG_NAME_THRESHOLD

  return (
    <div
      role="tab"
      aria-selected={isActive}
      className={`group relative flex h-[32px] min-w-[64px] max-w-[238px] flex-shrink basis-auto items-center gap-[8px] overflow-hidden rounded-[8px] pl-[10px] pr-[12px] transition-colors duration-[120ms] ${
        isActive
          ? 'bg-black/[0.045] text-black/[0.82] dark:bg-white/[0.08] dark:text-white/[0.86]'
          : 'text-black/[0.58] hover:bg-black/[0.045] hover:text-black/[0.82] dark:text-white/[0.58] dark:hover:bg-white/[0.08] dark:hover:text-white/[0.86]'
      }`}
    >
      <span className="relative inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center">
        <span className="pointer-events-none inline-flex items-center justify-center opacity-[0.86] transition-opacity duration-[120ms] group-hover:opacity-0">
          {iconSrc === null ? (
            <HugeiconsIcon
              icon={File02Icon}
              size={16}
              color="currentColor"
              strokeWidth={1.8}
            />
          ) : (
            <img
              src={iconSrc}
              alt=""
              draggable={false}
              className="block h-[17px] w-auto select-none"
            />
          )}
        </span>
        <button
          type="button"
          aria-label={`Close ${tab.name}`}
          title="Close tab"
          onClick={(event: ReactMouseEvent) => {
            event.stopPropagation()
            onClose()
          }}
          className="pointer-events-none absolute inset-[1px] inline-flex h-[16px] w-[16px] items-center justify-center rounded-full bg-black/[0.22] text-white opacity-0 transition-[background-color,opacity,color] duration-[120ms] group-hover:pointer-events-auto group-hover:opacity-100 hover:!bg-black/[0.32] dark:bg-white/[0.48] dark:text-[#111] dark:hover:!bg-white/[0.62]"
        >
          <CloseGlyph />
        </button>
      </span>
      <button
        type="button"
        title={tab.path}
        onClick={onSelect}
        tabIndex={isActive ? 0 : -1}
        className="flex min-w-0 max-w-[190px] flex-shrink basis-auto items-center self-stretch p-0 text-left text-inherit"
      >
        <span
          className="block min-w-0 max-w-full overflow-hidden whitespace-nowrap text-[12px] font-medium leading-[16px]"
          style={
            isLongName
              ? {
                  WebkitMaskImage:
                    'linear-gradient(to right, #000 0, #000 calc(100% - 18px), transparent 100%)',
                  maskImage:
                    'linear-gradient(to right, #000 0, #000 calc(100% - 18px), transparent 100%)',
                }
              : undefined
          }
        >
          {tab.name}
        </span>
      </button>
    </div>
  )
}

function CloseGlyph() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m3.2 3.2 5.6 5.6M8.8 3.2 3.2 8.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}
