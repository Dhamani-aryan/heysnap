import type {
  BrowserControlAttachmentMetadata,
  BrowserControlCommandName,
  BrowserControlOutputMetadata,
  BrowserControlServerMessage,
} from './browser-control-types.ts'

const COMMAND_NAMES = new Set<string>([
  'getTabs',
  'createNewTab',
  'closeTab',
  'tab.focus',
  'tab.back',
  'tab.forward',
  'tab.goTo',
  'tab.refresh',
  'tab.evaluate',
  'tab.screenshot',
  'tab.cdp',
])

export function parseBrowserControlServerMessage(
  data: unknown,
): BrowserControlServerMessage | null {
  if (typeof data !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }
  const message = parsed as Record<string, unknown>
  const type = message.type

  if (type === 'request') {
    if (typeof message.requestId !== 'string') return null
    if (typeof message.command !== 'string') return null
    if (!COMMAND_NAMES.has(message.command)) return null
    const attachments = parseAttachments(message.attachments)
    const outputs = parseOutputs(message.outputs)
    if (attachments === null || outputs === null) return null
    return {
      type: 'request',
      requestId: message.requestId,
      command: message.command as BrowserControlCommandName,
      params: message.params,
      timeoutMs:
        typeof message.timeoutMs === 'number' ? message.timeoutMs : undefined,
      attachments,
      outputs,
    }
  }

  if (type === 'cancel') {
    if (typeof message.requestId !== 'string') return null
    return {
      type: 'cancel',
      requestId: message.requestId,
      reason: typeof message.reason === 'string' ? message.reason : undefined,
    }
  }

  if (type === 'pong') {
    if (typeof message.requestId !== 'string') return null
    if (typeof message.serverTime !== 'string') return null
    return {
      type: 'pong',
      requestId: message.requestId,
      serverTime: message.serverTime,
    }
  }

  if (type === 'attachment.chunk') {
    if (
      typeof message.requestId !== 'string' ||
      typeof message.chunkRequestId !== 'string' ||
      typeof message.attachmentId !== 'string' ||
      typeof message.offset !== 'number' ||
      typeof message.dataBase64 !== 'string' ||
      typeof message.done !== 'boolean'
    ) {
      return null
    }
    return {
      type: 'attachment.chunk',
      requestId: message.requestId,
      chunkRequestId: message.chunkRequestId,
      attachmentId: message.attachmentId,
      offset: message.offset,
      dataBase64: message.dataBase64,
      done: message.done,
    }
  }

  if (type === 'attachment.error') {
    const error = parseErrorObject(message.error)
    if (
      error === null ||
      typeof message.requestId !== 'string' ||
      typeof message.chunkRequestId !== 'string' ||
      typeof message.attachmentId !== 'string'
    ) {
      return null
    }
    return {
      type: 'attachment.error',
      requestId: message.requestId,
      chunkRequestId: message.chunkRequestId,
      attachmentId: message.attachmentId,
      error,
    }
  }

  if (type === 'output.ack') {
    if (
      typeof message.requestId !== 'string' ||
      typeof message.writeRequestId !== 'string' ||
      typeof message.outputId !== 'string' ||
      typeof message.offset !== 'number' ||
      typeof message.bytesWritten !== 'number' ||
      typeof message.done !== 'boolean'
    ) {
      return null
    }
    return {
      type: 'output.ack',
      requestId: message.requestId,
      writeRequestId: message.writeRequestId,
      outputId: message.outputId,
      offset: message.offset,
      bytesWritten: message.bytesWritten,
      done: message.done,
    }
  }

  if (type === 'output.error') {
    const error = parseErrorObject(message.error)
    if (
      error === null ||
      typeof message.requestId !== 'string' ||
      typeof message.writeRequestId !== 'string' ||
      typeof message.outputId !== 'string'
    ) {
      return null
    }
    return {
      type: 'output.error',
      requestId: message.requestId,
      writeRequestId: message.writeRequestId,
      outputId: message.outputId,
      error,
    }
  }

  return null
}

function parseErrorObject(
  value: unknown,
): { code: string; message: string } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.code !== 'string' || typeof record.message !== 'string') {
    return null
  }
  return { code: record.code, message: record.message }
}

function parseAttachments(
  value: unknown,
): readonly BrowserControlAttachmentMetadata[] | null | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return null
  const items: BrowserControlAttachmentMetadata[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return null
    }
    const record = entry as Record<string, unknown>
    if (
      typeof record.id !== 'string' ||
      typeof record.name !== 'string' ||
      typeof record.mimeType !== 'string' ||
      typeof record.size !== 'number'
    ) {
      return null
    }
    items.push({
      id: record.id,
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
    })
  }
  return items
}

function parseOutputs(
  value: unknown,
): readonly BrowserControlOutputMetadata[] | null | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return null
  const items: BrowserControlOutputMetadata[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return null
    }
    const record = entry as Record<string, unknown>
    if (
      typeof record.id !== 'string' ||
      typeof record.mimeType !== 'string' ||
      typeof record.maxBytes !== 'number'
    ) {
      return null
    }
    items.push({
      id: record.id,
      mimeType: record.mimeType,
      maxBytes: record.maxBytes,
    })
  }
  return items
}

export function shouldReconnectBrowserControlSocket(input: {
  readonly closeCode: number
  readonly isCancelled: boolean
}): boolean {
  if (input.isCancelled) return false
  return input.closeCode !== 1003
}
