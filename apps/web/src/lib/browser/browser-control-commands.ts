import { ExtensionCommandError } from './extension-messaging.ts'
import {
  isRestrictedChromeUrlNavigationError,
  type BrowserExtensionBridge,
} from './browser-extension-bridge.ts'
import { DEFAULT_BROWSER_WINDOW_URL } from './parsers.ts'
import type {
  BrowserControlAttachmentMetadata,
  BrowserControlAttachmentReader,
  BrowserControlOutputMetadata,
  BrowserControlOutputWriter,
} from './browser-control-types.ts'
import {
  drainBrowserControlDownloads,
  getBase64ByteLength,
  hydrateBrowserControlAttachments,
  prepareBrowserControlDownloads,
  streamBrowserControlOutput,
} from './browser-control-helpers.ts'

export type ExecuteCommandInput = {
  readonly command: string
  readonly params: unknown
  readonly signal: AbortSignal
  readonly timeoutMs?: number
  readonly attachments?: readonly BrowserControlAttachmentMetadata[]
  readonly outputs?: readonly BrowserControlOutputMetadata[]
  readonly readAttachment?: BrowserControlAttachmentReader
  readonly writeOutput?: BrowserControlOutputWriter
  readonly windowId: number
  readonly bridge: BrowserExtensionBridge
}

export async function executeBrowserControlCommand(
  input: ExecuteCommandInput,
): Promise<unknown> {
  const { command, params, signal, windowId, bridge, timeoutMs } = input
  const attachments = input.attachments ?? []
  const outputs = input.outputs ?? []

  if (attachments.length > 0 && command !== 'tab.evaluate') {
    throw new ExtensionCommandError(
      'BROWSER_ATTACHMENTS_UNSUPPORTED',
      'Browser-control attachments are only supported for tab.evaluate.',
    )
  }

  if (
    outputs.length > 0 &&
    command !== 'tab.evaluate' &&
    command !== 'tab.screenshot'
  ) {
    throw new ExtensionCommandError(
      'BROWSER_OUTPUTS_UNSUPPORTED',
      'Browser-control outputs are only supported for tab.evaluate and tab.screenshot.',
    )
  }

  switch (command) {
    case 'getTabs': {
      const optional = readOptionalObject(params, 'getTabs.params')
      return bridge.executeCommand(
        'tabs.query',
        { ...optional, windowId },
        signal,
      )
    }
    case 'createNewTab':
      return createBrowserTabs({ bridge, params, signal, timeoutMs, windowId })
    case 'closeTab':
      return closeBrowserTabs({ bridge, params, signal })
    case 'tab.focus': {
      const parsed = readRequiredObject(params, 'tab.focus.params')
      return bridge.executeCommand(
        'managedWindow.activateTab',
        { tabId: readRequiredNumber(parsed.tabId, 'tab.focus.params.tabId') },
        signal,
      )
    }
    case 'tab.back':
      return navigateBrowserHistory({
        direction: 'back',
        bridge,
        params,
        signal,
        timeoutMs,
      })
    case 'tab.forward':
      return navigateBrowserHistory({
        direction: 'forward',
        bridge,
        params,
        signal,
        timeoutMs,
      })
    case 'tab.goTo': {
      const parsed = readRequiredObject(params, 'tab.goTo.params')
      const tabId = readRequiredNumber(parsed.tabId, 'tab.goTo.params.tabId')
      const url = readRequiredString(parsed.url, 'tab.goTo.params.url')
      const navigation = await navigateManagedBrowserTab({
        bridge,
        signal,
        tabId,
        url,
        windowId,
      })
      return navigation.result
    }
    case 'tab.refresh': {
      const parsed = readRequiredObject(params, 'tab.refresh.params')
      const tabId = readRequiredNumber(parsed.tabId, 'tab.refresh.params.tabId')
      const bypassCache = readOptionalBoolean(
        parsed.bypassCache,
        'tab.refresh.params.bypassCache',
      )
      await bridge.executeCommand(
        'chrome.call',
        {
          api: 'tabs.reload',
          args: bypassCache === undefined ? [tabId] : [tabId, { bypassCache }],
        },
        signal,
      )
      return { reloaded: true, tabId }
    }
    case 'tab.evaluate':
      return evaluateInBrowserTab({
        bridge,
        params,
        signal,
        attachments,
        outputs,
        readAttachment: input.readAttachment,
        writeOutput: input.writeOutput,
      })
    case 'tab.screenshot':
      return captureBrowserTabScreenshot({
        bridge,
        params,
        signal,
        outputs,
        writeOutput: input.writeOutput,
      })
    case 'tab.cdp': {
      const parsed = readRequiredObject(params, 'tab.cdp.params')
      return bridge.sendCdpCommand({
        tabId: readRequiredNumber(parsed.tabId, 'tab.cdp.params.tabId'),
        method: readRequiredString(parsed.method, 'tab.cdp.params.method'),
        params:
          parsed.params === undefined
            ? undefined
            : readRequiredObject(parsed.params, 'tab.cdp.params.params'),
        signal,
      })
    }
    default:
      throw new Error(`Unsupported browser-control command: ${command}`)
  }
}

async function createBrowserTabs(input: {
  readonly bridge: BrowserExtensionBridge
  readonly params: unknown
  readonly signal: AbortSignal
  readonly timeoutMs?: number
  readonly windowId: number
}): Promise<unknown> {
  const { bridge, params, signal, windowId } = input
  const parsed = readRequiredObject(params, 'createNewTab.params')
  const rawTabs = parsed.tabs
  if (!Array.isArray(rawTabs) || rawTabs.length === 0) {
    throw new Error('createNewTab.params.tabs must be a non-empty array.')
  }
  const createdTabs: unknown[] = []
  for (const rawTab of rawTabs) {
    const target = readCreateNewTabTarget(rawTab)
    const createdTab = await bridge.executeCommand(
      'chrome.call',
      { api: 'tabs.create', args: [{ windowId, ...target }] },
      signal,
    )
    createdTabs.push(createdTab)
  }
  await rememberCurrentActiveTab({ bridge, signal, windowId })
  return { tabs: createdTabs, windowId }
}

async function closeBrowserTabs(input: {
  readonly bridge: BrowserExtensionBridge
  readonly params: unknown
  readonly signal: AbortSignal
}): Promise<unknown> {
  const { bridge, params, signal } = input
  const parsed = readRequiredObject(params, 'closeTab.params')
  const rawTabIds = parsed.tabIds
  if (!Array.isArray(rawTabIds) || rawTabIds.length === 0) {
    throw new Error('closeTab.params.tabIds must be a non-empty array.')
  }
  let state: unknown = null
  for (const rawTabId of rawTabIds) {
    state = await bridge.executeCommand(
      'managedWindow.closeTab',
      { tabId: readRequiredNumber(rawTabId, 'closeTab.params.tabIds[]') },
      signal,
    )
  }
  return state
}

async function navigateBrowserHistory(input: {
  readonly direction: 'back' | 'forward'
  readonly bridge: BrowserExtensionBridge
  readonly params: unknown
  readonly signal: AbortSignal
  readonly timeoutMs?: number
}): Promise<unknown> {
  const { direction, bridge, params, signal } = input
  const parsed = readRequiredObject(params, `tab.${direction}.params`)
  const tabId = readRequiredNumber(parsed.tabId, `tab.${direction}.params.tabId`)
  const history = await bridge.sendCdpCommand({
    tabId,
    method: 'Page.getNavigationHistory',
    signal,
  })
  const parsedHistory = readNavigationHistory(history)
  const nextIndex =
    direction === 'back'
      ? parsedHistory.currentIndex - 1
      : parsedHistory.currentIndex + 1
  const entry = parsedHistory.entries[nextIndex]
  if (entry === undefined) {
    return {
      navigated: false,
      reason: direction === 'back' ? 'NO_BACK_HISTORY' : 'NO_FORWARD_HISTORY',
      currentIndex: parsedHistory.currentIndex,
      entriesLength: parsedHistory.entries.length,
      tabId,
      targetIndex: parsedHistory.currentIndex,
    }
  }
  const result = await bridge.sendCdpCommand({
    tabId,
    method: 'Page.navigateToHistoryEntry',
    params: { entryId: entry.id },
    signal,
  })
  return {
    currentIndex: parsedHistory.currentIndex,
    navigated: true,
    direction,
    entry,
    entriesLength: parsedHistory.entries.length,
    result,
    tabId,
    targetIndex: nextIndex,
  }
}

async function navigateManagedBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly signal: AbortSignal
  readonly tabId: number
  readonly url: string
  readonly windowId: number
}): Promise<{ readonly result: unknown; readonly tabId: number }> {
  const { bridge, signal, tabId, url, windowId } = input

  try {
    return {
      result: await bridge.executeCommand(
        'managedWindow.navigate',
        { tabId, url },
        signal,
      ),
      tabId,
    }
  } catch (error) {
    if (!isRestrictedChromeUrlNavigationError(error)) throw error
  }

  try {
    const updatedTab = await bridge.executeCommand(
      'tabs.update',
      { active: true, tabId, url },
      signal,
    )
    const updatedUrl = readOptionalTabUrl(updatedTab) ?? url
    const windowRecord = await bridge.executeCommand(
      'managedWindow.remember',
      { tabId, url: updatedUrl, windowId },
      signal,
    )
    const tabs = await bridge.executeCommand(
      'managedWindow.listTabs',
      undefined,
      signal,
    )
    return {
      result: { fallback: 'tabs.update', tabs, window: windowRecord },
      tabId,
    }
  } catch (error) {
    if (!isRestrictedChromeUrlNavigationError(error)) throw error
  }

  const existingTabs = await bridge.executeCommand(
    'tabs.query',
    { windowId },
    signal,
  )
  const existingTab = Array.isArray(existingTabs)
    ? existingTabs.find(
        (tab): tab is { id: number; index?: number } =>
          isTabRecord(tab) && tab.id === tabId,
      )
    : undefined
  const replacementTab = await bridge.executeCommand(
    'chrome.call',
    {
      api: 'tabs.create',
      args: [
        stripUndefined({
          active: true,
          index: existingTab?.index,
          url,
          windowId,
        }),
      ],
    },
    signal,
  )
  const replacementTabId = readRequiredTabId(
    replacementTab,
    'tab.goTo.replacementTab',
  )
  const replacementUrl = readOptionalTabUrl(replacementTab) ?? url
  bridge.releaseAttachedDebuggerTab(tabId)
  await bridge
    .executeCommand('chrome.call', { api: 'tabs.remove', args: [tabId] }, signal)
    .catch(() => undefined)
  const windowRecord = await bridge.executeCommand(
    'managedWindow.remember',
    { tabId: replacementTabId, url: replacementUrl, windowId },
    signal,
  )
  const tabs = await bridge.executeCommand(
    'managedWindow.listTabs',
    undefined,
    signal,
  )
  return {
    result: {
      fallback: 'replacementTab',
      replacedTabId: tabId,
      tabId: replacementTabId,
      tabs,
      window: windowRecord,
    },
    tabId: replacementTabId,
  }
}

async function evaluateInBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly params: unknown
  readonly signal: AbortSignal
  readonly attachments: readonly BrowserControlAttachmentMetadata[]
  readonly outputs: readonly BrowserControlOutputMetadata[]
  readonly readAttachment: BrowserControlAttachmentReader | undefined
  readonly writeOutput: BrowserControlOutputWriter | undefined
}): Promise<unknown> {
  const parsed = readRequiredObject(input.params, 'tab.evaluate.params')
  const tabId = readRequiredNumber(parsed.tabId, 'tab.evaluate.params.tabId')
  const expression = readRequiredString(
    parsed.expression,
    'tab.evaluate.params.expression',
  )
  const requestedAwaitPromise = readOptionalBoolean(
    parsed.awaitPromise,
    'tab.evaluate.params.awaitPromise',
  )
  const returnByValue =
    parsed.returnByValue === undefined
      ? true
      : readOptionalBoolean(
          parsed.returnByValue,
          'tab.evaluate.params.returnByValue',
        )
  const timeout = readOptionalNumber(
    parsed.timeoutMs,
    'tab.evaluate.params.timeoutMs',
  )

  if (input.attachments.length > 0) {
    await hydrateBrowserControlAttachments({
      attachments: input.attachments,
      bridge: input.bridge,
      tabId,
      readAttachment: input.readAttachment,
      signal: input.signal,
    })
  }

  if (input.outputs.length > 0) {
    await prepareBrowserControlDownloads({
      bridge: input.bridge,
      outputs: input.outputs,
      tabId,
      signal: input.signal,
    })
  }

  const awaitPromise =
    input.outputs.length > 0 ? true : requestedAwaitPromise

  const result = await input.bridge.sendCdpCommand({
    tabId,
    method: 'Runtime.evaluate',
    params: stripUndefined({
      expression,
      awaitPromise,
      returnByValue,
      timeout,
    }),
    signal: input.signal,
  })

  const cdpResult = readRequiredObject(result, 'tab.evaluate.result')
  if (cdpResult.exceptionDetails !== undefined) {
    if (input.outputs.length > 0) {
      throw new ExtensionCommandError(
        'BROWSER_EXECUTOR_ERROR',
        'tab.evaluate failed before browser-control downloads completed.',
      )
    }
    return { exceptionDetails: cdpResult.exceptionDetails, ok: false }
  }

  if (input.outputs.length > 0) {
    await drainBrowserControlDownloads({
      bridge: input.bridge,
      outputs: input.outputs,
      tabId,
      signal: input.signal,
      writeOutput: input.writeOutput,
    })
  }

  return { ok: true, result: readCdpRemoteObject(cdpResult.result) }
}

async function captureBrowserTabScreenshot(input: {
  readonly bridge: BrowserExtensionBridge
  readonly params: unknown
  readonly signal: AbortSignal
  readonly outputs: readonly BrowserControlOutputMetadata[]
  readonly writeOutput: BrowserControlOutputWriter | undefined
}): Promise<unknown> {
  const { bridge, signal, outputs, writeOutput } = input
  if (writeOutput === undefined) {
    throw new ExtensionCommandError(
      'BROWSER_OUTPUTS_UNSUPPORTED',
      'Browser-control output writer is unavailable.',
    )
  }
  if (outputs.length !== 1) {
    throw new ExtensionCommandError(
      'BROWSER_OUTPUTS_UNSUPPORTED',
      'tab.screenshot requires exactly one browser-control output.',
    )
  }

  const parsed = readRequiredObject(input.params, 'tab.screenshot.params')
  const tabId = readRequiredNumber(parsed.tabId, 'tab.screenshot.params.tabId')
  const screenshotParams = await buildScreenshotCdpParams({
    bridge,
    params: parsed,
    signal,
    tabId,
  })
  const result = await bridge.sendCdpCommand({
    tabId,
    method: 'Page.captureScreenshot',
    params: screenshotParams,
    signal,
  })
  const dataBase64 = readScreenshotData(result)
  const size = getBase64ByteLength(dataBase64)
  const output = outputs[0]

  if (size > output.maxBytes) {
    throw new ExtensionCommandError(
      'BROWSER_OUTPUT_TOO_LARGE',
      `Browser-control screenshot exceeds the ${String(output.maxBytes)} byte limit.`,
    )
  }

  await streamBrowserControlOutput({
    dataBase64,
    outputId: output.id,
    signal,
    writeOutput,
  })

  return { tabId, outputId: output.id, size }
}

async function buildScreenshotCdpParams(input: {
  readonly bridge: BrowserExtensionBridge
  readonly params: Record<string, unknown>
  readonly signal: AbortSignal
  readonly tabId: number
}): Promise<Record<string, unknown>> {
  const { bridge, params, signal, tabId } = input
  const captureMode =
    readOptionalString(params.captureMode, 'tab.screenshot.params.captureMode') ??
    'viewport'
  const format = readRequiredString(params.format, 'tab.screenshot.params.format')
  const clip =
    captureMode === 'clip'
      ? readScreenshotClip(params.clip, 'tab.screenshot.params.clip')
      : captureMode === 'fullPage'
        ? await readFullPageScreenshotClip({ bridge, signal, tabId })
        : undefined

  return stripUndefined({
    format,
    quality: readOptionalNumber(
      params.quality,
      'tab.screenshot.params.quality',
    ),
    clip,
    fromSurface: readOptionalBoolean(
      params.fromSurface,
      'tab.screenshot.params.fromSurface',
    ),
    captureBeyondViewport:
      captureMode === 'fullPage'
        ? true
        : readOptionalBoolean(
            params.captureBeyondViewport,
            'tab.screenshot.params.captureBeyondViewport',
          ),
    optimizeForSpeed: readOptionalBoolean(
      params.optimizeForSpeed,
      'tab.screenshot.params.optimizeForSpeed',
    ),
  })
}

async function readFullPageScreenshotClip(input: {
  readonly bridge: BrowserExtensionBridge
  readonly signal: AbortSignal
  readonly tabId: number
}): Promise<{
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly scale: number
}> {
  const metrics = readRequiredObject(
    await input.bridge.sendCdpCommand({
      tabId: input.tabId,
      method: 'Page.getLayoutMetrics',
      signal: input.signal,
    }),
    'Page.getLayoutMetrics.result',
  )
  const rawContentSize = metrics.cssContentSize ?? metrics.contentSize
  const contentSize = readRequiredObject(
    rawContentSize,
    'Page.getLayoutMetrics.result.contentSize',
  )
  const x = typeof contentSize.x === 'number' ? contentSize.x : 0
  const y = typeof contentSize.y === 'number' ? contentSize.y : 0
  return {
    x,
    y,
    width: Math.max(
      readRequiredNumber(
        contentSize.width,
        'Page.getLayoutMetrics.result.contentSize.width',
      ),
      1,
    ),
    height: Math.max(
      readRequiredNumber(
        contentSize.height,
        'Page.getLayoutMetrics.result.contentSize.height',
      ),
      1,
    ),
    scale: 1,
  }
}

function readScreenshotClip(
  value: unknown,
  label: string,
): {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly scale?: number
} {
  const clip = readRequiredObject(value, label)
  return stripUndefined({
    x: readRequiredNumber(clip.x, `${label}.x`),
    y: readRequiredNumber(clip.y, `${label}.y`),
    width: readRequiredNumber(clip.width, `${label}.width`),
    height: readRequiredNumber(clip.height, `${label}.height`),
    scale: readOptionalNumber(clip.scale, `${label}.scale`),
  })
}

function readScreenshotData(value: unknown): string {
  const result = readRequiredObject(value, 'Page.captureScreenshot.result')
  return readRequiredString(result.data, 'Page.captureScreenshot.result.data')
}

async function rememberCurrentActiveTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly signal: AbortSignal
  readonly windowId: number
}): Promise<void> {
  const { bridge, signal, windowId } = input
  const tabs = await bridge.executeCommand(
    'tabs.query',
    { windowId, active: true },
    signal,
  )
  const activeTab = Array.isArray(tabs)
    ? tabs.find(isTabRecord)
    : undefined
  if (activeTab?.id === undefined) return
  await bridge.executeCommand(
    'managedWindow.remember',
    {
      windowId,
      tabId: activeTab.id,
      url: typeof activeTab.url === 'string' && activeTab.url.length > 0
        ? activeTab.url
        : DEFAULT_BROWSER_WINDOW_URL,
    },
    signal,
  )
}

function readCreateNewTabTarget(value: unknown): {
  readonly url?: string
  readonly active?: boolean
  readonly index?: number
  readonly openerTabId?: number
} {
  const parsed = readRequiredObject(value, 'createNewTab.params.tabs[]')
  return stripUndefined({
    url: readOptionalString(parsed.url, 'createNewTab.params.tabs[].url'),
    active: readOptionalBoolean(
      parsed.active,
      'createNewTab.params.tabs[].active',
    ),
    index: readOptionalNumber(parsed.index, 'createNewTab.params.tabs[].index'),
    openerTabId: readOptionalNumber(
      parsed.openerTabId,
      'createNewTab.params.tabs[].openerTabId',
    ),
  })
}

function readNavigationHistory(value: unknown): {
  readonly currentIndex: number
  readonly entries: readonly {
    readonly id: number
    readonly url?: string
    readonly title?: string
  }[]
} {
  const parsed = readRequiredObject(value, 'navigationHistory')
  const currentIndex = readRequiredNumber(
    parsed.currentIndex,
    'navigationHistory.currentIndex',
  )
  const rawEntries = parsed.entries
  if (!Array.isArray(rawEntries)) {
    throw new Error('navigationHistory.entries must be an array.')
  }
  return {
    currentIndex,
    entries: rawEntries.map((entry) => {
      const parsedEntry = readRequiredObject(
        entry,
        'navigationHistory.entries[]',
      )
      return stripUndefined({
        id: readRequiredNumber(parsedEntry.id, 'navigationHistory.entries[].id'),
        url: readOptionalString(
          parsedEntry.url,
          'navigationHistory.entries[].url',
        ),
        title: readOptionalString(
          parsedEntry.title,
          'navigationHistory.entries[].title',
        ),
      })
    }),
  }
}

function readCdpRemoteObject(value: unknown): unknown {
  const remote = readRequiredObject(value, 'Runtime.evaluate.result')
  if ('value' in remote) return remote.value
  if ('unserializableValue' in remote) return remote.unserializableValue
  if ('description' in remote) return remote.description
  return null
}

function isTabRecord(
  value: unknown,
): value is { readonly id: number; readonly index?: number; readonly url?: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  return typeof (value as { id?: unknown }).id === 'number'
}

function readRequiredTabId(value: unknown, label: string): number {
  const parsed = readRequiredObject(value, label)
  return readRequiredNumber(parsed.id, `${label}.id`)
}

function readOptionalTabUrl(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return readOptionalString((value as Record<string, unknown>).url, 'tab.url')
}

function readRequiredObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return value as Record<string, unknown>
}

function readOptionalObject(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {}
  return readRequiredObject(value, label)
}

function readRequiredNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number.`)
  }
  return value
}

function readOptionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  return readRequiredNumber(value, label)
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  return readRequiredString(value, label)
}

function readOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`)
  }
  return value
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T
}
