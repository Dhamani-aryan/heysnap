import { memo, type ReactNode } from 'react'
import {
  getActiveFilesystemManager,
  useFilesystemStore,
} from '../../../stores/filesystem/filesystem-store.ts'
import type { FilesystemEntry } from '../../../lib/filesystem/types.ts'
import { FilesystemPane } from '../filesystem/filesystem-pane.tsx'
import { BrowserSurface } from '../browser/browser-surface.tsx'

export function WorkspaceSurfaceStack() {
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
  const src = manager?.getPreviewUrl(entry.path) ?? null

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
        src={src}
        title={entry.name}
        className="block h-full w-full border-0"
      />
    </section>
  )
})
