export type BrowserViewportInputPoint = {
  readonly x: number
  readonly y: number
}

export type BrowserViewportClickInput = {
  readonly fallbackPoint: BrowserViewportInputPoint
  readonly ratio: BrowserViewportInputPoint
  readonly tabId: number
}

export type BrowserViewportKeyboardInput = {
  readonly altKey: boolean
  readonly code: string
  readonly ctrlKey: boolean
  readonly key: string
  readonly keyCode: number
  readonly location: number
  readonly metaKey: boolean
  readonly repeat: boolean
  readonly shiftKey: boolean
  readonly tabId: number
  readonly text?: string
  readonly type: 'keyDown' | 'keyUp'
}

export type BrowserViewportWheelInput = {
  readonly deltaX: number
  readonly deltaY: number
  readonly fallbackPoint: BrowserViewportInputPoint
  readonly ratio: BrowserViewportInputPoint
  readonly tabId: number
}
