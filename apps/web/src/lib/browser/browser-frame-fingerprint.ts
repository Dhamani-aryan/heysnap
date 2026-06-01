export type BrowserFrameFingerprint = {
  readonly edgeScore: number
  readonly height: number
  readonly pixels: Uint8ClampedArray
  readonly sourceHeight: number
  readonly sourceWidth: number
  readonly width: number
}

export type BrowserFrameFingerprintComparison = {
  readonly averageDelta: number
  readonly changedPixelRatio: number
  readonly nextEdgeScore: number
  readonly previousEdgeScore: number
}

type BrowserFrameSimilarityOptions = {
  readonly changedPixelDelta?: number
  readonly maxAverageDelta?: number
  readonly maxChangedPixelRatio?: number
}

const FINGERPRINT_WIDTH = 80
const FINGERPRINT_MIN_HEIGHT = 32
const FINGERPRINT_MAX_HEIGHT = 72
const DEFAULT_CHANGED_PIXEL_DELTA = 10
const DEFAULT_MAX_AVERAGE_DELTA = 2.25
const DEFAULT_MAX_CHANGED_PIXEL_RATIO = 0.045
const BLUR_REGRESSION_MAX_AVERAGE_DELTA = 16
const BLUR_REGRESSION_MAX_CHANGED_PIXEL_RATIO = 0.42
const BLUR_REGRESSION_MAX_EDGE_RATIO = 0.88
const BLUR_REGRESSION_MIN_EDGE_DROP = 0.35

export function createBrowserFrameFingerprint(input: {
  readonly canvas: HTMLCanvasElement
  readonly source: CanvasImageSource
  readonly sourceHeight: number
  readonly sourceWidth: number
}): BrowserFrameFingerprint | null {
  if (input.sourceWidth <= 0 || input.sourceHeight <= 0) return null
  const height = Math.round(
    (FINGERPRINT_WIDTH * input.sourceHeight) / input.sourceWidth,
  )
  const fingerprintHeight = Math.min(
    FINGERPRINT_MAX_HEIGHT,
    Math.max(FINGERPRINT_MIN_HEIGHT, height),
  )

  input.canvas.width = FINGERPRINT_WIDTH
  input.canvas.height = fingerprintHeight
  const context = input.canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return null

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'low'
  context.clearRect(0, 0, FINGERPRINT_WIDTH, fingerprintHeight)
  context.drawImage(input.source, 0, 0, FINGERPRINT_WIDTH, fingerprintHeight)

  try {
    const imageData = context.getImageData(0, 0, FINGERPRINT_WIDTH, fingerprintHeight)
    const pixels = new Uint8ClampedArray(imageData.data)
    return {
      edgeScore: calculateFingerprintEdgeScore(
        pixels,
        FINGERPRINT_WIDTH,
        fingerprintHeight,
      ),
      height: fingerprintHeight,
      pixels,
      sourceHeight: input.sourceHeight,
      sourceWidth: input.sourceWidth,
      width: FINGERPRINT_WIDTH,
    }
  } catch {
    return null
  }
}

export function areBrowserFrameFingerprintsSimilar(
  left: BrowserFrameFingerprint,
  right: BrowserFrameFingerprint,
  options: BrowserFrameSimilarityOptions = {},
): boolean {
  const changedPixelDelta =
    options.changedPixelDelta ?? DEFAULT_CHANGED_PIXEL_DELTA
  const maxAverageDelta =
    options.maxAverageDelta ?? DEFAULT_MAX_AVERAGE_DELTA
  const maxChangedPixelRatio =
    options.maxChangedPixelRatio ?? DEFAULT_MAX_CHANGED_PIXEL_RATIO
  const comparison = compareBrowserFrameFingerprints(left, right, {
    changedPixelDelta,
  })
  if (comparison === null) return false

  return (
    comparison.averageDelta <= maxAverageDelta &&
    comparison.changedPixelRatio <= maxChangedPixelRatio
  )
}

export function isBrowserFrameBlurRegression(
  left: BrowserFrameFingerprint,
  right: BrowserFrameFingerprint,
): boolean {
  const comparison = compareBrowserFrameFingerprints(left, right)
  if (comparison === null) return false
  if (comparison.averageDelta > BLUR_REGRESSION_MAX_AVERAGE_DELTA) return false
  if (comparison.changedPixelRatio > BLUR_REGRESSION_MAX_CHANGED_PIXEL_RATIO) {
    return false
  }
  const edgeDrop = comparison.previousEdgeScore - comparison.nextEdgeScore
  if (edgeDrop < BLUR_REGRESSION_MIN_EDGE_DROP) return false
  return (
    comparison.nextEdgeScore / Math.max(1, comparison.previousEdgeScore) <=
    BLUR_REGRESSION_MAX_EDGE_RATIO
  )
}

export function compareBrowserFrameFingerprints(
  left: BrowserFrameFingerprint,
  right: BrowserFrameFingerprint,
  options: Pick<BrowserFrameSimilarityOptions, 'changedPixelDelta'> = {},
): BrowserFrameFingerprintComparison | null {
  if (
    left.height !== right.height ||
    left.width !== right.width ||
    left.pixels.length !== right.pixels.length
  ) {
    return null
  }

  const changedPixelDelta =
    options.changedPixelDelta ?? DEFAULT_CHANGED_PIXEL_DELTA

  let totalDelta = 0
  let changedPixels = 0
  const pixelCount = left.pixels.length / 4

  for (let index = 0; index < left.pixels.length; index += 4) {
    const delta =
      (Math.abs(left.pixels[index] - right.pixels[index]) +
        Math.abs(left.pixels[index + 1] - right.pixels[index + 1]) +
        Math.abs(left.pixels[index + 2] - right.pixels[index + 2])) /
      3
    totalDelta += delta
    if (delta >= changedPixelDelta) changedPixels += 1
  }

  return {
    averageDelta: totalDelta / pixelCount,
    changedPixelRatio: changedPixels / pixelCount,
    nextEdgeScore: right.edgeScore,
    previousEdgeScore: left.edgeScore,
  }
}

function calculateFingerprintEdgeScore(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  let total = 0
  let count = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const value = getLuma(pixels, index)
      if (x + 1 < width) {
        total += (value - getLuma(pixels, index + 4)) ** 2
        count += 1
      }
      if (y + 1 < height) {
        total += (value - getLuma(pixels, index + width * 4)) ** 2
        count += 1
      }
    }
  }

  return count === 0 ? 0 : Math.sqrt(total / count)
}

function getLuma(pixels: Uint8ClampedArray, index: number): number {
  return (
    pixels[index] * 0.2126 +
    pixels[index + 1] * 0.7152 +
    pixels[index + 2] * 0.0722
  )
}
