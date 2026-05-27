import {
  ExtensionCommandError,
  createExtensionClientId,
} from './extension-messaging.ts'
import {
  parseBrowserControlServerMessage,
  shouldReconnectBrowserControlSocket,
} from './browser-control-messages.ts'
import { executeBrowserControlCommand } from './browser-control-commands.ts'
import type { BrowserExtensionBridge } from './browser-extension-bridge.ts'
import type {
  BrowserControlAttachmentChunk,
  BrowserControlAttachmentMetadata,
  BrowserControlAttachmentReader,
  BrowserControlConnectionStatus,
  BrowserControlOutputAck,
  BrowserControlOutputMetadata,
  BrowserControlOutputWriter,
  BrowserControlServerMessage,
} from './browser-control-types.ts'

const HEARTBEAT_INTERVAL_MS = 15_000
const HEARTBEAT_TIMEOUT_MS = 45_000
const RECONNECT_DELAY_MS = 1_000

type Callbacks = {
  readonly onStatusChange: (status: BrowserControlConnectionStatus) => void
  readonly getWindowId: () => number | null
  readonly ensureWindow: () => Promise<number | null>
}

type Options = {
  readonly url: string
  readonly bridge: BrowserExtensionBridge
  readonly callbacks: Callbacks
}

type PendingRequest = {
  readonly abortController: AbortController
}

type PendingAttachmentRead = {
  readonly resolve: (chunk: BrowserControlAttachmentChunk) => void
  readonly reject: (error: Error) => void
}

type PendingOutputWrite = {
  readonly resolve: (ack: BrowserControlOutputAck) => void
  readonly reject: (error: Error) => void
}

export class BrowserControlManager {
  private readonly url: string
  private readonly bridge: BrowserExtensionBridge
  private readonly callbacks: Callbacks
  private readonly clientId: string
  private socket: WebSocket | null = null
  private status: BrowserControlConnectionStatus = 'idle'
  private shouldRun = false
  private isStopped = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private pendingHeartbeatRequestId: string | null = null
  private pendingHeartbeatStartedAt = 0
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private readonly pendingAttachmentReads = new Map<
    string,
    PendingAttachmentRead
  >()
  private readonly pendingOutputWrites = new Map<string, PendingOutputWrite>()

  constructor(options: Options) {
    this.url = options.url
    this.bridge = options.bridge
    this.callbacks = options.callbacks
    this.clientId = createExtensionClientId()
  }

  start(): void {
    if (this.shouldRun) return
    this.shouldRun = true
    this.isStopped = false
    this.openSocket()
  }

  stop(): void {
    this.shouldRun = false
    this.isStopped = true
    this.clearReconnectTimer()
    this.stopHeartbeat()
    this.abortAllPending('Browser-control manager stopped.')
    const socket = this.socket
    this.socket = null
    if (socket !== null) {
      try {
        socket.close(1000, 'Browser-control manager stopped.')
      } catch {
        // ignore
      }
    }
    this.setStatus('idle')
  }

  getStatus(): BrowserControlConnectionStatus {
    return this.status
  }

  private openSocket(): void {
    this.clearReconnectTimer()
    this.stopHeartbeat()
    this.setStatus('connecting')

    let socket: WebSocket
    try {
      socket = new WebSocket(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      this.setStatus('connected')
      try {
        socket.send(
          JSON.stringify({
            type: 'hello',
            protocolVersion: 1,
            clientId: this.clientId,
            capabilities: ['chrome.runtime'],
          }),
        )
      } catch {
        // close handler drives reconnect
        return
      }
      this.startHeartbeat(socket)
    })

    socket.addEventListener('message', (event) => {
      const parsed = parseBrowserControlServerMessage(event.data)
      if (parsed === null) {
        try {
          socket.close(1003, 'Invalid browser-control message')
        } catch {
          // ignore
        }
        return
      }
      this.handleServerMessage(socket, parsed)
    })

    socket.addEventListener('close', (event) => {
      if (this.socket === socket) {
        this.socket = null
      }
      this.stopHeartbeat()
      this.abortAllPending('Browser-control socket closed.')
      if (
        shouldReconnectBrowserControlSocket({
          closeCode: event.code,
          isCancelled: this.isStopped,
        })
      ) {
        this.setStatus('disconnected')
        this.scheduleReconnect()
      } else if (!this.isStopped) {
        this.setStatus('disconnected')
      }
    })

    socket.addEventListener('error', () => {
      if (this.status === 'connecting') {
        this.setStatus('error')
      }
    })
  }

  private handleServerMessage(
    socket: WebSocket,
    message: BrowserControlServerMessage,
  ): void {
    if (message.type === 'pong') {
      if (message.requestId === this.pendingHeartbeatRequestId) {
        this.pendingHeartbeatRequestId = null
        this.pendingHeartbeatStartedAt = 0
      }
      return
    }

    if (message.type === 'cancel') {
      const pending = this.pendingRequests.get(message.requestId)
      if (pending !== undefined) {
        pending.abortController.abort(message.reason ?? 'Cancelled by server.')
        this.pendingRequests.delete(message.requestId)
      }
      return
    }

    if (
      message.type === 'attachment.chunk' ||
      message.type === 'attachment.error'
    ) {
      this.settleAttachmentRead(message)
      return
    }

    if (message.type === 'output.ack' || message.type === 'output.error') {
      this.settleOutputWrite(message)
      return
    }

    if (message.type === 'request') {
      const abortController = new AbortController()
      this.pendingRequests.set(message.requestId, { abortController })
      void this.dispatchRequest(socket, message, abortController.signal).finally(
        () => {
          this.pendingRequests.delete(message.requestId)
        },
      )
    }
  }

  private settleAttachmentRead(
    message: Extract<
      BrowserControlServerMessage,
      { readonly type: 'attachment.chunk' | 'attachment.error' }
    >,
  ): void {
    const pending = this.pendingAttachmentReads.get(message.chunkRequestId)
    if (pending === undefined) return
    this.pendingAttachmentReads.delete(message.chunkRequestId)
    if (message.type === 'attachment.error') {
      pending.reject(
        new ExtensionCommandError(message.error.code, message.error.message),
      )
      return
    }
    pending.resolve({
      attachmentId: message.attachmentId,
      dataBase64: message.dataBase64,
      done: message.done,
      offset: message.offset,
    })
  }

  private settleOutputWrite(
    message: Extract<
      BrowserControlServerMessage,
      { readonly type: 'output.ack' | 'output.error' }
    >,
  ): void {
    const pending = this.pendingOutputWrites.get(message.writeRequestId)
    if (pending === undefined) return
    this.pendingOutputWrites.delete(message.writeRequestId)
    if (message.type === 'output.error') {
      pending.reject(
        new ExtensionCommandError(message.error.code, message.error.message),
      )
      return
    }
    pending.resolve({
      bytesWritten: message.bytesWritten,
      done: message.done,
      offset: message.offset,
      outputId: message.outputId,
    })
  }

  private createAttachmentReader(
    socket: WebSocket,
    requestId: string,
  ): BrowserControlAttachmentReader {
    return ({ attachmentId, length, offset, signal }) =>
      new Promise<BrowserControlAttachmentChunk>((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) {
          reject(
            new ExtensionCommandError(
              'BROWSER_ATTACHMENT_CANCELLED',
              'Browser-control socket is not open.',
            ),
          )
          return
        }
        const chunkRequestId = createExtensionClientId()
        const cleanup = (): void => {
          this.pendingAttachmentReads.delete(chunkRequestId)
        }
        const handleAbort = (): void => {
          cleanup()
          reject(
            new ExtensionCommandError(
              'BROWSER_ATTACHMENT_CANCELLED',
              'Browser-control attachment read was cancelled.',
            ),
          )
        }
        if (signal.aborted) {
          handleAbort()
          return
        }
        this.pendingAttachmentReads.set(chunkRequestId, {
          resolve: (chunk) => {
            signal.removeEventListener('abort', handleAbort)
            resolve(chunk)
          },
          reject: (error) => {
            signal.removeEventListener('abort', handleAbort)
            reject(error)
          },
        })
        signal.addEventListener('abort', handleAbort, { once: true })
        try {
          socket.send(
            JSON.stringify({
              type: 'attachment.read',
              requestId,
              chunkRequestId,
              attachmentId,
              offset,
              length,
            }),
          )
        } catch (error) {
          signal.removeEventListener('abort', handleAbort)
          cleanup()
          reject(
            error instanceof Error
              ? error
              : new Error('Failed to request browser-control attachment chunk.'),
          )
        }
      })
  }

  private createOutputWriter(
    socket: WebSocket,
    requestId: string,
  ): BrowserControlOutputWriter {
    return ({ dataBase64, done, offset, outputId, signal }) =>
      new Promise<BrowserControlOutputAck>((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) {
          reject(
            new ExtensionCommandError(
              'BROWSER_OUTPUT_CANCELLED',
              'Browser-control socket is not open.',
            ),
          )
          return
        }
        const writeRequestId = createExtensionClientId()
        const cleanup = (): void => {
          this.pendingOutputWrites.delete(writeRequestId)
        }
        const handleAbort = (): void => {
          cleanup()
          reject(
            new ExtensionCommandError(
              'BROWSER_OUTPUT_CANCELLED',
              'Browser-control output write was cancelled.',
            ),
          )
        }
        if (signal.aborted) {
          handleAbort()
          return
        }
        this.pendingOutputWrites.set(writeRequestId, {
          resolve: (ack) => {
            signal.removeEventListener('abort', handleAbort)
            resolve(ack)
          },
          reject: (error) => {
            signal.removeEventListener('abort', handleAbort)
            reject(error)
          },
        })
        signal.addEventListener('abort', handleAbort, { once: true })
        try {
          socket.send(
            JSON.stringify({
              type: 'output.write',
              requestId,
              writeRequestId,
              outputId,
              offset,
              dataBase64,
              done,
            }),
          )
        } catch (error) {
          signal.removeEventListener('abort', handleAbort)
          cleanup()
          reject(
            error instanceof Error
              ? error
              : new Error('Failed to write browser-control output chunk.'),
          )
        }
      })
  }

  private async dispatchRequest(
    socket: WebSocket,
    message: Extract<BrowserControlServerMessage, { readonly type: 'request' }>,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const windowId =
        this.callbacks.getWindowId() ?? (await this.callbacks.ensureWindow())
      if (windowId === null) {
        sendJson(socket, {
          type: 'response',
          requestId: message.requestId,
          ok: false,
          error: {
            code: 'BROWSER_WINDOW_UNAVAILABLE',
            message:
              'Chrome is connected, but the browser window could not be opened.',
          },
        })
        return
      }

      const attachments = message.attachments as
        | readonly BrowserControlAttachmentMetadata[]
        | undefined
      const outputs = message.outputs as
        | readonly BrowserControlOutputMetadata[]
        | undefined
      const readAttachment =
        attachments !== undefined && attachments.length > 0
          ? this.createAttachmentReader(socket, message.requestId)
          : undefined
      const writeOutput =
        outputs !== undefined && outputs.length > 0
          ? this.createOutputWriter(socket, message.requestId)
          : undefined
      const result = await executeBrowserControlCommand({
        command: message.command,
        params: message.params,
        signal,
        timeoutMs: message.timeoutMs,
        attachments,
        outputs,
        readAttachment,
        writeOutput,
        windowId,
        bridge: this.bridge,
      })

      sendJson(socket, {
        type: 'response',
        requestId: message.requestId,
        ok: true,
        result,
      })
    } catch (error) {
      const code =
        error instanceof ExtensionCommandError
          ? error.code
          : 'BROWSER_EXECUTOR_ERROR'
      const errorMessage =
        error instanceof Error ? error.message : 'Browser executor failed.'
      sendJson(socket, {
        type: 'response',
        requestId: message.requestId,
        ok: false,
        error: { code, message: errorMessage },
      })
    }
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat()
    this.sendHeartbeat(socket)
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat(socket)
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this.pendingHeartbeatRequestId = null
    this.pendingHeartbeatStartedAt = 0
  }

  private sendHeartbeat(socket: WebSocket): void {
    if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return
    if (
      this.pendingHeartbeatRequestId !== null &&
      Date.now() - this.pendingHeartbeatStartedAt >= HEARTBEAT_TIMEOUT_MS
    ) {
      try {
        socket.close(4000, 'Browser-control heartbeat timed out.')
      } catch {
        // ignore
      }
      return
    }
    if (this.pendingHeartbeatRequestId !== null) return
    const requestId = createExtensionClientId()
    this.pendingHeartbeatRequestId = requestId
    this.pendingHeartbeatStartedAt = Date.now()
    try {
      socket.send(JSON.stringify({ type: 'ping', requestId }))
    } catch {
      this.pendingHeartbeatRequestId = null
      this.pendingHeartbeatStartedAt = 0
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun) return
    if (this.reconnectTimer !== null) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.shouldRun) return
      this.openSocket()
    }, RECONNECT_DELAY_MS)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private abortAllPending(reason: string): void {
    for (const pending of this.pendingRequests.values()) {
      pending.abortController.abort(reason)
    }
    this.pendingRequests.clear()
    for (const pending of this.pendingAttachmentReads.values()) {
      pending.reject(
        new ExtensionCommandError('BROWSER_ATTACHMENT_CANCELLED', reason),
      )
    }
    this.pendingAttachmentReads.clear()
    for (const pending of this.pendingOutputWrites.values()) {
      pending.reject(
        new ExtensionCommandError('BROWSER_OUTPUT_CANCELLED', reason),
      )
    }
    this.pendingOutputWrites.clear()
  }

  private setStatus(status: BrowserControlConnectionStatus): void {
    if (this.status === status) return
    this.status = status
    this.callbacks.onStatusChange(status)
  }
}

function sendJson(socket: WebSocket, message: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return
  try {
    socket.send(JSON.stringify(message))
  } catch {
    // ignore — close handler will trigger cleanup
  }
}
