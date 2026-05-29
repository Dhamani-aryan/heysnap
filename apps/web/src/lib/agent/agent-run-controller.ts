import type { AgentRunHandle } from './agent-client.ts'

let activeHandle: AgentRunHandle | null = null
let flushFrameId: number | null = null

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
  if (flushFrameId !== null) return
  flushFrameId = window.requestAnimationFrame(() => {
    flushFrameId = null
    callback()
  })
}

export function cancelDeltaFlush(): void {
  if (flushFrameId !== null) {
    window.cancelAnimationFrame(flushFrameId)
    flushFrameId = null
  }
}
