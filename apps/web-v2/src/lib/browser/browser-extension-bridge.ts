import {
  ExtensionCommandError,
  connectExtensionPort,
  sendExtensionCommand,
  type ChromeRuntimePort,
} from './extension-messaging.ts'
import {
  DEFAULT_BROWSER_WINDOW_URL,
  parseBrowserTabEventMessage,
  parseChromeWindow,
} from './parsers.ts'
import type {
  BrowserExtensionStatus,
  BrowserTabEvent,
  ChromeWindowSnapshot,
} from './types.ts'

const EXTENSION_RETRY_DELAY_MS = 2500
const TAB_EVENTS_PORT_NAME = 'heysnap-tab-events'
const CHROME_DEBUGGER_PROTOCOL_VERSION = '1.3'

type Callbacks = {
  onStatusChange: (status: BrowserExtensionStatus) => void
  onTabEvent?: (event: BrowserTabEvent) => void
  onError?: (error: ExtensionCommandError) => void
}

type Options = {
  extensionId: string
  callbacks: Callbacks
}

export type RememberManagedWindowArgs = {
  windowId: number
  tabId: number
  url: string
}

export class BrowserExtensionBridge {
  private readonly extensionId: string
  private readonly callbacks: Callbacks
  private status: BrowserExtensionStatus = 'idle'
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private detectionController: AbortController | null = null
  private tabEventsPort: ChromeRuntimePort | null = null
  private started = false
  private readonly attachedDebuggerTabIds = new Set<number>()

  constructor(options: Options) {
    this.extensionId = options.extensionId
    this.callbacks = options.callbacks
  }

  start(): void {
    if (this.started) return
    this.started = true
    void this.detectExtension()
  }

  stop(): void {
    this.started = false
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.detectionController !== null) {
      this.detectionController.abort()
      this.detectionController = null
    }
    this.closeTabEventsPort()
    this.attachedDebuggerTabIds.clear()
    this.setStatus('idle')
  }

  getStatus(): BrowserExtensionStatus {
    return this.status
  }

  getExtensionId(): string {
    return this.extensionId
  }

  async createBrowserWindow(signal?: AbortSignal): Promise<ChromeWindowSnapshot> {
    const result = await this.runCommand(
      'chrome.call',
      {
        api: 'windows.create',
        args: [
          {
            url: DEFAULT_BROWSER_WINDOW_URL,
            focused: false,
            type: 'normal',
            width: 1440,
            height: 900,
          },
        ],
      },
      signal,
    )
    return parseChromeWindow(result)
  }

  async getBrowserWindow(
    windowId: number,
    options: { populate?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<ChromeWindowSnapshot> {
    const args: unknown[] =
      options.populate === undefined ? [windowId] : [windowId, options]
    const result = await this.runCommand(
      'chrome.call',
      { api: 'windows.get', args },
      signal,
    )
    return parseChromeWindow(result)
  }

  async rememberManagedWindow(
    args: RememberManagedWindowArgs,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.runCommand('managedWindow.remember', args, signal)
  }

  executeCommand(
    command: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    return sendExtensionCommand(this.extensionId, command, payload, signal)
  }

  async sendCdpCommand(input: {
    readonly tabId: number
    readonly method: string
    readonly params?: Record<string, unknown>
    readonly signal: AbortSignal
  }): Promise<unknown> {
    await this.attachDebugger(input.tabId, input.signal)
    try {
      return await this.executeCommand(
        'debugger.sendCommand',
        stripUndefined({
          tabId: input.tabId,
          method: input.method,
          params: input.params,
        }),
        input.signal,
      )
    } catch (error) {
      this.attachedDebuggerTabIds.delete(input.tabId)
      if (!isDebuggerNotAttachedError(error)) {
        throw error
      }
      await this.attachDebugger(input.tabId, input.signal)
      return this.executeCommand(
        'debugger.sendCommand',
        stripUndefined({
          tabId: input.tabId,
          method: input.method,
          params: input.params,
        }),
        input.signal,
      )
    }
  }

  releaseAttachedDebuggerTab(tabId: number): void {
    this.attachedDebuggerTabIds.delete(tabId)
  }

  private async attachDebugger(
    tabId: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.attachedDebuggerTabIds.has(tabId)) return
    try {
      await this.executeCommand(
        'debugger.attach',
        { tabId, version: CHROME_DEBUGGER_PROTOCOL_VERSION },
        signal,
      )
    } catch (error) {
      if (!isDebuggerAlreadyAttachedError(error)) throw error
    }
    this.attachedDebuggerTabIds.add(tabId)
  }

  private async runCommand(
    command: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const owned = signal === undefined ? new AbortController() : null
    const effective = signal ?? owned!.signal
    try {
      return await sendExtensionCommand(
        this.extensionId,
        command,
        payload,
        effective,
      )
    } finally {
      if (owned !== null) owned.abort()
    }
  }

  private async detectExtension(): Promise<void> {
    if (!this.started) return
    this.setStatus('checking')

    const controller = new AbortController()
    this.detectionController = controller

    try {
      await sendExtensionCommand(
        this.extensionId,
        'ping',
        undefined,
        controller.signal,
      )
    } catch (error) {
      if (!this.started || controller.signal.aborted) return
      if (error instanceof ExtensionCommandError) {
        this.callbacks.onError?.(error)
      }
      this.setStatus('unavailable')
      this.scheduleRetry()
      return
    } finally {
      if (this.detectionController === controller) {
        this.detectionController = null
      }
    }

    if (!this.started) return
    this.setStatus('available')
  }

  private scheduleRetry(): void {
    if (!this.started || this.retryTimer !== null) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.detectExtension()
    }, EXTENSION_RETRY_DELAY_MS)
  }

  private setStatus(status: BrowserExtensionStatus): void {
    if (this.status === status) return
    this.status = status
    this.callbacks.onStatusChange(status)
    if (status === 'available') {
      this.openTabEventsPort()
    } else {
      this.closeTabEventsPort()
    }
  }

  private openTabEventsPort(): void {
    if (this.tabEventsPort !== null || this.callbacks.onTabEvent === undefined) {
      return
    }
    let port: ChromeRuntimePort
    try {
      port = connectExtensionPort(this.extensionId, TAB_EVENTS_PORT_NAME)
    } catch (error) {
      if (error instanceof ExtensionCommandError) {
        this.callbacks.onError?.(error)
      }
      return
    }
    this.tabEventsPort = port

    port.onMessage.addListener((message) => {
      const event = parseBrowserTabEventMessage(message)
      if (event !== null) this.callbacks.onTabEvent?.(event)
    })

    port.onDisconnect.addListener(() => {
      if (this.tabEventsPort === port) {
        this.tabEventsPort = null
      }
    })
  }

  private closeTabEventsPort(): void {
    const port = this.tabEventsPort
    if (port === null) return
    this.tabEventsPort = null
    try {
      port.disconnect()
    } catch {
      // ignore
    }
  }
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : ''
}

export function isDebuggerAlreadyAttachedError(error: unknown): boolean {
  return getErrorMessage(error).toLowerCase().includes('already attached')
}

export function isDebuggerNotAttachedError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase()
  return message.includes('not attached') || message.includes('detached')
}

export function isRestrictedChromeUrlNavigationError(error: unknown): boolean {
  return getErrorMessage(error).includes('Cannot access a chrome:// URL')
}
