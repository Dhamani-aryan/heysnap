export type BrowserCaptureViewport = {
  readonly devicePixelRatio: number
  readonly height: number
  readonly width: number
}

export type BrowserScreencastProfile = {
  readonly everyNthFrame: number
  readonly format: 'jpeg'
  readonly maxHeight: number
  readonly maxWidth: number
  readonly quality: number
}

const DEFAULT_CAPTURE_WIDTH = 1280
const DEFAULT_CAPTURE_HEIGHT = 800
const MAX_CAPTURE_WIDTH = 1440
const MAX_CAPTURE_HEIGHT = 1000
const MIN_CAPTURE_WIDTH = 320
const MIN_CAPTURE_HEIGHT = 200
const CAPTURE_SIZE_STEP = 64

export function buildBrowserScreencastProfile(
  viewport: BrowserCaptureViewport | null,
): BrowserScreencastProfile {
  const targetWidth =
    viewport === null
      ? DEFAULT_CAPTURE_WIDTH
      : viewport.width * normalizeDevicePixelRatio(viewport.devicePixelRatio)
  const targetHeight =
    viewport === null
      ? DEFAULT_CAPTURE_HEIGHT
      : viewport.height * normalizeDevicePixelRatio(viewport.devicePixelRatio)

  return {
    everyNthFrame: 1,
    format: 'jpeg',
    maxHeight: quantizeCaptureSize(
      targetHeight,
      MIN_CAPTURE_HEIGHT,
      MAX_CAPTURE_HEIGHT,
    ),
    maxWidth: quantizeCaptureSize(
      targetWidth,
      MIN_CAPTURE_WIDTH,
      MAX_CAPTURE_WIDTH,
    ),
    quality: 76,
  }
}

export function areBrowserScreencastProfilesEqual(
  left: BrowserScreencastProfile,
  right: BrowserScreencastProfile,
): boolean {
  return (
    left.everyNthFrame === right.everyNthFrame &&
    left.format === right.format &&
    left.maxHeight === right.maxHeight &&
    left.maxWidth === right.maxWidth &&
    left.quality === right.quality
  )
}

function normalizeDevicePixelRatio(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.max(value, 1), 3) : 1
}

function quantizeCaptureSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return min
  const bounded = Math.min(Math.max(value, min), max)
  return Math.min(max, Math.ceil(bounded / CAPTURE_SIZE_STEP) * CAPTURE_SIZE_STEP)
}
