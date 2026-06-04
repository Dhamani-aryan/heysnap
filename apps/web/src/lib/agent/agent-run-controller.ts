import type { AgentRunHandle } from './agent-client.ts'

let activeHandle: AgentRunHandle | null = null
let flushFrameId: number | null = null
let flushTimeoutId: number | null = null

const DELTA_FLUSH_FALLBACK_MS = 100

export function getActiveAgentRunHandle(): AgentRunHandle | null {
  return activeHandle
}

export function setActiveAgentRunHandle(handle: AgentRunHandle | null): void {
  activeHandle = handle
}

export function closeActiveAgentRun(): void {
  activeHandle?.close()
  activeHandle = null
  cancelDeltaFlush()
}

export function scheduleDeltaFlush(callback: () => void): void {
  if (flushFrameId !== null || flushTimeoutId !== null) return

  const flushOnce = (): void => {
    if (flushFrameId === null && flushTimeoutId === null) {
      return
    }

    clearScheduledDeltaFlush()
    callback()
  }

  flushFrameId = window.requestAnimationFrame(flushOnce)
  flushTimeoutId = window.setTimeout(flushOnce, DELTA_FLUSH_FALLBACK_MS)
}

export function cancelDeltaFlush(): void {
  clearScheduledDeltaFlush()
}

function clearScheduledDeltaFlush(): void {
  if (flushFrameId !== null) {
    window.cancelAnimationFrame(flushFrameId)
    flushFrameId = null
  }

  if (flushTimeoutId !== null) {
    window.clearTimeout(flushTimeoutId)
    flushTimeoutId = null
  }
}
