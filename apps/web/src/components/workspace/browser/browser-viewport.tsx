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
  getBrowserFrameStats,
  getLastBrowserFrame,
  recordBrowserFrameDrop,
  recordBrowserFramePaint,
  recordBrowserFrameSkip,
  subscribeBrowserFrames,
  type BrowserFrame,
} from '../../../lib/browser/browser-frame-bus.ts'
import {
  areBrowserFrameFingerprintsSimilar,
  compareBrowserFrameFingerprints,
  createBrowserFrameFingerprint,
  isBrowserFrameBlurRegression,
  type BrowserFrameFingerprint,
} from '../../../lib/browser/browser-frame-fingerprint.ts'
import {
  dispatchVoiceHotkeyEvent,
  isVoiceHotkey,
  isVoiceHotkeyCharacterKey,
  isVoiceHotkeyReleaseKey,
} from '../../../lib/voice/voice-hotkey.ts'

const CAPTURE_VIEWPORT_DEBOUNCE_MS = 120
const RECENT_INPUT_COMPARE_BYPASS_MS = 900

export function BrowserViewport({
  captureHeight,
  captureWidth,
  onNaturalAspectRatio,
}: {
  captureHeight: number
  captureWidth: number
  onNaturalAspectRatio: (ratio: number | null) => void
}) {
  const screencast = useBrowserStore((s) => s.screencast)
  const activeTabId = useBrowserStore((s) => s.activeTabId)
  const setCaptureViewport = useBrowserStore((s) => s.setCaptureViewport)

  const screenRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const activeTabIdRef = useRef<number | null>(activeTabId)
  const isDisposedRef = useRef(false)
  const isRenderingFrameRef = useRef(false)
  const lastPaintedDataUrlRef = useRef<string | null>(null)
  const lastPaintedFingerprintRef = useRef<BrowserFrameFingerprint | null>(null)
  const lastPaintedSizeRef = useRef<{ height: number; width: number } | null>(null)
  const lastPaintedSequenceRef = useRef(0)
  const lastPaintedTabIdRef = useRef<number | null>(null)
  const lastStatsStoreUpdateRef = useRef(0)
  const pendingFrameRef = useRef<BrowserFrame | null>(null)
  const recentInputUntilRef = useRef(0)
  const fingerprintCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderFrameRef = useRef<number | null>(null)
  const renderLatestFrameRef = useRef<(() => Promise<void>) | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const pendingScrollRef = useRef<BrowserViewportWheelInput | null>(null)
  const isVoiceHotkeyActiveRef = useRef(false)
  const [isKeyboardActive, setIsKeyboardActive] = useState(false)
  const [visibleFrameTabId, setVisibleFrameTabId] = useState<number | null>(null)

  const hasVisibleFrame =
    visibleFrameTabId !== null && !shouldClearCanvasForState(screencast.state)
  const canSendInput =
    activeTabId !== null &&
    visibleFrameTabId === activeTabId &&
    screencast.state === 'streaming'

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const width = Math.round(captureWidth)
      const height = Math.round(captureHeight)
      setCaptureViewport(
        width > 0 && height > 0
          ? {
              devicePixelRatio: window.devicePixelRatio || 1,
              height,
              width,
            }
          : null,
      )
    }, CAPTURE_VIEWPORT_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [captureHeight, captureWidth, setCaptureViewport])

  useEffect(
    () => () => {
      setCaptureViewport(null)
    },
    [setCaptureViewport],
  )

  const syncScreencastStats = useCallback((tabId: number, force = false) => {
    const now = Date.now()
    if (!force && now - lastStatsStoreUpdateRef.current < 1000) return
    lastStatsStoreUpdateRef.current = now

    const store = useBrowserStore.getState()
    const current = store.screencast
    if (current.tabId !== tabId) return

    const frameStats = getBrowserFrameStats(tabId)
    store.setScreencast({
      ...current,
      lastFrameAt: frameStats.lastFrameAt ?? current.lastFrameAt,
      stats: {
        droppedFrames: frameStats.droppedFrames,
        lastFrameEstimatedBytes: frameStats.lastFrameEstimatedBytes,
        lastPaintedAt: frameStats.lastPaintedAt,
        paintedFrames: frameStats.paintedFrames,
        receivedFrames: frameStats.receivedFrames,
        restartCount: frameStats.restartCount,
        skippedFrames: frameStats.skippedFrames,
      },
    })
  }, [])

  const markRecentInput = useCallback(() => {
    recentInputUntilRef.current = Date.now() + RECENT_INPUT_COMPARE_BYPASS_MS
  }, [])

  const requestRenderFrame = useCallback((): void => {
    if (renderFrameRef.current !== null) return
    renderFrameRef.current = window.requestAnimationFrame(() => {
      renderFrameRef.current = null
      void renderLatestFrameRef.current?.()
    })
  }, [])

  const renderLatestFrame = useCallback(async () => {
    if (isDisposedRef.current || isRenderingFrameRef.current) return
    const frame = pendingFrameRef.current
    if (frame === null) return

    pendingFrameRef.current = null
    if (frame.sequence <= lastPaintedSequenceRef.current) {
      recordBrowserFrameDrop(frame.tabId)
      syncScreencastStats(frame.tabId)
      return
    }

    if (
      lastPaintedTabIdRef.current === frame.tabId &&
      lastPaintedDataUrlRef.current === frame.dataUrl
    ) {
      lastPaintedSequenceRef.current = frame.sequence
      recordBrowserFrameSkip(frame.tabId)
      syncScreencastStats(frame.tabId)
      return
    }

    isRenderingFrameRef.current = true
    let decodedFrame: DecodedBrowserFrame | null = null

    try {
      decodedFrame = await decodeBrowserFrame(frame.dataUrl)
      const newerFrame = readPendingBrowserFrame(pendingFrameRef)
      if (
        isDisposedRef.current ||
        activeTabIdRef.current !== frame.tabId ||
        (newerFrame !== null && newerFrame.sequence > frame.sequence)
      ) {
        recordBrowserFrameDrop(frame.tabId)
        syncScreencastStats(frame.tabId)
        return
      }

      const canvas = canvasRef.current
      if (canvas === null) return
      const context = canvas.getContext('2d')
      if (context === null) return

      const width = Math.max(1, decodedFrame.width)
      const height = Math.max(1, decodedFrame.height)
      const fingerprintCanvas = getBrowserFrameFingerprintCanvas(
        fingerprintCanvasRef,
      )
      const nextFingerprint = createBrowserFrameFingerprint({
        canvas: fingerprintCanvas,
        source: decodedFrame.source,
        sourceHeight: height,
        sourceWidth: width,
      })
      const shouldSkipSimilarFrame =
        Date.now() >= recentInputUntilRef.current &&
        lastPaintedTabIdRef.current === frame.tabId &&
        lastPaintedFingerprintRef.current !== null &&
        nextFingerprint !== null &&
        shouldSkipVisuallyRedundantFrame({
          height,
          nextFingerprint,
          previousFingerprint: lastPaintedFingerprintRef.current,
          previousSize: lastPaintedSizeRef.current,
          width,
        })

      if (shouldSkipSimilarFrame) {
        lastPaintedSequenceRef.current = frame.sequence
        lastPaintedDataUrlRef.current = frame.dataUrl
        recordBrowserFrameSkip(frame.tabId)
        syncScreencastStats(frame.tabId)
        return
      }

      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      context.drawImage(decodedFrame.source, 0, 0, width, height)

      lastPaintedDataUrlRef.current = frame.dataUrl
      lastPaintedFingerprintRef.current = nextFingerprint
      lastPaintedSizeRef.current = { height, width }
      lastPaintedSequenceRef.current = frame.sequence
      lastPaintedTabIdRef.current = frame.tabId
      recordBrowserFramePaint(frame.tabId)
      setVisibleFrameTabId((current) =>
        current === frame.tabId ? current : frame.tabId,
      )
      onNaturalAspectRatio(
        readBrowserFrameAspectRatio(frame.aspectRatio ?? width / height),
      )
      syncScreencastStats(frame.tabId)
    } catch {
      recordBrowserFrameDrop(frame.tabId)
      syncScreencastStats(frame.tabId)
    } finally {
      decodedFrame?.close()
      isRenderingFrameRef.current = false
      if (!isDisposedRef.current && pendingFrameRef.current !== null) {
        requestRenderFrame()
      }
    }
  }, [onNaturalAspectRatio, requestRenderFrame, syncScreencastStats])

  useEffect(() => {
    renderLatestFrameRef.current = renderLatestFrame
  }, [renderLatestFrame])

  const scheduleFrame = useCallback(
    (frame: BrowserFrame): void => {
      const pendingFrame = pendingFrameRef.current
      if (pendingFrame !== null && pendingFrame.sequence !== frame.sequence) {
        recordBrowserFrameDrop(pendingFrame.tabId)
        syncScreencastStats(pendingFrame.tabId)
      }
      pendingFrameRef.current = frame
      requestRenderFrame()
    },
    [requestRenderFrame, syncScreencastStats],
  )

  const clearRenderedFrame = useCallback(() => {
    pendingFrameRef.current = null
    lastPaintedDataUrlRef.current = null
    lastPaintedFingerprintRef.current = null
    lastPaintedSizeRef.current = null
    const canvas = canvasRef.current
    if (canvas !== null) {
      const context = canvas.getContext('2d')
      context?.clearRect(0, 0, canvas.width, canvas.height)
    }
    lastPaintedSequenceRef.current = 0
    lastPaintedTabIdRef.current = null
    setVisibleFrameTabId(null)
    onNaturalAspectRatio(null)
  }, [onNaturalAspectRatio])

  useEffect(() => {
    if (activeTabId === null) {
      const timeoutId = window.setTimeout(clearRenderedFrame, 0)
      return () => window.clearTimeout(timeoutId)
    }

    const lastFrame = getLastBrowserFrame(activeTabId)
    if (lastFrame !== null) scheduleFrame(lastFrame)

    return subscribeBrowserFrames(activeTabId, scheduleFrame)
  }, [activeTabId, clearRenderedFrame, scheduleFrame])

  useEffect(() => {
    if (activeTabId === null || shouldClearCanvasForState(screencast.state)) {
      const timeoutId = window.setTimeout(clearRenderedFrame, 0)
      return () => window.clearTimeout(timeoutId)
    }
  }, [activeTabId, clearRenderedFrame, screencast.state])

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
      markRecentInput()
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
    [activeTabId, canSendInput, markRecentInput],
  )

  useEffect(() => {
    const screen = screenRef.current
    if (screen === null) return

    const handleWheel = (event: WheelEvent): void => {
      if (!canSendInput || activeTabId === null) return
      markRecentInput()
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
  }, [activeTabId, canSendInput, flushScroll, markRecentInput])

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
      markRecentInput()
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
  }, [activeTabId, canSendInput, isKeyboardActive, markRecentInput])

  useEffect(
    () => {
      isDisposedRef.current = false
      return () => {
        isDisposedRef.current = true
        if (renderFrameRef.current !== null) {
          window.cancelAnimationFrame(renderFrameRef.current)
          renderFrameRef.current = null
        }
        if (scrollFrameRef.current !== null) {
          window.cancelAnimationFrame(scrollFrameRef.current)
          scrollFrameRef.current = null
        }
      }
    },
    [],
  )

  const overlay = getOverlayMessage(screencast.state, hasVisibleFrame)

  return (
    <div
      ref={screenRef}
      aria-label="Browser viewport"
      data-stream-state={screencast.state}
      onClick={handleClick}
      style={{ cursor: BROWSER_POINTER_CURSOR }}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-browser-frame="true"
        className="absolute inset-0 block h-full w-full select-none object-fill"
      />
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

type DecodedBrowserFrame = {
  readonly close: () => void
  readonly height: number
  readonly source: CanvasImageSource
  readonly width: number
}

async function decodeBrowserFrame(dataUrl: string): Promise<DecodedBrowserFrame> {
  if (typeof window.createImageBitmap === 'function') {
    try {
      const response = await fetch(dataUrl)
      const blob = await response.blob()
      const bitmap = await window.createImageBitmap(blob)
      return {
        close: () => {
          bitmap.close()
        },
        height: bitmap.height,
        source: bitmap,
        width: bitmap.width,
      }
    } catch {
      // Fall through to HTMLImageElement decoding.
    }
  }

  const image = new Image()
  image.decoding = 'async'
  image.src = dataUrl
  await decodeHtmlImage(image)
  return {
    close: () => undefined,
    height: image.naturalHeight || image.height,
    source: image,
    width: image.naturalWidth || image.width,
  }
}

async function decodeHtmlImage(image: HTMLImageElement): Promise<void> {
  if (typeof image.decode === 'function') {
    try {
      await image.decode()
      return
    } catch {
      if (image.complete && image.naturalWidth > 0) return
    }
  }

  if (image.complete && image.naturalWidth > 0) return
  await new Promise<void>((resolve, reject) => {
    image.onload = () => {
      resolve()
    }
    image.onerror = () => {
      reject(new Error('Failed to decode browser frame.'))
    }
  })
}

function getBrowserFrameFingerprintCanvas(
  ref: MutableRefObject<HTMLCanvasElement | null>,
): HTMLCanvasElement {
  if (ref.current === null) {
    ref.current = document.createElement('canvas')
  }
  return ref.current
}

function shouldSkipVisuallyRedundantFrame(input: {
  readonly height: number
  readonly nextFingerprint: BrowserFrameFingerprint
  readonly previousFingerprint: BrowserFrameFingerprint
  readonly previousSize: { readonly height: number; readonly width: number } | null
  readonly width: number
}): boolean {
  if (
    areBrowserFrameFingerprintsSimilar(
      input.previousFingerprint,
      input.nextFingerprint,
    )
  ) {
    return true
  }

  if (
    isBrowserFrameBlurRegression(
      input.previousFingerprint,
      input.nextFingerprint,
    )
  ) {
    return true
  }

  const previousSize = input.previousSize
  if (previousSize === null) return false
  const isLowerResolution =
    input.width < previousSize.width * 0.98 ||
    input.height < previousSize.height * 0.98
  if (!isLowerResolution) return false

  const previousAspectRatio = previousSize.width / previousSize.height
  const nextAspectRatio = input.width / input.height
  if (Math.abs(previousAspectRatio - nextAspectRatio) > 0.015) return false

  const comparison = compareBrowserFrameFingerprints(
    input.previousFingerprint,
    input.nextFingerprint,
  )
  if (comparison === null) return false
  return (
    comparison.averageDelta <= 18 &&
    comparison.changedPixelRatio <= 0.48
  )
}

function shouldClearCanvasForState(state: string): boolean {
  return state === 'idle' || state === 'new_tab' || state === 'error'
}

function readPendingBrowserFrame(
  ref: MutableRefObject<BrowserFrame | null>,
): BrowserFrame | null {
  return ref.current
}

function getOverlayMessage(
  state: string,
  hasVisibleFrame: boolean,
): string | null {
  if (hasVisibleFrame && (state === 'streaming' || state === 'connecting')) {
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
