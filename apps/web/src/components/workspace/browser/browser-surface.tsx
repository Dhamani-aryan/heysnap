import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useBrowserStore } from '../../../stores/browser/browser-store.ts'
import { BROWSER_POINTER_CURSOR } from '../../../lib/browser/browser-cursor.ts'
import { readBrowserFrameAspectRatio } from '../../../lib/browser/browser-viewport.ts'
import { BrowserAddressBar } from './browser-address-bar.tsx'
import { BrowserTabBar } from './browser-tab-bar.tsx'
import { BrowserViewport } from './browser-viewport.tsx'
import './browser-chrome.css'

const TAB_BAR_HEIGHT = 36
const TOOL_BAR_HEIGHT = 40
const DEFAULT_ASPECT_RATIO = 16 / 10

export function BrowserSurface() {
  const windowId = useBrowserStore((s) => s.windowId)
  const isOpeningWindow = useBrowserStore((s) => s.isOpeningWindow)
  const windowError = useBrowserStore((s) => s.windowError)
  const extensionStatus = useBrowserStore((s) => s.extensionStatus)
  const ensureBrowserWindow = useBrowserStore((s) => s.ensureBrowserWindow)
  const screencastAspectRatio = useBrowserStore((s) => s.screencast.aspectRatio)

  const panelRef = useRef<HTMLElement | null>(null)
  const [panelSize, setPanelSize] = useState({ width: 0, height: 0 })
  const [naturalAspectRatio, setNaturalAspectRatio] = useState<number | null>(
    null,
  )

  useEffect(() => {
    const element = panelRef.current
    if (element === null) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      const { width, height } = entry.contentRect
      setPanelSize({ width, height })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  const aspectRatio =
    readBrowserFrameAspectRatio(screencastAspectRatio) ??
    naturalAspectRatio ??
    DEFAULT_ASPECT_RATIO

  const availableScreenHeight = Math.max(
    0,
    panelSize.height - TAB_BAR_HEIGHT - TOOL_BAR_HEIGHT,
  )
  const screenWidthFromHeight = availableScreenHeight * aspectRatio
  const screenWidth = Math.max(
    0,
    Math.min(panelSize.width, screenWidthFromHeight),
  )
  const screenHeight = screenWidth > 0 ? screenWidth / aspectRatio : 0
  const windowHeight = TAB_BAR_HEIGHT + TOOL_BAR_HEIGHT + screenHeight

  const layoutStyle = {
    '--browser-window-width': `${screenWidth}px`,
    '--browser-window-height': `${windowHeight}px`,
    '--browser-tab-bar-height': `${TAB_BAR_HEIGHT}px`,
    '--browser-tool-bar-height': `${TOOL_BAR_HEIGHT}px`,
  } as CSSProperties

  return (
    <section
      ref={panelRef}
      aria-label="Browser"
      className="browser-window-panel"
      style={{ cursor: BROWSER_POINTER_CURSOR }}
    >
      {windowId === null ? (
        <EmptyState
          isOpening={isOpeningWindow}
          error={windowError}
          extensionAvailable={extensionStatus === 'available'}
          onRetry={() => {
            void ensureBrowserWindow()
          }}
        />
      ) : (
        <div className="browser-window-layout" style={layoutStyle}>
          <BrowserTabBar />
          <BrowserAddressBar />
          <div className="browser-window-stage">
            <BrowserViewport
              onNaturalAspectRatio={setNaturalAspectRatio}
            />
          </div>
        </div>
      )}
    </section>
  )
}

function EmptyState({
  isOpening,
  error,
  extensionAvailable,
  onRetry,
}: {
  isOpening: boolean
  error: string | null
  extensionAvailable: boolean
  onRetry: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[14px] p-[24px] text-center">
      <p className="m-0 max-w-[420px] text-[13px] leading-[1.5] text-black/[0.55] dark:text-white/[0.55]">
        {extensionAvailable
          ? isOpening
            ? 'Opening browser window…'
            : error === null
              ? 'Preparing browser…'
              : error
          : 'The browser surface requires the HeySnap Chrome extension. Install it to continue.'}
      </p>
      {extensionAvailable && error !== null && !isOpening ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-[34px] items-center gap-[8px] rounded-[8px] bg-black/[0.85] px-[16px] text-[12.5px] font-semibold tracking-[-0.01em] text-white shadow-[0_4px_16px_rgba(0,0,0,0.12)] transition-[transform,background-color,opacity] duration-[120ms] hover:bg-black active:scale-[0.98] dark:bg-white/[0.92] dark:text-black dark:hover:bg-white"
        >
          Retry
        </button>
      ) : null}
    </div>
  )
}
