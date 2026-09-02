import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Cancel01Icon, SmartPhone02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  DEFAULT_BROWSER_WINDOW_BOUNDS,
  MOBILE_BROWSER_WINDOW_BOUNDS,
} from '../../../lib/browser/browser-extension-bridge.ts'
import {
  getActiveBrowserExtensionBridge,
  useBrowserStore,
} from '../../../stores/browser/browser-store.ts'

type WorkspaceMobileDrawerProps = {
  open: boolean
  onClose: () => void
}

export function WorkspaceMobileDrawer({
  open,
  onClose,
}: WorkspaceMobileDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const wasOpenRef = useRef(false)
  const extensionStatus = useBrowserStore((s) => s.extensionStatus)
  const ensureBrowserWindow = useBrowserStore((s) => s.ensureBrowserWindow)

  useEffect(() => {
    if (!open || extensionStatus !== 'available') return
    wasOpenRef.current = true

    const controller = new AbortController()
    void (async () => {
      const bridge = getActiveBrowserExtensionBridge()
      if (bridge === null) return

      const resolvedWindowId =
        useBrowserStore.getState().windowId ??
        (await ensureBrowserWindow({
          bounds: MOBILE_BROWSER_WINDOW_BOUNDS,
        }))
      if (resolvedWindowId === null) return

      await bridge
        .updateBrowserWindowBounds(
          resolvedWindowId,
          MOBILE_BROWSER_WINDOW_BOUNDS,
          controller.signal,
        )
        .catch(() => undefined)
    })()

    return () => {
      controller.abort()
    }
  }, [ensureBrowserWindow, extensionStatus, open])

  useEffect(() => {
    if (open || !wasOpenRef.current) return
    wasOpenRef.current = false
    restoreDefaultBrowserWindowBounds()
  }, [open])

  useEffect(() => {
    return () => {
      if (!wasOpenRef.current) return
      wasOpenRef.current = false
      restoreDefaultBrowserWindowBounds()
    }
  }, [])

  useEffect(() => {
    if (!open) return

    closeButtonRef.current?.focus({ preventScroll: true })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  if (!open) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[1200]">
      <button
        type="button"
        aria-label="Close mobile drawer"
        className="absolute inset-0 cursor-default bg-black/32 backdrop-blur-[2px] transition-opacity dark:bg-black/54"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Mobile browser streaming"
        className="absolute inset-x-[8px] bottom-0 flex h-[calc(100dvh-42px)] max-h-[calc(100dvh-42px)] animate-workspace-bottom-sheet-in flex-col overflow-hidden rounded-t-[22px] border border-black/10 bg-background text-heading shadow-[0_-20px_80px_rgba(0,0,0,0.28)] dark:border-white/10 dark:shadow-[0_-28px_90px_rgba(0,0,0,0.55)]"
      >
        <div className="relative flex h-[58px] flex-shrink-0 items-center justify-between border-b border-border px-[18px]">
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-[9px] h-[4px] w-[42px] -translate-x-1/2 rounded-full bg-black/18 dark:bg-white/22"
          />
          <div className="flex items-center pt-[8px]">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-active text-heading dark:bg-sidebar-hover">
              <HugeiconsIcon
                icon={SmartPhone02Icon}
                size={18}
                strokeWidth={1.75}
              />
            </span>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close mobile drawer"
            title="Close"
            onClick={onClose}
            className="mt-[8px] inline-flex h-8 w-8 items-center justify-center rounded-md text-subheading transition-[transform,background-color,color] duration-150 ease-out hover:bg-sidebar-hover hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ghost active:scale-[0.97]"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
          <div className="w-full max-w-[430px] text-center">
            <p className="text-[18px] font-medium leading-7 tracking-[0] text-heading">
              Browser streaming started for mobile app
            </p>
            <p className="mt-2 text-[13px] leading-5 tracking-[0] text-subheading">
              Keep this tab and device opened to continue using the browser on mobile app
            </p>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}

function restoreDefaultBrowserWindowBounds() {
  const bridge = getActiveBrowserExtensionBridge()
  if (bridge === null) return

  const { windowId } = useBrowserStore.getState()
  if (windowId === null) return

  const controller = new AbortController()
  void bridge
    .updateBrowserWindowBounds(
      windowId,
      DEFAULT_BROWSER_WINDOW_BOUNDS,
      controller.signal,
    )
    .catch(() => undefined)
}
