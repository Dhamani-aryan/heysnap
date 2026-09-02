export type BrowserScreencastConnectionState =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'new_tab'
  | 'stopped'
  | 'error'

export type BrowserScreencastState = {
  readonly aspectRatio: number | null
  readonly lastFrameAt: number | null
  readonly stats: BrowserScreencastStats
  readonly state: BrowserScreencastConnectionState
  readonly tabId: number | null
}

export type BrowserScreencastStats = {
  readonly droppedFrames: number
  readonly lastFrameEstimatedBytes: number
  readonly lastPaintedAt: number | null
  readonly paintedFrames: number
  readonly receivedFrames: number
  readonly restartCount: number
  readonly skippedFrames: number
}

export type BrowserScreencastMessage =
  | { readonly type: 'started'; readonly tabId: number }
  | {
      readonly type: 'frame'
      readonly aspectRatio: number | null
      readonly dataUrl: string
      readonly tabId: number
    }
  | { readonly type: 'stopped' }
  | { readonly type: 'error'; readonly code: string; readonly message: string }

export type BrowserScreencastMode = 'new_tab' | 'streamable' | 'unsupported'
