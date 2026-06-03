import type { AgentRunHandle } from './agent-client'

let activeHandle: AgentRunHandle | null = null
let flushFrameId: number | null = null
let flushTimerId: ReturnType<typeof setTimeout> | null = null

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
  if (flushFrameId !== null || flushTimerId !== null) return

  const requestFrame = globalThis.requestAnimationFrame
  if (typeof requestFrame !== 'function') {
    flushTimerId = setTimeout(() => {
      flushTimerId = null
      callback()
    }, 16)
    return
  }

  flushFrameId = requestFrame(() => {
    flushFrameId = null
    callback()
  })
}

export function cancelDeltaFlush(): void {
  if (flushFrameId !== null) {
    globalThis.cancelAnimationFrame?.(flushFrameId)
    flushFrameId = null
  }
  if (flushTimerId !== null) {
    clearTimeout(flushTimerId)
    flushTimerId = null
  }
}
