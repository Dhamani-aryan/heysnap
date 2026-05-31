import type {
  FilesystemClientMessage,
  FilesystemConnectionStatus,
  FilesystemEntry,
  FilesystemListing,
  FilesystemPasteMode,
  FilesystemPasteResult,
  FilesystemServerMessage,
} from './types.ts'

const HEARTBEAT_INTERVAL_MS = 15_000
const HEARTBEAT_TIMEOUT_MS = 45_000
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

type ManagerCallbacks = {
  readonly onMessage: (message: FilesystemServerMessage) => void
  readonly onStatusChange: (status: FilesystemConnectionStatus) => void
}

export type FilesystemConnectionManagerOptions = {
  readonly url: string
  readonly initialPath?: string
  readonly previewBaseUrl?: string
  readonly callbacks: ManagerCallbacks
}

type PendingRequest = {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

type RequestPayload = DistributiveOmit<FilesystemClientMessage, 'requestId'>

export class FilesystemConnectionManager {
  private url: string
  private previewBaseUrl: string | undefined
  private readonly callbacks: ManagerCallbacks
  private socket: WebSocket | null = null
  private status: FilesystemConnectionStatus = 'idle'
  private shouldReconnect = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null
  private pendingHeartbeatRequestId: string | null = null
  private requestCounter = 0
  private readonly pending = new Map<string, PendingRequest>()
  private subscribedPath: string
  private visibilityListener: (() => void) | null = null

  constructor(options: FilesystemConnectionManagerOptions) {
    this.url = options.url
    this.previewBaseUrl = options.previewBaseUrl
    this.callbacks = options.callbacks
    this.subscribedPath = options.initialPath ?? ''
  }

  connect(): void {
    if (this.shouldReconnect && this.socket) return
    this.shouldReconnect = true
    this.attachVisibilityListener()
    this.openSocket()
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.clearReconnectTimer()
    this.stopHeartbeat()
    this.detachVisibilityListener()
    const socket = this.socket
    this.socket = null
    if (socket) {
      try {
        socket.close()
      } catch {
        /* noop */
      }
    }
    this.rejectAllPending(new Error('Filesystem connection closed.'))
    this.setStatus('closed')
  }

  getStatus(): FilesystemConnectionStatus {
    return this.status
  }

  setUrls(input: { readonly url: string; readonly previewBaseUrl?: string }): void {
    this.url = input.url
    this.previewBaseUrl = input.previewBaseUrl
  }

  async subscribe(path: string): Promise<FilesystemListing> {
    this.subscribedPath = path
    const result = await this.request({ type: 'subscribe', path })
    return result as FilesystemListing
  }

  async refresh(): Promise<FilesystemListing> {
    const result = await this.request({ type: 'refresh' })
    return result as FilesystemListing
  }

  async createFolder(path?: string, name?: string): Promise<FilesystemEntry | null> {
    const result = await this.request({ type: 'createFolder', path, name })
    return isFilesystemEntry(result) ? result : null
  }

  async rename(path: string, newName: string): Promise<FilesystemEntry | null> {
    const result = await this.request({ type: 'rename', path, newName })
    return isFilesystemEntry(result) ? result : null
  }

  async trash(paths: readonly string[]): Promise<void> {
    await this.request({ type: 'trash', paths: [...paths] })
  }

  async paste(
    mode: FilesystemPasteMode,
    sourcePaths: readonly string[],
    path: string,
  ): Promise<FilesystemPasteResult | null> {
    const result = await this.request({
      type: 'paste',
      mode,
      sourcePaths: [...sourcePaths],
      path,
    })
    return isFilesystemPasteResult(result) ? result : null
  }

  async setOpenFiles(paths: readonly string[]): Promise<void> {
    await this.request({ type: 'setOpenFiles', paths: [...paths] })
  }

  getDownloadUrl(paths: readonly string[]): string {
    const url = this.toHttpUrl()
    url.pathname = url.pathname.replace(/\/filesystem\/?$/u, '/filesystem/download')
    url.searchParams.delete('path')
    url.searchParams.delete('showHidden')
    url.searchParams.delete('v')
    for (const path of paths) {
      url.searchParams.append('path', path)
    }
    return url.toString()
  }

  getUploadUrl(): string {
    const url = this.toHttpUrl()
    url.pathname = url.pathname.replace(/\/filesystem\/?$/u, '/filesystem/uploads')
    url.searchParams.delete('path')
    url.searchParams.delete('showHidden')
    url.searchParams.delete('v')
    return url.toString()
  }

  getPreviewUrl(path: string): string | null {
    const url = this.resolvePreviewBaseUrl()
    if (url === null) return null
    url.searchParams.delete('path')
    url.searchParams.delete('root')
    url.searchParams.delete('chrome')
    url.searchParams.delete('theme')
    url.searchParams.delete('v')
    url.searchParams.set('path', path)
    url.searchParams.set('chrome', '0')
    return url.toString()
  }

  private resolvePreviewBaseUrl(): URL | null {
    const explicit = this.previewBaseUrl?.trim()
    if (explicit) {
      try {
        return new URL(explicit, getDocumentBaseHref())
      } catch {
        return null
      }
    }
    if (this.isGatewayFilesystemUrl()) return null
    const url = this.toHttpUrl()
    const next = url.pathname.replace(/\/filesystem\/?$/u, '/preview')
    url.pathname = next === url.pathname ? '/preview' : next
    url.searchParams.delete('path')
    url.searchParams.delete('showHidden')
    return url
  }

  private isGatewayFilesystemUrl(): boolean {
    try {
      const url = new URL(this.url, getDocumentBaseHref())
      return /^\/gateway\/computers\/[^/]+\/filesystem\/?$/u.test(url.pathname)
    } catch {
      return false
    }
  }

  private toHttpUrl(): URL {
    const url = new URL(this.url)
    if (url.protocol === 'ws:') url.protocol = 'http:'
    else if (url.protocol === 'wss:') url.protocol = 'https:'
    return url
  }

  private openSocket(): void {
    this.clearReconnectTimer()
    this.stopHeartbeat()
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        /* noop */
      }
      this.socket = null
    }
    this.setStatus(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting')

    let socketUrl: URL
    try {
      socketUrl = new URL(this.url)
    } catch {
      this.shouldReconnect = false
      this.setStatus('closed')
      return
    }
    if (this.subscribedPath) {
      socketUrl.searchParams.set('path', this.subscribedPath)
    }

    let socket: WebSocket
    try {
      socket = new WebSocket(socketUrl.toString())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.addEventListener('open', () => {
      this.reconnectAttempt = 0
      this.setStatus('open')
      this.startHeartbeat()
    })

    socket.addEventListener('message', (event) => {
      let parsed: FilesystemServerMessage
      try {
        parsed = JSON.parse(String(event.data)) as FilesystemServerMessage
      } catch {
        return
      }
      this.handleServerMessage(parsed)
    })

    socket.addEventListener('error', () => {
      /* close handler drives reconnect */
    })

    socket.addEventListener('close', () => {
      this.stopHeartbeat()
      this.rejectAllPending(new Error('Filesystem connection closed.'))
      if (this.socket === socket) {
        this.socket = null
      }
      if (this.shouldReconnect) {
        this.scheduleReconnect()
      } else {
        this.setStatus('closed')
      }
    })
  }

  private handleServerMessage(message: FilesystemServerMessage): void {
    this.callbacks.onMessage(message)

    switch (message.type) {
      case 'snapshot':
        if (message.requestId !== undefined) {
          this.resolvePending(message.requestId, message.listing)
        }
        return
      case 'ack':
        this.resolvePending(message.requestId, message.result)
        return
      case 'error':
        if (message.requestId !== undefined) {
          this.rejectPending(message.requestId, message.message)
        }
        return
      case 'pong':
        if (message.requestId === this.pendingHeartbeatRequestId) {
          this.pendingHeartbeatRequestId = null
          if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout)
            this.heartbeatTimeout = null
          }
        }
        this.resolvePending(message.requestId, message)
        return
      case 'hello':
        return
    }
  }

  private request(payload: RequestPayload): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = this.socket
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error('Filesystem connection is not open.'))
        return
      }
      const requestId = this.nextRequestId()
      const message = { ...payload, requestId } as FilesystemClientMessage
      this.pending.set(requestId, { resolve, reject })
      try {
        socket.send(JSON.stringify(message))
      } catch (error) {
        this.pending.delete(requestId)
        reject(error as Error)
      }
    })
  }

  private resolvePending(requestId: string, value: unknown): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    pending.resolve(value)
  }

  private rejectPending(requestId: string, message: string): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    pending.reject(new Error(message))
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
    this.pendingHeartbeatRequestId = null
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat()
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout)
      this.heartbeatTimeout = null
    }
    this.pendingHeartbeatRequestId = null
  }

  private sendHeartbeat(): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    if (this.pendingHeartbeatRequestId) return
    const requestId = this.nextRequestId()
    this.pendingHeartbeatRequestId = requestId
    this.pending.set(requestId, {
      resolve: () => {},
      reject: () => {},
    })
    try {
      socket.send(JSON.stringify({ type: 'ping', requestId }))
    } catch {
      this.pending.delete(requestId)
      this.pendingHeartbeatRequestId = null
      return
    }
    this.heartbeatTimeout = setTimeout(() => {
      this.forceReconnect()
    }, HEARTBEAT_TIMEOUT_MS)
  }

  private forceReconnect(): void {
    const socket = this.socket
    this.socket = null
    if (socket) {
      try {
        socket.close()
      } catch {
        /* noop */
      }
    }
    this.stopHeartbeat()
    if (this.shouldReconnect) {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer()
    if (!this.shouldReconnect) return
    const attempt = this.reconnectAttempt
    this.reconnectAttempt = attempt + 1
    const exponential = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** attempt,
    )
    const jitter = Math.random() * 0.3 * exponential
    const delay = Math.floor(exponential * 0.7 + jitter)
    this.setStatus('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.openSocket()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private setStatus(next: FilesystemConnectionStatus): void {
    if (this.status === next) return
    this.status = next
    this.callbacks.onStatusChange(next)
  }

  private nextRequestId(): string {
    this.requestCounter += 1
    return `r${this.requestCounter}`
  }

  private attachVisibilityListener(): void {
    if (this.visibilityListener) return
    if (typeof document === 'undefined') return
    const listener = () => {
      if (
        document.visibilityState === 'visible' &&
        this.shouldReconnect &&
        !this.socket
      ) {
        this.reconnectAttempt = 0
        this.clearReconnectTimer()
        this.openSocket()
      }
    }
    this.visibilityListener = listener
    document.addEventListener('visibilitychange', listener)
  }

  private detachVisibilityListener(): void {
    if (!this.visibilityListener) return
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityListener)
    }
    this.visibilityListener = null
  }
}

function getDocumentBaseHref(): string {
  if (typeof window !== 'undefined' && typeof window.location?.href === 'string') {
    return window.location.href
  }
  return 'http://localhost'
}

function isFilesystemEntry(value: unknown): value is FilesystemEntry {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.path === 'string' &&
    (candidate.type === 'file' || candidate.type === 'directory')
  )
}

function isFilesystemPasteResult(value: unknown): value is FilesystemPasteResult {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    (candidate.mode === 'copy' || candidate.mode === 'move') &&
    Array.isArray(candidate.sourcePaths) &&
    candidate.sourcePaths.every((path) => typeof path === 'string') &&
    typeof candidate.destinationPath === 'string' &&
    Array.isArray(candidate.entries) &&
    candidate.entries.every(isFilesystemEntry)
  )
}
