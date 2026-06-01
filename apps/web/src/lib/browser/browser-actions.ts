import type { BrowserExtensionBridge } from './browser-extension-bridge.ts'
import type {
  BrowserViewportClickInput,
  BrowserViewportInputPoint,
  BrowserViewportKeyboardInput,
  BrowserViewportWheelInput,
} from './browser-input-types.ts'
import {
  createBrowserKeyboardEventParams,
  readBrowserViewportSize,
} from './browser-viewport.ts'
import {
  parseBrowserWindowTab,
  parseBrowserWindowTabs,
  parseChromeWindow,
} from './parsers.ts'
import type { BrowserWindowTab } from './types.ts'

export async function clickBrowserViewport(input: {
  readonly bridge: BrowserExtensionBridge
  readonly click: BrowserViewportClickInput
  readonly signal: AbortSignal
}): Promise<void> {
  const point = await resolveViewportPoint({
    bridge: input.bridge,
    tabId: input.click.tabId,
    ratio: input.click.ratio,
    fallbackPoint: input.click.fallbackPoint,
    signal: input.signal,
  })
  const baseParams = {
    x: Math.round(point.x),
    y: Math.round(point.y),
    button: 'left',
    clickCount: 1,
  }
  await input.bridge.sendCdpCommand({
    tabId: input.click.tabId,
    method: 'Input.dispatchMouseEvent',
    params: { ...baseParams, type: 'mousePressed' },
    signal: input.signal,
  })
  await input.bridge.sendCdpCommand({
    tabId: input.click.tabId,
    method: 'Input.dispatchMouseEvent',
    params: { ...baseParams, type: 'mouseReleased' },
    signal: input.signal,
  })
}

export async function wheelBrowserViewport(input: {
  readonly bridge: BrowserExtensionBridge
  readonly wheel: BrowserViewportWheelInput
  readonly signal: AbortSignal
}): Promise<void> {
  const point = await resolveViewportPoint({
    bridge: input.bridge,
    tabId: input.wheel.tabId,
    ratio: input.wheel.ratio,
    fallbackPoint: input.wheel.fallbackPoint,
    signal: input.signal,
  })
  await input.bridge.sendCdpCommand({
    tabId: input.wheel.tabId,
    method: 'Input.dispatchMouseEvent',
    params: {
      type: 'mouseWheel',
      x: Math.round(point.x),
      y: Math.round(point.y),
      deltaX: Math.round(input.wheel.deltaX),
      deltaY: Math.round(input.wheel.deltaY),
    },
    signal: input.signal,
  })
}

export async function typeBrowserViewport(input: {
  readonly bridge: BrowserExtensionBridge
  readonly key: BrowserViewportKeyboardInput
  readonly signal: AbortSignal
}): Promise<void> {
  await input.bridge.sendCdpCommand({
    tabId: input.key.tabId,
    method: 'Input.dispatchKeyEvent',
    params: createBrowserKeyboardEventParams(input.key),
    signal: input.signal,
  })
}

async function resolveViewportPoint(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly ratio: BrowserViewportInputPoint
  readonly fallbackPoint: BrowserViewportInputPoint
  readonly signal: AbortSignal
}): Promise<BrowserViewportInputPoint> {
  try {
    const metrics = await input.bridge.sendCdpCommand({
      tabId: input.tabId,
      method: 'Page.getLayoutMetrics',
      signal: input.signal,
    })
    const size = readBrowserViewportSize(metrics)
    if (size !== null) {
      return { x: input.ratio.x * size.width, y: input.ratio.y * size.height }
    }
  } catch {
    // fall back to frame coordinates
  }
  return input.fallbackPoint
}

export async function goBackInBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly signal: AbortSignal
}): Promise<void> {
  await navigateHistory({ ...input, direction: 'back' })
}

export async function goForwardInBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly signal: AbortSignal
}): Promise<void> {
  await navigateHistory({ ...input, direction: 'forward' })
}

async function navigateHistory(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly signal: AbortSignal
  readonly direction: 'back' | 'forward'
}): Promise<void> {
  const history = await input.bridge.sendCdpCommand({
    tabId: input.tabId,
    method: 'Page.getNavigationHistory',
    signal: input.signal,
  })
  const parsed = parseNavigationHistory(history)
  if (parsed === null) return
  const nextIndex =
    input.direction === 'back'
      ? parsed.currentIndex - 1
      : parsed.currentIndex + 1
  const entry = parsed.entries[nextIndex]
  if (entry === undefined) return
  await input.bridge.sendCdpCommand({
    tabId: input.tabId,
    method: 'Page.navigateToHistoryEntry',
    params: { entryId: entry.id },
    signal: input.signal,
  })
}

export async function refreshBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly signal: AbortSignal
}): Promise<void> {
  await input.bridge.executeCommand(
    'chrome.call',
    { api: 'tabs.reload', args: [input.tabId] },
    input.signal,
  )
}

export async function navigateBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly url: string
  readonly signal: AbortSignal
}): Promise<void> {
  await input.bridge.executeCommand(
    'managedWindow.navigate',
    { tabId: input.tabId, url: input.url },
    input.signal,
  )
}

export async function createBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly windowId: number
  readonly signal: AbortSignal
}): Promise<BrowserWindowTab | null> {
  const result = await input.bridge.executeCommand(
    'chrome.call',
    {
      api: 'tabs.create',
      args: [{ windowId: input.windowId, active: true }],
    },
    input.signal,
  )
  return parseBrowserWindowTab(result)
}

export async function closeBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly signal: AbortSignal
}): Promise<BrowserWindowTab[] | null> {
  const result = await input.bridge.executeCommand(
    'managedWindow.closeTab',
    { tabId: input.tabId },
    input.signal,
  )
  return parseTabsFromCommandResult(result)
}

export async function activateBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly signal: AbortSignal
}): Promise<BrowserWindowTab[] | null> {
  const result = await input.bridge.executeCommand(
    'managedWindow.activateTab',
    { tabId: input.tabId },
    input.signal,
  )
  return parseTabsFromCommandResult(result)
}

export async function readBrowserNavigationState(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly signal: AbortSignal
}): Promise<{ canGoBack: boolean; canGoForward: boolean } | null> {
  try {
    const history = await input.bridge.sendCdpCommand({
      tabId: input.tabId,
      method: 'Page.getNavigationHistory',
      signal: input.signal,
    })
    const parsed = parseNavigationHistory(history)
    if (parsed === null) return null
    return {
      canGoBack: parsed.currentIndex > 0,
      canGoForward: parsed.currentIndex < parsed.entries.length - 1,
    }
  } catch {
    return null
  }
}

function parseNavigationHistory(
  value: unknown,
): { currentIndex: number; entries: { id: number }[] } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.currentIndex !== 'number') return null
  if (!Array.isArray(record.entries)) return null
  const entries: { id: number }[] = []
  for (const entry of record.entries) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { id?: unknown }).id === 'number'
    ) {
      entries.push({ id: (entry as { id: number }).id })
    }
  }
  return { currentIndex: record.currentIndex, entries }
}

function parseTabsFromCommandResult(value: unknown): BrowserWindowTab[] | null {
  if (Array.isArray(value)) return parseBrowserWindowTabs(value)
  if (typeof value !== 'object' || value === null) return null

  try {
    return parseChromeWindow(value).tabs
  } catch {
    // Some managed-window commands return nested records instead of a Chrome
    // window. Try the common nested tab collections before falling back to the
    // event stream.
  }

  const record = value as Record<string, unknown>
  if (Array.isArray(record.tabs)) return parseBrowserWindowTabs(record.tabs)
  const windowRecord = record.window
  if (typeof windowRecord === 'object' && windowRecord !== null) {
    const tabs = (windowRecord as Record<string, unknown>).tabs
    if (Array.isArray(tabs)) return parseBrowserWindowTabs(tabs)
  }
  return null
}
