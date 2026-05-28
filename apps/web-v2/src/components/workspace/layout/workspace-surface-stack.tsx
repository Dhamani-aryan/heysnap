import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft02Icon,
  MoonEclipseIcon,
  PowerIcon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  getActiveFilesystemManager,
  useFilesystemStore,
} from '../../../stores/filesystem/filesystem-store.ts'
import { useResolvedTheme } from '../../../hooks/use-resolved-theme.ts'
import type { FilesystemEntry } from '../../../lib/filesystem/types.ts'
import { FilesystemPane } from '../filesystem/filesystem-pane.tsx'
import { BrowserSurface } from '../browser/browser-surface.tsx'
import { useIframeVoiceHotkeyBridge } from '../../../hooks/voice/use-iframe-voice-hotkey-bridge.ts'

export function WorkspaceSurfaceStack({
  isShuttingDown,
  onBackToMachines,
  onShutDownMachine,
}: {
  isShuttingDown: boolean
  onBackToMachines: () => void
  onShutDownMachine: () => Promise<void>
}) {
  const openFileTabs = useFilesystemStore((s) => s.openFileTabs)
  const activeFilePath = useFilesystemStore((s) => s.activeFilePath)
  const activeSurface = useFilesystemStore((s) => s.activeLeftPaneSurface)

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Surface isActive={activeSurface === 'directory'}>
        <FilesystemPane />
      </Surface>
      {openFileTabs.map((tab) => (
        <Surface
          key={tab.path}
          isActive={activeSurface === 'file' && tab.path === activeFilePath}
        >
          <FileSurface entry={tab} />
        </Surface>
      ))}
      <Surface isActive={activeSurface === 'browser'}>
        <BrowserSurface />
      </Surface>
      {activeSurface === 'directory' ? (
        <MachinePowerButton
          isShuttingDown={isShuttingDown}
          onBackToMachines={onBackToMachines}
          onShutDownMachine={onShutDownMachine}
        />
      ) : null}
    </div>
  )
}

function Surface({
  isActive,
  children,
}: {
  isActive: boolean
  children: ReactNode
}) {
  return (
    <div
      aria-hidden={!isActive}
      className={`absolute inset-0 flex min-h-0 min-w-0 flex-col ${
        isActive
          ? 'z-[1] visible pointer-events-auto'
          : 'z-0 invisible pointer-events-none'
      }`}
    >
      {children}
    </div>
  )
}

const FileSurface = memo(function FileSurface({
  entry,
}: {
  entry: FilesystemEntry
}) {
  const manager = getActiveFilesystemManager()
  const resolvedTheme = useResolvedTheme()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const src = manager?.getPreviewUrl(entry.path, resolvedTheme) ?? null

  useIframeVoiceHotkeyBridge(iframeRef, src)

  if (src === null) {
    return (
      <section
        aria-label={entry.name}
        className="flex h-full w-full items-center justify-center bg-card p-[24px] text-center"
      >
        <p className="m-0 max-w-[420px] text-[13px] leading-[1.5] text-black/[0.5] dark:text-white/[0.5]">
          File preview is not available on this server.
        </p>
      </section>
    )
  }

  return (
    <section
      aria-label={entry.name}
      className="flex h-full w-full bg-[#e9eaed] dark:bg-[#1a1a1d]"
    >
      <iframe
        ref={iframeRef}
        src={src}
        title={entry.name}
        className="block h-full w-full border-0"
      />
    </section>
  )
})

function MachinePowerButton({
  isShuttingDown,
  onBackToMachines,
  onShutDownMachine,
}: {
  isShuttingDown: boolean
  onBackToMachines: () => void
  onShutDownMachine: () => Promise<void>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const closeOnPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && containerRef.current?.contains(target)) {
        return
      }
      setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', closeOnPointerDown, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  const goBackToMachines = (): void => {
    setIsOpen(false)
    onBackToMachines()
  }

  const shutDownMachine = (): void => {
    if (isShuttingDown) return
    setIsOpen(false)
    void onShutDownMachine()
  }

  return (
    <div
      ref={containerRef}
      className="absolute bottom-[12px] left-[12px] z-[5]"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {isOpen ? (
        <div
          role="dialog"
          aria-label="Machine actions"
          className="absolute bottom-[calc(100%+8px)] left-0 flex w-[152px] flex-col gap-[2px] rounded-[10px] border border-black/10 bg-card p-[5px] text-card-foreground shadow-[0_12px_36px_rgba(0,0,0,0.18)] dark:border-white/10 dark:shadow-[0_14px_42px_rgba(0,0,0,0.42)]"
        >
          <MachinePowerMenuItem
            icon={ArrowLeft02Icon}
            label="Back"
            onClick={goBackToMachines}
          />
          <MachinePowerMenuItem
            icon={Settings01Icon}
            label="Settings"
            onClick={() => setIsOpen(false)}
          />
          <MachinePowerMenuItem
            icon={MoonEclipseIcon}
            label="Shut down"
            disabled={isShuttingDown}
            onClick={shutDownMachine}
          />
        </div>
      ) : null}
      <button
        type="button"
        aria-label="Machine power"
        aria-expanded={isOpen}
        title="Machine power"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-black/[0.06] bg-card text-card-foreground shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-[transform,background-color,color,border-color] duration-150 ease-out hover:bg-secondary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ghost active:scale-[0.96] dark:border-white/[0.08] dark:shadow-[0_8px_24px_rgba(0,0,0,0.34)]"
        onClick={() => setIsOpen((current) => !current)}
      >
        <HugeiconsIcon
          icon={PowerIcon}
          size={18}
          color="currentColor"
          strokeWidth={1.75}
        />
      </button>
    </div>
  )
}

function MachinePowerMenuItem({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="flex h-9 w-full items-center gap-[10px] rounded-md px-[9px] text-left text-[13px] font-medium leading-none text-card-foreground transition-colors duration-150 hover:bg-secondary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ghost disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
      onClick={onClick}
    >
      <HugeiconsIcon
        icon={icon}
        size={17}
        color="currentColor"
        strokeWidth={1.75}
      />
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        {label}
      </span>
    </button>
  )
}
