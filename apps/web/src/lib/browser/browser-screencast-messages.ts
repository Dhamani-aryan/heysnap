import type { ChromeRuntimePort } from './extension-messaging.ts'
import type {
  BrowserScreencastMessage,
  BrowserScreencastMode,
} from './browser-screencast-types.ts'

export const BROWSER_SCREENCAST_PORT_NAME = 'heysnap-cdp-screencast'

export function parseBrowserScreencastMessage(
  value: unknown,
): BrowserScreencastMessage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>

  if (record.type === 'started' && typeof record.tabId === 'number') {
    return { type: 'started', tabId: record.tabId }
  }

  if (
    record.type === 'frame' &&
    typeof record.tabId === 'number' &&
    typeof record.dataUrl === 'string'
  ) {
    return {
      type: 'frame',
      aspectRatio: readScreencastAspectRatio(record.metadata),
      dataUrl: record.dataUrl,
      tabId: record.tabId,
    }
  }

  if (record.type === 'stopped') return { type: 'stopped' }

  if (record.type === 'error') {
    return {
      type: 'error',
      code: typeof record.code === 'string' ? record.code : 'CDP_SCREENCAST_ERROR',
      message:
        typeof record.message === 'string'
          ? record.message
          : 'Failed to stream browser tab.',
    }
  }

  return null
}

function readScreencastAspectRatio(metadata: unknown): number | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return null
  }
  const record = metadata as Record<string, unknown>
  const width =
    readPositiveNumber(record.deviceWidth) ?? readPositiveNumber(record.width)
  const height =
    readPositiveNumber(record.deviceHeight) ?? readPositiveNumber(record.height)
  if (width === undefined || height === undefined) return null
  return width / height
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

export function getBrowserScreencastMode(
  url: string | undefined,
): BrowserScreencastMode {
  if (isNewTabUrl(url)) return 'new_tab'
  return isStreamableUrl(url) ? 'streamable' : 'unsupported'
}

function isStreamableUrl(url: string | undefined): boolean {
  return (
    url !== undefined &&
    url.length > 0 &&
    url !== 'about:blank' &&
    !url.startsWith('about:') &&
    !url.startsWith('chrome://')
  )
}

function isNewTabUrl(url: string | undefined): boolean {
  if (url === undefined || url.length === 0) return true
  return (
    url === 'about:blank' || url === 'chrome://newtab' || url === 'chrome://newtab/'
  )
}

export function disconnectBrowserScreencastPort(port: ChromeRuntimePort): void {
  try {
    port.postMessage({ type: 'stop' })
  } catch {
    // ignore — port may already be disconnected
  }
  try {
    port.disconnect()
  } catch {
    // ignore
  }
}
