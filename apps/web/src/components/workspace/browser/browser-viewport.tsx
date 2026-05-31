import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type MutableRefObject,
} from 'react'
import { useBrowserStore } from '../../../stores/browser/browser-store.ts'
import { getActiveBrowserExtensionBridge } from '../../../stores/browser/browser-store.ts'
import {
  getBrowserViewportInputPoint,
  getBrowserViewportInputRatio,
  readBrowserFrameAspectRatio,
  toBrowserViewportKeyboardInput,
} from '../../../lib/browser/browser-viewport.ts'
import { BROWSER_POINTER_CURSOR } from '../../../lib/browser/browser-cursor.ts'
import {
  clickBrowserViewport,
  typeBrowserViewport,
  wheelBrowserViewport,
} from '../../../lib/browser/browser-actions.ts'
import type { BrowserViewportWheelInput } from '../../../lib/browser/browser-input-types.ts'
import {
  dispatchVoiceHotkeyEvent,
  isVoiceHotkey,
  isVoiceHotkeyCharacterKey,
  isVoiceHotkeyReleaseKey,
} from '../../../lib/voice/voice-hotkey.ts'

export function BrowserViewport({
  onNaturalAspectRatio,
}: {
  onNaturalAspectRatio: (ratio: number | null) => void
}) {
  const screencast = useBrowserStore((s) => s.screencast)
  const activeTabId = useBrowserStore((s) => s.activeTabId)

  const screenRef = useRef<HTMLDivElement | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const pendingScrollRef = useRef<BrowserViewportWheelInput | null>(null)
  const isVoiceHotkeyActiveRef = useRef(false)
  const [isKeyboardActive, setIsKeyboardActive] = useState(false)

  const activeFrameUrl =
    screencast.tabId !== null && screencast.tabId === activeTabId
      ? screencast.frameUrl
      : null
  const transitionFrameUrl =
    activeFrameUrl === null &&
    activeTabId !== null &&
    screencast.tabId !== null &&
    screencast.tabId !== activeTabId
      ? screencast.frameUrl
      : null
  const frameUrl = activeFrameUrl ?? transitionFrameUrl
  const canSendInput =
    activeTabId !== null &&
    activeFrameUrl !== null &&
    screencast.state === 'streaming'

  const flushScroll = useCallback(() => {
    scrollFrameRef.current = null
    const pending = pendingScrollRef.current
    pendingScrollRef.current = null
    if (pending === null) return
    const bridge = getActiveBrowserExtensionBridge()
    if (bridge === null) return
    const controller = new AbortController()
    void wheelBrowserViewport({
      bridge,
      wheel: pending,
      signal: controller.signal,
    }).catch(() => undefined)
  }, [])

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const screen = screenRef.current
      if (!canSendInput || screen === null || activeTabId === null) return
      const ratio = getBrowserViewportInputRatio(
        screen,
        event.clientX,
        event.clientY,
      )
      const fallbackPoint = getBrowserViewportInputPoint(
        screen,
        event.clientX,
        event.clientY,
      )
      if (ratio === null || fallbackPoint === null) return
      event.preventDefault()
      event.stopPropagation()
      const bridge = getActiveBrowserExtensionBridge()
      if (bridge === null) return
      const controller = new AbortController()
      void clickBrowserViewport({
        bridge,
        click: { tabId: activeTabId, ratio, fallbackPoint },
        signal: controller.signal,
      }).catch(() => undefined)
    },
    [activeTabId, canSendInput],
  )

  useEffect(() => {
    const screen = screenRef.current
    if (screen === null) return

    const handleWheel = (event: WheelEvent): void => {
      if (!canSendInput || activeTabId === null) return
      const ratio = getBrowserViewportInputRatio(
        screen,
        event.clientX,
        event.clientY,
      )
      const fallbackPoint = getBrowserViewportInputPoint(
        screen,
        event.clientX,
        event.clientY,
      )
      if (ratio === null || fallbackPoint === null) return
      event.preventDefault()
      event.stopPropagation()
      const pending = pendingScrollRef.current
      pendingScrollRef.current = {
        tabId: activeTabId,
        fallbackPoint,
        ratio,
        deltaX: (pending?.deltaX ?? 0) + event.deltaX,
        deltaY: (pending?.deltaY ?? 0) + event.deltaY,
      }
      if (scrollFrameRef.current === null) {
        scrollFrameRef.current = window.requestAnimationFrame(flushScroll)
      }
    }

    screen.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      screen.removeEventListener('wheel', handleWheel)
    }
  }, [activeTabId, canSendInput, flushScroll])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const screen = screenRef.current
      const inside =
        screen !== null &&
        event.target instanceof Node &&
        screen.contains(event.target)
      setIsKeyboardActive(inside && canSendInput)
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [canSendInput])

  useEffect(() => {
    if (!isKeyboardActive || !canSendInput || activeTabId === null) return

    const handleKey = (event: KeyboardEvent): void => {
      if (shouldReserveVoiceHotkey(event, isVoiceHotkeyActiveRef)) return
      if (isEditableTarget(event.target) || event.isComposing) return
      const input = toBrowserViewportKeyboardInput(activeTabId, event)
      if (input === null) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      const bridge = getActiveBrowserExtensionBridge()
      if (bridge === null) return
      const controller = new AbortController()
      void typeBrowserViewport({
        bridge,
        key: input,
        signal: controller.signal,
      }).catch(() => undefined)
    }

    window.addEventListener('keydown', handleKey, true)
    window.addEventListener('keyup', handleKey, true)
    return () => {
      window.removeEventListener('keydown', handleKey, true)
      window.removeEventListener('keyup', handleKey, true)
      isVoiceHotkeyActiveRef.current = false
    }
  }, [activeTabId, canSendInput, isKeyboardActive])

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }
    },
    [],
  )

  const overlay = getOverlayMessage(screencast.state, frameUrl)

  return (
    <div
      ref={screenRef}
      aria-label="Browser viewport"
      data-stream-state={screencast.state}
      onClick={handleClick}
      style={{ cursor: BROWSER_POINTER_CURSOR }}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
    >
      {frameUrl !== null ? (
        <img
          src={frameUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 block h-full w-full select-none object-fill"
          onLoad={(event) => {
            const next = readBrowserFrameAspectRatio(
              event.currentTarget.naturalWidth /
                event.currentTarget.naturalHeight,
            )
            onNaturalAspectRatio(next)
          }}
        />
      ) : null}
      {overlay === null ? null : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center">
          <p className="m-0 max-w-[420px] text-[12.5px] leading-[1.5] text-black">
            {overlay}
          </p>
        </div>
      )}
    </div>
  )
}

function getOverlayMessage(
  state: string,
  frameUrl: string | null,
): string | null {
  if (frameUrl !== null && (state === 'streaming' || state === 'connecting')) {
    return null
  }
  switch (state) {
    case 'connecting':
      return 'Connecting to browser tab…'
    case 'streaming':
      return 'Waiting for first frame…'
    case 'new_tab':
      return 'Enter a URL to start browsing.'
    case 'stopped':
      return 'Stream stopped.'
    case 'error':
      return 'Browser stream error.'
    case 'idle':
    default:
      return 'No active tab.'
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null) return false
  if (target instanceof HTMLInputElement) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return false
}

function shouldReserveVoiceHotkey(
  event: KeyboardEvent,
  isActiveRef: MutableRefObject<boolean>,
): boolean {
  if (event.type === 'keydown' && isVoiceHotkey(event)) {
    isActiveRef.current = true
    return true
  }
  if (!isActiveRef.current || event.type !== 'keyup') return false
  if (!isVoiceHotkeyReleaseKey(event)) return false
  if (isVoiceHotkeyCharacterKey(event)) {
    isActiveRef.current = false
    return true
  }
  dispatchVoiceHotkeyEvent(window, 'keyup', event)
  return false
}
