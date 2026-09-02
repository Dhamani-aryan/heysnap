import type {
  BrowserTabEvent,
  BrowserWindowTab,
  ChromeWindowSnapshot,
} from './types.ts'

export const DEFAULT_BROWSER_WINDOW_URL = 'chrome://newtab'

function isBrowserWindowTab(value: unknown): value is BrowserWindowTab {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return typeof record.id === 'number' && typeof record.index === 'number'
}

export function parseBrowserWindowTab(
  value: unknown,
): BrowserWindowTab | null {
  return isBrowserWindowTab(value) ? value : null
}

export function parseBrowserWindowTabs(value: unknown): BrowserWindowTab[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isBrowserWindowTab)
    .slice()
    .sort((a, b) => a.index - b.index)
}

export function parseChromeWindow(value: unknown): ChromeWindowSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Chrome returned an invalid window.')
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'number') {
    throw new Error('Chrome returned a window without an id.')
  }
  return { id: record.id, tabs: parseBrowserWindowTabs(record.tabs) }
}

export function parseBrowserTabEventMessage(value: unknown): BrowserTabEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>

  if (record.type === 'windowRemoved' && typeof record.windowId === 'number') {
    return { type: 'windowRemoved', windowId: record.windowId }
  }

  if (record.type !== 'tabsChanged') return null

  const windowRecord =
    typeof record.window === 'object' &&
    record.window !== null &&
    !Array.isArray(record.window)
      ? (record.window as Record<string, unknown>)
      : null

  const windowId =
    typeof windowRecord?.windowId === 'number' ? windowRecord.windowId : null

  return {
    type: 'tabsChanged',
    tabs: parseBrowserWindowTabs(record.tabs),
    windowId,
  }
}

export function getActiveTabId(tabs: readonly BrowserWindowTab[]): number | null {
  return tabs.find((tab) => tab.active === true)?.id ?? null
}
