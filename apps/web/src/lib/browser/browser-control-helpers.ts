import { ExtensionCommandError } from './extension-messaging.ts'
import type { BrowserExtensionBridge } from './browser-extension-bridge.ts'
import type {
  BrowserControlAttachmentMetadata,
  BrowserControlAttachmentReader,
  BrowserControlOutputMetadata,
  BrowserControlOutputWriter,
} from './browser-control-types.ts'

export const BROWSER_CONTROL_ATTACHMENT_CHUNK_BYTES = 512 * 1024
export const BROWSER_CONTROL_OUTPUT_CHUNK_BYTES = 512 * 1024

export function getBase64ByteLength(value: string): number {
  if (value.length === 0) return 0
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.floor((value.length * 3) / 4) - padding
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('Browser-control request was cancelled.')
  }
}

async function evaluateHelperScript(input: {
  readonly bridge: BrowserExtensionBridge
  readonly expression: string
  readonly label: string
  readonly signal: AbortSignal
  readonly tabId: number
}): Promise<unknown> {
  const { bridge, expression, label, signal, tabId } = input
  const result = await bridge.sendCdpCommand({
    tabId,
    method: 'Runtime.evaluate',
    params: {
      awaitPromise: true,
      expression,
      returnByValue: true,
    },
    signal,
  })
  if (
    typeof result !== 'object' ||
    result === null ||
    Array.isArray(result)
  ) {
    throw new Error(`${label} returned an invalid CDP result.`)
  }
  const record = result as Record<string, unknown>
  if (record.exceptionDetails !== undefined) {
    throw new Error(`${label} failed while running helper script.`)
  }
  const remote = record.result
  if (
    typeof remote !== 'object' ||
    remote === null ||
    Array.isArray(remote)
  ) {
    return null
  }
  const remoteRecord = remote as Record<string, unknown>
  if ('value' in remoteRecord) return remoteRecord.value
  if ('unserializableValue' in remoteRecord) return remoteRecord.unserializableValue
  return null
}

export async function hydrateBrowserControlAttachments(input: {
  readonly attachments: readonly BrowserControlAttachmentMetadata[]
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly readAttachment: BrowserControlAttachmentReader | undefined
  readonly signal: AbortSignal
}): Promise<void> {
  const { attachments, bridge, tabId, readAttachment, signal } = input
  if (readAttachment === undefined) {
    throw new ExtensionCommandError(
      'BROWSER_ATTACHMENTS_UNSUPPORTED',
      'Browser-control attachment reader is unavailable.',
    )
  }

  await evaluateHelperScript({
    bridge,
    expression: browserControlFilesHelperExpression,
    label: 'browserControlFiles.install',
    signal,
    tabId,
  })

  for (const attachment of attachments) {
    await evaluateHelperScript({
      bridge,
      expression: `window.__heysnapFiles.__begin(${JSON.stringify(attachment)})`,
      label: `browserControlFiles.${attachment.id}.begin`,
      signal,
      tabId,
    })

    let offset = 0
    for (;;) {
      throwIfAborted(signal)
      const chunk = await readAttachment({
        attachmentId: attachment.id,
        length: BROWSER_CONTROL_ATTACHMENT_CHUNK_BYTES,
        offset,
        signal,
      })

      if (chunk.offset !== offset) {
        throw new Error(
          `Browser-control attachment ${attachment.id} returned an unexpected chunk offset.`,
        )
      }

      const byteLength = getBase64ByteLength(chunk.dataBase64)
      await evaluateHelperScript({
        bridge,
        expression: `window.__heysnapFiles.__append(${JSON.stringify(attachment.id)}, ${JSON.stringify(chunk.dataBase64)})`,
        label: `browserControlFiles.${attachment.id}.append`,
        signal,
        tabId,
      })
      offset += byteLength

      if (chunk.done) break

      if (byteLength === 0) {
        throw new Error(
          `Browser-control attachment ${attachment.id} returned an empty non-final chunk.`,
        )
      }
    }

    if (offset !== attachment.size) {
      throw new Error(
        `Browser-control attachment ${attachment.id} size mismatch after streaming.`,
      )
    }

    await evaluateHelperScript({
      bridge,
      expression: `window.__heysnapFiles.__finish(${JSON.stringify(attachment.id)})`,
      label: `browserControlFiles.${attachment.id}.finish`,
      signal,
      tabId,
    })
  }
}

export async function prepareBrowserControlDownloads(input: {
  readonly bridge: BrowserExtensionBridge
  readonly outputs: readonly BrowserControlOutputMetadata[]
  readonly tabId: number
  readonly signal: AbortSignal
}): Promise<void> {
  const { bridge, outputs, tabId, signal } = input
  await evaluateHelperScript({
    bridge,
    expression: browserControlDownloadsHelperExpression,
    label: 'browserControlDownloads.install',
    signal,
    tabId,
  })
  await evaluateHelperScript({
    bridge,
    expression: `window.__heysnapDownloads.__prepare(${JSON.stringify(outputs)})`,
    label: 'browserControlDownloads.prepare',
    signal,
    tabId,
  })
}

export async function drainBrowserControlDownloads(input: {
  readonly bridge: BrowserExtensionBridge
  readonly outputs: readonly BrowserControlOutputMetadata[]
  readonly tabId: number
  readonly signal: AbortSignal
  readonly writeOutput: BrowserControlOutputWriter | undefined
}): Promise<void> {
  const { bridge, outputs, tabId, signal, writeOutput } = input
  if (writeOutput === undefined) {
    throw new ExtensionCommandError(
      'BROWSER_OUTPUTS_UNSUPPORTED',
      'Browser-control output writer is unavailable.',
    )
  }

  for (const output of outputs) {
    const infoValue = await evaluateHelperScript({
      bridge,
      expression: `window.__heysnapDownloads.__info(${JSON.stringify(output.id)})`,
      label: `browserControlDownloads.${output.id}.info`,
      signal,
      tabId,
    })
    const info = readDownloadInfo(
      infoValue,
      `browserControlDownloads.${output.id}.info`,
    )

    if (info.size > output.maxBytes) {
      throw new ExtensionCommandError(
        'BROWSER_OUTPUT_TOO_LARGE',
        `Browser-control download ${output.id} exceeds the ${String(output.maxBytes)} byte limit.`,
      )
    }

    let offset = 0
    for (;;) {
      throwIfAborted(signal)
      const chunkValue = await evaluateHelperScript({
        bridge,
        expression: `window.__heysnapDownloads.__read(${JSON.stringify(output.id)}, ${String(offset)}, ${String(BROWSER_CONTROL_OUTPUT_CHUNK_BYTES)})`,
        label: `browserControlDownloads.${output.id}.read`,
        signal,
        tabId,
      })
      const chunk = readDownloadChunk(
        chunkValue,
        `browserControlDownloads.${output.id}.read`,
      )

      if (chunk.offset !== offset) {
        throw new Error(
          `Browser-control download ${output.id} returned an unexpected chunk offset.`,
        )
      }

      const ack = await writeOutput({
        dataBase64: chunk.dataBase64,
        done: chunk.done,
        offset,
        outputId: output.id,
        signal,
      })
      const byteLength = getBase64ByteLength(chunk.dataBase64)

      if (ack.offset !== offset || ack.bytesWritten !== byteLength) {
        throw new Error(
          'Browser-control output acknowledged an unexpected write range.',
        )
      }

      offset += byteLength

      if (chunk.done) break

      if (byteLength === 0) {
        throw new Error(
          `Browser-control download ${output.id} returned an empty non-final chunk.`,
        )
      }
    }

    if (offset !== info.size) {
      throw new Error(
        `Browser-control download ${output.id} size mismatch after streaming.`,
      )
    }
  }
}

export async function streamBrowserControlOutput(input: {
  readonly dataBase64: string
  readonly outputId: string
  readonly signal: AbortSignal
  readonly writeOutput: BrowserControlOutputWriter
}): Promise<void> {
  const { dataBase64, outputId, signal, writeOutput } = input
  const maxChunkCharacters = Math.floor(BROWSER_CONTROL_OUTPUT_CHUNK_BYTES / 3) * 4
  let offset = 0

  if (dataBase64.length === 0) {
    await writeOutput({
      dataBase64: '',
      done: true,
      offset: 0,
      outputId,
      signal,
    })
    return
  }

  for (let index = 0; index < dataBase64.length; index += maxChunkCharacters) {
    throwIfAborted(signal)
    const chunk = dataBase64.slice(index, index + maxChunkCharacters)
    const done = index + maxChunkCharacters >= dataBase64.length
    const ack = await writeOutput({
      dataBase64: chunk,
      done,
      offset,
      outputId,
      signal,
    })
    const byteLength = getBase64ByteLength(chunk)

    if (ack.offset !== offset || ack.bytesWritten !== byteLength) {
      throw new Error(
        'Browser-control output acknowledged an unexpected write range.',
      )
    }

    offset += byteLength
  }
}

function readDownloadInfo(
  value: unknown,
  label: string,
): { readonly size: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  const size = (value as Record<string, unknown>).size
  if (typeof size !== 'number' || !Number.isFinite(size)) {
    throw new Error(`${label}.size must be a number.`)
  }
  return { size }
}

function readDownloadChunk(
  value: unknown,
  label: string,
): { readonly dataBase64: string; readonly done: boolean; readonly offset: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  const record = value as Record<string, unknown>
  if (typeof record.dataBase64 !== 'string') {
    throw new Error(`${label}.dataBase64 must be a string.`)
  }
  if (typeof record.done !== 'boolean') {
    throw new Error(`${label}.done must be a boolean.`)
  }
  if (typeof record.offset !== 'number' || !Number.isFinite(record.offset)) {
    throw new Error(`${label}.offset must be a number.`)
  }
  return {
    dataBase64: record.dataBase64,
    done: record.done,
    offset: record.offset,
  }
}

const browserControlDownloadsHelperExpression = `(() => {
  const VERSION = 1;
  const existing = window.__heysnapDownloads;
  if (existing !== undefined && existing.version === VERSION) {
    return true;
  }

  const records = new Map();
  const encoder = new TextEncoder();
  const getIds = (ids) => {
    if (ids === undefined) {
      return Array.from(records.keys());
    }
    if (Array.isArray(ids)) {
      return ids;
    }
    return [ids];
  };
  const requireRecord = (id) => {
    const record = records.get(id);
    if (record === undefined) {
      throw new Error("Browser-control download output not found: " + id);
    }
    return record;
  };
  const requireSavedRecord = (id) => {
    const record = requireRecord(id);
    if (record.blob === null) {
      throw new Error("Browser-control download output was not saved: " + id);
    }
    return record;
  };
  const toBlob = async (source, mimeType) => {
    if (source instanceof Response) {
      return await source.blob();
    }
    if (source instanceof Blob) {
      return source;
    }
    if (source instanceof ArrayBuffer) {
      return new Blob([source], { type: mimeType });
    }
    if (ArrayBuffer.isView(source)) {
      return new Blob([source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)], { type: mimeType });
    }
    if (typeof source === "string") {
      return new Blob([encoder.encode(source)], { type: mimeType || "text/plain;charset=utf-8" });
    }
    throw new Error("Browser-control download source must be a Response, Blob, ArrayBuffer, typed array, DataView, or string.");
  };
  const encodeBase64 = (bytes) => {
    let binary = "";
    const batchSize = 0x8000;
    for (let index = 0; index < bytes.length; index += batchSize) {
      const chunk = bytes.subarray(index, index + batchSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
  };
  const api = {
    version: VERSION,
    __prepare(outputs) {
      records.clear();
      for (const output of outputs) {
        records.set(output.id, {
          blob: null,
          maxBytes: output.maxBytes,
          mimeType: output.mimeType || "application/octet-stream",
        });
      }
      return true;
    },
    __info(id) {
      const record = requireSavedRecord(id);
      return {
        size: record.blob.size,
      };
    },
    async __read(id, offset, length) {
      const record = requireSavedRecord(id);
      if (!Number.isFinite(offset) || offset < 0 || offset > record.blob.size) {
        throw new Error("Browser-control download offset is outside the saved output.");
      }
      if (!Number.isFinite(length) || length <= 0) {
        throw new Error("Browser-control download read length must be positive.");
      }
      const end = Math.min(offset + length, record.blob.size);
      const bytes = new Uint8Array(await record.blob.slice(offset, end).arrayBuffer());
      return {
        dataBase64: encodeBase64(bytes),
        done: end >= record.blob.size,
        offset,
      };
    },
    async save(id, source, options) {
      const record = requireRecord(id);
      const blob = await toBlob(source, options && typeof options.mimeType === "string" ? options.mimeType : record.mimeType);
      if (blob.size > record.maxBytes) {
        throw new Error("Browser-control download exceeds the configured byte limit: " + id);
      }
      record.blob = blob;
      return {
        id,
        mimeType: blob.type || record.mimeType,
        size: blob.size,
      };
    },
    clear(ids) {
      for (const id of getIds(ids)) {
        const record = requireRecord(id);
        record.blob = null;
      }
      return true;
    },
  };

  Object.defineProperty(window, "__heysnapDownloads", {
    configurable: true,
    value: api,
  });
  return true;
})()`

const browserControlFilesHelperExpression = `(() => {
  const VERSION = 1;
  const existing = window.__heysnapFiles;
  if (existing !== undefined && existing.version === VERSION) {
    return true;
  }

  const records = new Map();
  const requireRecord = (id) => {
    const record = records.get(id);
    if (record === undefined) {
      throw new Error("Browser-control file not found: " + id);
    }
    return record;
  };
  const decodeBase64 = (dataBase64) => {
    const binary = atob(dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  };
  const resolveTarget = (selectorOrElement) => {
    if (typeof selectorOrElement === "string") {
      const element = document.querySelector(selectorOrElement);
      if (element === null) {
        throw new Error("Browser-control file target not found: " + selectorOrElement);
      }
      return element;
    }
    if (selectorOrElement instanceof Element) {
      return selectorOrElement;
    }
    throw new Error("Browser-control file target must be a selector or Element.");
  };
  const getIds = (ids) => {
    if (ids === undefined) {
      return Array.from(records.keys());
    }
    if (Array.isArray(ids)) {
      return ids;
    }
    return [ids];
  };
  const makeFile = (id) => {
    const record = requireRecord(id);
    if (record.done !== true) {
      throw new Error("Browser-control file is not fully loaded: " + id);
    }
    return new File(record.parts, record.name, {
      type: record.mimeType,
      lastModified: record.lastModified,
    });
  };
  const api = {
    version: VERSION,
    __begin(metadata) {
      records.set(metadata.id, {
        done: false,
        lastModified: Date.now(),
        mimeType: metadata.mimeType || "application/octet-stream",
        name: metadata.name || metadata.id,
        parts: [],
        size: metadata.size,
      });
      return true;
    },
    __append(id, dataBase64) {
      const record = requireRecord(id);
      record.parts.push(decodeBase64(dataBase64));
      return true;
    },
    __finish(id) {
      const record = requireRecord(id);
      record.done = true;
      return true;
    },
    async get(id) {
      return makeFile(id);
    },
    async getAll(ids) {
      return getIds(ids).map((id) => makeFile(id));
    },
    async setInputFiles(selectorOrElement, ids) {
      const target = resolveTarget(selectorOrElement);
      const files = await api.getAll(ids);
      const dataTransfer = new DataTransfer();
      for (const file of files) {
        dataTransfer.items.add(file);
      }
      target.files = dataTransfer.files;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return { count: files.length };
    },
    async dropFiles(selectorOrElement, ids) {
      const target = resolveTarget(selectorOrElement);
      const files = await api.getAll(ids);
      const dataTransfer = new DataTransfer();
      for (const file of files) {
        dataTransfer.items.add(file);
      }
      const event = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      target.dispatchEvent(event);
      return { count: files.length };
    },
    clear(ids) {
      if (ids === undefined) {
        records.clear();
        return true;
      }
      for (const id of getIds(ids)) {
        records.delete(id);
      }
      return true;
    },
  };

  Object.defineProperty(window, "__heysnapFiles", {
    configurable: true,
    value: api,
  });
  return true;
})()`
