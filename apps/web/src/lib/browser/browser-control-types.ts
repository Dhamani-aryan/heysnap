export type BrowserControlConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

export type BrowserControlCommandName =
  | 'getTabs'
  | 'createNewTab'
  | 'closeTab'
  | 'tab.focus'
  | 'tab.back'
  | 'tab.forward'
  | 'tab.goTo'
  | 'tab.refresh'
  | 'tab.evaluate'
  | 'tab.screenshot'
  | 'tab.cdp'

export type BrowserControlAttachmentMetadata = {
  readonly id: string
  readonly name: string
  readonly mimeType: string
  readonly size: number
}

export type BrowserControlOutputMetadata = {
  readonly id: string
  readonly mimeType: string
  readonly maxBytes: number
}

export type BrowserControlServerMessage =
  | {
      readonly type: 'request'
      readonly requestId: string
      readonly command: BrowserControlCommandName
      readonly params?: unknown
      readonly timeoutMs?: number
      readonly attachments?: readonly BrowserControlAttachmentMetadata[]
      readonly outputs?: readonly BrowserControlOutputMetadata[]
    }
  | {
      readonly type: 'cancel'
      readonly requestId: string
      readonly reason?: string
    }
  | {
      readonly type: 'pong'
      readonly requestId: string
      readonly serverTime: string
    }
  | {
      readonly type: 'attachment.chunk'
      readonly requestId: string
      readonly chunkRequestId: string
      readonly attachmentId: string
      readonly offset: number
      readonly dataBase64: string
      readonly done: boolean
    }
  | {
      readonly type: 'attachment.error'
      readonly requestId: string
      readonly chunkRequestId: string
      readonly attachmentId: string
      readonly error: { readonly code: string; readonly message: string }
    }
  | {
      readonly type: 'output.ack'
      readonly requestId: string
      readonly writeRequestId: string
      readonly outputId: string
      readonly offset: number
      readonly bytesWritten: number
      readonly done: boolean
    }
  | {
      readonly type: 'output.error'
      readonly requestId: string
      readonly writeRequestId: string
      readonly outputId: string
      readonly error: { readonly code: string; readonly message: string }
    }

export type BrowserControlAttachmentChunk = {
  readonly attachmentId: string
  readonly dataBase64: string
  readonly done: boolean
  readonly offset: number
}

export type BrowserControlAttachmentReader = (input: {
  readonly attachmentId: string
  readonly length: number
  readonly offset: number
  readonly signal: AbortSignal
}) => Promise<BrowserControlAttachmentChunk>

export type BrowserControlOutputAck = {
  readonly bytesWritten: number
  readonly done: boolean
  readonly offset: number
  readonly outputId: string
}

export type BrowserControlOutputWriter = (input: {
  readonly dataBase64: string
  readonly done: boolean
  readonly offset: number
  readonly outputId: string
  readonly signal: AbortSignal
}) => Promise<BrowserControlOutputAck>

export type BrowserControlClientMessage =
  | {
      readonly type: 'hello'
      readonly protocolVersion: 1
      readonly clientId: string
      readonly capabilities: readonly string[]
    }
  | {
      readonly type: 'ping'
      readonly requestId: string
    }
  | {
      readonly type: 'response'
      readonly requestId: string
      readonly ok: true
      readonly result: unknown
    }
  | {
      readonly type: 'response'
      readonly requestId: string
      readonly ok: false
      readonly error: { readonly code: string; readonly message: string }
    }
