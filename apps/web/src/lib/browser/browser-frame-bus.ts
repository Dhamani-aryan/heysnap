export type BrowserFrame = {
  readonly aspectRatio: number | null
  readonly dataUrl: string
  readonly estimatedByteLength: number
  readonly receivedAt: number
  readonly sequence: number
  readonly tabId: number
}

export type BrowserFrameStats = {
  readonly droppedFrames: number
  readonly lastFrameAt: number | null
  readonly lastFrameEstimatedBytes: number
  readonly lastPaintedAt: number | null
  readonly paintedFrames: number
  readonly receivedFrames: number
  readonly restartCount: number
  readonly skippedFrames: number
}

type BrowserFrameListener = (frame: BrowserFrame) => void

const latestFramesByTab = new Map<number, BrowserFrame>()
const listenersByTab = new Map<number, Set<BrowserFrameListener>>()
const statsByTab = new Map<number, BrowserFrameStats>()

let frameSequence = 0

const emptyStats: BrowserFrameStats = {
  droppedFrames: 0,
  lastFrameAt: null,
  lastFrameEstimatedBytes: 0,
  lastPaintedAt: null,
  paintedFrames: 0,
  receivedFrames: 0,
  restartCount: 0,
  skippedFrames: 0,
}

export function publishBrowserFrame(input: {
  readonly aspectRatio: number | null
  readonly dataUrl: string
  readonly receivedAt?: number
  readonly tabId: number
}): BrowserFrame {
  const receivedAt = input.receivedAt ?? Date.now()
  const frame: BrowserFrame = {
    aspectRatio: input.aspectRatio,
    dataUrl: input.dataUrl,
    estimatedByteLength: estimateDataUrlByteLength(input.dataUrl),
    receivedAt,
    sequence: ++frameSequence,
    tabId: input.tabId,
  }

  const stats = getBrowserFrameStats(input.tabId)
  latestFramesByTab.set(input.tabId, frame)
  statsByTab.set(input.tabId, {
    ...stats,
    lastFrameAt: receivedAt,
    lastFrameEstimatedBytes: frame.estimatedByteLength,
    receivedFrames: stats.receivedFrames + 1,
  })

  const listeners = listenersByTab.get(input.tabId)
  if (listeners !== undefined) {
    for (const listener of listeners) listener(frame)
  }

  return frame
}

export function subscribeBrowserFrames(
  tabId: number,
  listener: BrowserFrameListener,
): () => void {
  let listeners = listenersByTab.get(tabId)
  if (listeners === undefined) {
    listeners = new Set<BrowserFrameListener>()
    listenersByTab.set(tabId, listeners)
  }
  listeners.add(listener)

  return () => {
    const currentListeners = listenersByTab.get(tabId)
    if (currentListeners === undefined) return
    currentListeners.delete(listener)
    if (currentListeners.size === 0) listenersByTab.delete(tabId)
  }
}

export function getLastBrowserFrame(tabId: number): BrowserFrame | null {
  return latestFramesByTab.get(tabId) ?? null
}

export function clearBrowserFramesForTab(tabId: number): void {
  latestFramesByTab.delete(tabId)
  listenersByTab.delete(tabId)
  statsByTab.delete(tabId)
}

export function getBrowserFrameStats(tabId: number): BrowserFrameStats {
  return statsByTab.get(tabId) ?? emptyStats
}

export function recordBrowserFramePaint(
  tabId: number,
  paintedAt = Date.now(),
): void {
  const stats = getBrowserFrameStats(tabId)
  statsByTab.set(tabId, {
    ...stats,
    lastPaintedAt: paintedAt,
    paintedFrames: stats.paintedFrames + 1,
  })
}

export function recordBrowserFrameDrop(tabId: number, count = 1): void {
  if (count <= 0) return
  const stats = getBrowserFrameStats(tabId)
  statsByTab.set(tabId, {
    ...stats,
    droppedFrames: stats.droppedFrames + count,
  })
}

export function recordBrowserFrameSkip(tabId: number, count = 1): void {
  if (count <= 0) return
  const stats = getBrowserFrameStats(tabId)
  statsByTab.set(tabId, {
    ...stats,
    skippedFrames: stats.skippedFrames + count,
  })
}

export function recordBrowserScreencastRestart(tabId: number): void {
  const stats = getBrowserFrameStats(tabId)
  statsByTab.set(tabId, {
    ...stats,
    restartCount: stats.restartCount + 1,
  })
}

export function estimateDataUrlByteLength(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  const payload = commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1)
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}
