import type {
  BrowserViewportInputPoint,
  BrowserViewportKeyboardInput,
} from './browser-input-types.ts'

export function toBrowserViewportKeyboardInput(
  tabId: number,
  event: KeyboardEvent,
): BrowserViewportKeyboardInput | null {
  if (event.type !== 'keydown' && event.type !== 'keyup') return null
  return {
    altKey: event.altKey,
    code: event.code,
    ctrlKey: event.ctrlKey,
    key: event.key,
    keyCode: event.keyCode,
    location: event.location,
    metaKey: event.metaKey,
    repeat: event.repeat,
    shiftKey: event.shiftKey,
    tabId,
    text: getKeyboardText(event),
    type: event.type === 'keydown' ? 'keyDown' : 'keyUp',
  }
}

function getKeyboardText(event: KeyboardEvent): string | undefined {
  if (event.type !== 'keydown' || event.ctrlKey || event.metaKey || event.altKey) {
    return undefined
  }
  if (event.key.length === 1) return event.key
  return event.key === 'Enter' ? '\r' : undefined
}

export function getBrowserViewportInputPoint(
  viewport: HTMLDivElement,
  clientX: number,
  clientY: number,
): BrowserViewportInputPoint | null {
  const image = viewport.querySelector('img')
  const rect = getViewportInputRect(viewport)
  if (rect.width <= 0 || rect.height <= 0) return null
  const naturalWidth = image?.naturalWidth || rect.width
  const naturalHeight = image?.naturalHeight || rect.height
  return {
    x: clamp(((clientX - rect.left) / rect.width) * naturalWidth, 0, naturalWidth),
    y: clamp(((clientY - rect.top) / rect.height) * naturalHeight, 0, naturalHeight),
  }
}

export function getBrowserViewportInputRatio(
  viewport: HTMLDivElement,
  clientX: number,
  clientY: number,
): BrowserViewportInputPoint | null {
  const rect = getViewportInputRect(viewport)
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: clamp((clientX - rect.left) / rect.width, 0, 1),
    y: clamp((clientY - rect.top) / rect.height, 0, 1),
  }
}

function getViewportInputRect(viewport: HTMLDivElement): DOMRectReadOnly {
  const image = viewport.querySelector('img')
  if (image === null || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    return viewport.getBoundingClientRect()
  }
  const rect = image.getBoundingClientRect()
  const objectFit = window.getComputedStyle(image).objectFit
  if (
    objectFit !== 'contain' &&
    objectFit !== 'cover' &&
    objectFit !== 'scale-down'
  ) {
    return rect
  }
  const naturalAspectRatio = image.naturalWidth / image.naturalHeight
  const renderedAspectRatio = rect.width / rect.height
  const shouldFitWidth =
    objectFit === 'cover'
      ? renderedAspectRatio > naturalAspectRatio
      : renderedAspectRatio < naturalAspectRatio
  const width = shouldFitWidth ? rect.width : rect.height * naturalAspectRatio
  const height = shouldFitWidth ? rect.width / naturalAspectRatio : rect.height
  return new DOMRectReadOnly(
    rect.left + (rect.width - width) / 2,
    rect.top + (rect.height - height) / 2,
    width,
    height,
  )
}

export function readBrowserFrameAspectRatio(
  value: number | null | undefined,
): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0.1 &&
    value < 10
    ? value
    : null
}

export function createBrowserKeyboardEventParams(
  input: BrowserViewportKeyboardInput,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    type:
      input.type === 'keyUp'
        ? 'keyUp'
        : input.text === undefined
          ? 'rawKeyDown'
          : 'keyDown',
    modifiers: getKeyboardModifiers(input),
    windowsVirtualKeyCode: input.keyCode,
    nativeVirtualKeyCode: input.keyCode,
    key: input.key,
    code: input.code,
    autoRepeat: input.repeat,
    isKeypad: input.location === 3,
    location: input.location,
  }
  if (input.type === 'keyDown' && input.text !== undefined) {
    params.text = input.text
    params.unmodifiedText = input.text
    params.macCharCode = input.text.charCodeAt(0)
  }
  return params
}

function getKeyboardModifiers(
  input: Pick<
    BrowserViewportKeyboardInput,
    'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
  >,
): number {
  return (
    (input.altKey ? 1 : 0) |
    (input.ctrlKey ? 2 : 0) |
    (input.metaKey ? 4 : 0) |
    (input.shiftKey ? 8 : 0)
  )
}

export function readBrowserViewportSize(
  value: unknown,
): { readonly width: number; readonly height: number } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  const viewport =
    readRecord(record.cssVisualViewport) ??
    readRecord(record.cssLayoutViewport) ??
    readRecord(record.visualViewport) ??
    readRecord(record.layoutViewport)
  if (viewport === null) return null
  const width = readPositiveNumber(viewport.clientWidth)
  const height = readPositiveNumber(viewport.clientHeight)
  if (width === undefined || height === undefined) return null
  return { width, height }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
