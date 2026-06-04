import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelDeltaFlush,
  scheduleDeltaFlush,
} from '../src/lib/agent/agent-run-controller.ts'

type AnimationFrameControls = {
  readonly cancelAnimationFrame: ReturnType<typeof vi.fn>
  readonly runAnimationFrames: () => void
}

describe('agent run controller delta flushing', () => {
  let controls: AnimationFrameControls

  beforeEach(() => {
    vi.useFakeTimers()
    controls = installAnimationFrameControls()
  })

  afterEach(() => {
    cancelDeltaFlush()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('flushes pending deltas via timeout when animation frames do not run', () => {
    const callback = vi.fn()

    scheduleDeltaFlush(callback)
    vi.advanceTimersByTime(99)

    expect(callback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)

    expect(callback).toHaveBeenCalledTimes(1)

    controls.runAnimationFrames()

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('flushes only once when the animation frame runs before the timeout', () => {
    const callback = vi.fn()

    scheduleDeltaFlush(callback)
    controls.runAnimationFrames()
    vi.advanceTimersByTime(100)

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('cancels both pending animation frame and timeout flushes', () => {
    const callback = vi.fn()

    scheduleDeltaFlush(callback)
    cancelDeltaFlush()
    controls.runAnimationFrames()
    vi.advanceTimersByTime(100)

    expect(callback).not.toHaveBeenCalled()
    expect(controls.cancelAnimationFrame).toHaveBeenCalledTimes(1)
  })
})

function installAnimationFrameControls(): AnimationFrameControls {
  let nextFrameId = 1
  const frameCallbacks = new Map<number, FrameRequestCallback>()
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback): number => {
    const frameId = nextFrameId
    nextFrameId += 1
    frameCallbacks.set(frameId, callback)
    return frameId
  })
  const cancelAnimationFrame = vi.fn((frameId: number): void => {
    frameCallbacks.delete(frameId)
  })

  vi.stubGlobal('window', {
    requestAnimationFrame,
    cancelAnimationFrame,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  })

  return {
    cancelAnimationFrame,
    runAnimationFrames: () => {
      const pendingCallbacks = [...frameCallbacks.entries()]
      frameCallbacks.clear()

      for (const [, callback] of pendingCallbacks) {
        callback(0)
      }
    },
  }
}
