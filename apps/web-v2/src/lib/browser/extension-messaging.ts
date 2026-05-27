declare global {
  interface Window {
    chrome?: {
      runtime?: {
        lastError?: { readonly message?: string }
        connect?: (
          extensionId: string,
          connectInfo: { readonly name: string },
        ) => ChromeRuntimePort
        sendMessage?: (
          extensionId: string,
          message: ChromeExtensionRequest,
          callback: (response?: ChromeExtensionResponse) => void,
        ) => void
      }
    }
  }
}

type ChromeExtensionRequest = {
  readonly id?: string
  readonly command: string
  readonly payload?: unknown
}

type ChromeExtensionResponse =
  | { readonly ok: true; readonly id?: string; readonly result: unknown }
  | {
      readonly ok: false
      readonly id?: string
      readonly error: { readonly code: string; readonly message: string }
    }

export type ChromeRuntimePort = {
  readonly onDisconnect: {
    readonly addListener: (callback: () => void) => void
  }
  readonly onMessage: {
    readonly addListener: (callback: (message: unknown) => void) => void
  }
  readonly disconnect: () => void
  readonly postMessage: (message: unknown) => void
}

export class ExtensionCommandError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ExtensionCommandError'
    this.code = code
  }
}

export function sendExtensionCommand(
  extensionId: string,
  command: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sendMessage = window.chrome?.runtime?.sendMessage
    if (typeof sendMessage !== 'function') {
      reject(
        new ExtensionCommandError(
          'EXTENSION_MESSAGING_UNAVAILABLE',
          'Chrome extension messaging is unavailable.',
        ),
      )
      return
    }

    if (signal.aborted) {
      reject(
        new ExtensionCommandError(
          'EXTENSION_COMMAND_CANCELLED',
          'Extension command was cancelled.',
        ),
      )
      return
    }

    const id = createExtensionClientId()
    const handleAbort = (): void => {
      reject(
        new ExtensionCommandError(
          'EXTENSION_COMMAND_CANCELLED',
          'Extension command was cancelled.',
        ),
      )
    }
    signal.addEventListener('abort', handleAbort, { once: true })

    sendMessage(extensionId, { id, command, payload }, (message) => {
      signal.removeEventListener('abort', handleAbort)

      const lastError = window.chrome?.runtime?.lastError
      if (lastError !== undefined) {
        reject(
          new ExtensionCommandError(
            'EXTENSION_MESSAGE_FAILED',
            lastError.message ?? 'Chrome extension message failed.',
          ),
        )
        return
      }

      if (message === undefined) {
        reject(
          new ExtensionCommandError(
            'EXTENSION_EMPTY_RESPONSE',
            'Extension returned an empty response.',
          ),
        )
        return
      }

      if (!message.ok) {
        reject(new ExtensionCommandError(message.error.code, message.error.message))
        return
      }

      resolve(message.result)
    })
  })
}

export function connectExtensionPort(
  extensionId: string,
  name: string,
): ChromeRuntimePort {
  const connect = window.chrome?.runtime?.connect
  if (typeof connect !== 'function') {
    throw new ExtensionCommandError(
      'EXTENSION_PORT_UNAVAILABLE',
      'Chrome extension port messaging is unavailable.',
    )
  }
  return connect(extensionId, { name })
}

export function createExtensionClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `browser-ext-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`
}
