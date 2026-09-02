import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearBrowserFramesForTab,
  estimateDataUrlByteLength,
  getBrowserFrameStats,
  getLastBrowserFrame,
  publishBrowserFrame,
  recordBrowserFrameDrop,
  recordBrowserFramePaint,
  recordBrowserFrameSkip,
  recordBrowserScreencastRestart,
  subscribeBrowserFrames,
} from '../src/lib/browser/browser-frame-bus.ts'
import {
  areBrowserFrameFingerprintsSimilar,
  isBrowserFrameBlurRegression,
  type BrowserFrameFingerprint,
} from '../src/lib/browser/browser-frame-fingerprint.ts'
import { parseBrowserScreencastMessage } from '../src/lib/browser/browser-screencast-messages.ts'
import { buildBrowserScreencastProfile } from '../src/lib/browser/browser-screencast-profile.ts'
import {
  getBrowserScreencastRestartDelay,
  shouldRestartBrowserScreencast,
} from '../src/lib/browser/browser-screencast-watchdog.ts'

const frameDataUrl = 'data:image/jpeg;base64,AAAA'

describe('browser screencast profile', () => {
  it('uses viewport size and dpr while respecting capture caps', () => {
    expect(
      buildBrowserScreencastProfile({
        devicePixelRatio: 2,
        height: 700,
        width: 900,
      }),
    ).toMatchObject({
      everyNthFrame: 1,
      format: 'jpeg',
      maxHeight: 1000,
      maxWidth: 1440,
      quality: 76,
    })
  })

  it('keeps tiny viewport captures above the minimum size', () => {
    const profile = buildBrowserScreencastProfile({
      devicePixelRatio: 1,
      height: 40,
      width: 50,
    })

    expect(profile.maxHeight).toBeGreaterThanOrEqual(200)
    expect(profile.maxWidth).toBeGreaterThanOrEqual(320)
  })

  it('quantizes near-identical viewport sizes to avoid restart thrash', () => {
    const first = buildBrowserScreencastProfile({
      devicePixelRatio: 1,
      height: 601,
      width: 801,
    })
    const second = buildBrowserScreencastProfile({
      devicePixelRatio: 1,
      height: 604,
      width: 805,
    })

    expect(second.maxHeight).toBe(first.maxHeight)
    expect(second.maxWidth).toBe(first.maxWidth)
  })
})

describe('browser frame bus', () => {
  beforeEach(() => {
    clearBrowserFramesForTab(1)
    clearBrowserFramesForTab(2)
  })

  it('keeps the latest frame and only notifies subscribers for the same tab', () => {
    const frames: number[] = []
    const unsubscribe = subscribeBrowserFrames(1, (frame) => {
      frames.push(frame.sequence)
    })

    publishBrowserFrame({
      aspectRatio: 16 / 9,
      dataUrl: frameDataUrl,
      receivedAt: 100,
      tabId: 2,
    })
    const first = publishBrowserFrame({
      aspectRatio: 16 / 9,
      dataUrl: frameDataUrl,
      receivedAt: 101,
      tabId: 1,
    })
    const second = publishBrowserFrame({
      aspectRatio: 4 / 3,
      dataUrl: 'data:image/jpeg;base64,AAAAAAAA',
      receivedAt: 102,
      tabId: 1,
    })

    expect(frames).toEqual([first.sequence, second.sequence])
    expect(getLastBrowserFrame(1)).toBe(second)
    expect(getLastBrowserFrame(2)?.tabId).toBe(2)

    unsubscribe()
    publishBrowserFrame({
      aspectRatio: 1,
      dataUrl: frameDataUrl,
      receivedAt: 103,
      tabId: 1,
    })
    expect(frames).toEqual([first.sequence, second.sequence])
  })

  it('tracks lightweight stats and clears stale frame data for a tab', () => {
    publishBrowserFrame({
      aspectRatio: 1,
      dataUrl: frameDataUrl,
      receivedAt: 100,
      tabId: 1,
    })
    recordBrowserFramePaint(1, 110)
    recordBrowserFrameDrop(1, 2)
    recordBrowserFrameSkip(1, 3)
    recordBrowserScreencastRestart(1)

    expect(getBrowserFrameStats(1)).toMatchObject({
      droppedFrames: 2,
      lastFrameAt: 100,
      lastFrameEstimatedBytes: 3,
      lastPaintedAt: 110,
      paintedFrames: 1,
      receivedFrames: 1,
      restartCount: 1,
      skippedFrames: 3,
    })

    clearBrowserFramesForTab(1)
    expect(getLastBrowserFrame(1)).toBeNull()
    expect(getBrowserFrameStats(1).receivedFrames).toBe(0)
  })

  it('estimates data URL payload size without keeping binary data in state', () => {
    expect(estimateDataUrlByteLength(frameDataUrl)).toBe(3)
  })
})

describe('browser frame fingerprints', () => {
  it('treats tiny codec noise as visually similar', () => {
    const first = fingerprint([100, 120, 140, 255, 40, 60, 80, 255])
    const second = fingerprint([101, 119, 141, 255, 41, 60, 79, 255])

    expect(areBrowserFrameFingerprintsSimilar(first, second)).toBe(true)
  })

  it('detects meaningful visual changes', () => {
    const first = fingerprint([100, 120, 140, 255, 40, 60, 80, 255])
    const second = fingerprint([180, 200, 220, 255, 40, 60, 80, 255])

    expect(areBrowserFrameFingerprintsSimilar(first, second)).toBe(false)
  })

  it('detects a softer version of the same frame as a blur regression', () => {
    const sharp = fingerprint([
      80, 80, 80, 255, 80, 80, 80, 255, 80, 80, 80, 255, 80, 80, 80, 255,
      80, 80, 80, 255, 145, 145, 145, 255, 145, 145, 145, 255, 145, 145,
      145, 255, 145, 145, 145, 255, 145, 145, 145, 255,
    ])
    const soft = fingerprint([
      80, 80, 80, 255, 80, 80, 80, 255, 90, 90, 90, 255, 105, 105, 105,
      255, 120, 120, 120, 255, 135, 135, 135, 255, 145, 145, 145, 255, 145,
      145, 145, 255, 145, 145, 145, 255, 145, 145, 145, 255,
    ])

    expect(isBrowserFrameBlurRegression(sharp, soft)).toBe(true)
    expect(isBrowserFrameBlurRegression(soft, sharp)).toBe(false)
  })
})

describe('browser screencast watchdog', () => {
  it('restarts connecting or streaming ports after frame silence', () => {
    expect(
      shouldRestartBrowserScreencast({
        lastSignalAt: 1000,
        now: 3500,
        state: 'streaming',
      }),
    ).toBe(true)
    expect(
      shouldRestartBrowserScreencast({
        lastSignalAt: 1000,
        now: 3499,
        state: 'connecting',
      }),
    ).toBe(false)
    expect(
      shouldRestartBrowserScreencast({
        lastSignalAt: 1000,
        now: 4000,
        state: 'idle',
      }),
    ).toBe(false)
  })

  it('caps restart backoff', () => {
    expect(getBrowserScreencastRestartDelay(0)).toBe(250)
    expect(getBrowserScreencastRestartDelay(10)).toBe(1200)
  })
})

describe('browser screencast parser', () => {
  it('keeps current dataUrl frame messages compatible', () => {
    expect(
      parseBrowserScreencastMessage({
        dataUrl: frameDataUrl,
        metadata: { deviceHeight: 900, deviceWidth: 1440 },
        tabId: 7,
        type: 'frame',
      }),
    ).toEqual({
      aspectRatio: 1.6,
      dataUrl: frameDataUrl,
      tabId: 7,
      type: 'frame',
    })
  })
})

function fingerprint(pixels: number[]): BrowserFrameFingerprint {
  const typedPixels = new Uint8ClampedArray(pixels)
  return {
    edgeScore: edgeScore(typedPixels, pixels.length / 4, 1),
    height: 1,
    pixels: typedPixels,
    sourceHeight: 100,
    sourceWidth: 200,
    width: pixels.length / 4,
  }
}

function edgeScore(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  let total = 0
  let count = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const index = (y * width + x) * 4
      total += (pixels[index] - pixels[index + 4]) ** 2
      count += 1
    }
  }
  return count === 0 ? 0 : Math.sqrt(total / count)
}
