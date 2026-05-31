import type { BrowserScreencastConnectionState } from './browser-screencast-types.ts'

export const BROWSER_SCREENCAST_WATCHDOG_MS = 2500
export const BROWSER_SCREENCAST_WATCHDOG_INTERVAL_MS = 500
export const BROWSER_SCREENCAST_RESTART_BASE_DELAY_MS = 250
export const BROWSER_SCREENCAST_RESTART_MAX_DELAY_MS = 1200

export function shouldRestartBrowserScreencast(input: {
  readonly lastSignalAt: number | null
  readonly now: number
  readonly state: BrowserScreencastConnectionState
}): boolean {
  if (input.lastSignalAt === null) return false
  if (input.state !== 'connecting' && input.state !== 'streaming') return false
  return input.now - input.lastSignalAt >= BROWSER_SCREENCAST_WATCHDOG_MS
}

export function getBrowserScreencastRestartDelay(attempt: number): number {
  return Math.min(
    BROWSER_SCREENCAST_RESTART_MAX_DELAY_MS,
    BROWSER_SCREENCAST_RESTART_BASE_DELAY_MS + Math.max(0, attempt) * 250,
  )
}
