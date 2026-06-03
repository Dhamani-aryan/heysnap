import type { BrowserExtensionBridge } from './browser-extension-bridge.ts'
import type {
  BrowserViewportClickInput,
  BrowserViewportInputPoint,
  BrowserViewportKeyboardInput,
  BrowserViewportWheelInput,
} from './browser-input-types.ts'
import {
  createBrowserKeyboardEventParams,
  readBrowserViewportSize,
} from './browser-viewport.ts'
import {
  parseBrowserWindowTab,
  parseBrowserWindowTabs,
  parseChromeWindow,
} from './parsers.ts'
import type { BrowserWindowTab } from './types.ts'

export async function clickBrowserViewport(input: {
  readonly bridge: BrowserExtensionBridge
  readonly click: BrowserViewportClickInput
  readonly signal: AbortSignal
}): Promise<void> {
  const point = await resolveViewportPoint({
    bridge: input.bridge,
    tabId: input.click.tabId,
    ratio: input.click.ratio,
    fallbackPoint: input.click.fallbackPoint,
    signal: input.signal,
  })
  const baseParams = {
    x: Math.round(point.x),
    y: Math.round(point.y),
    button: 'left',
    clickCount: 1,
  }
  await input.bridge.sendCdpCommand({
    tabId: input.click.tabId,
    method: 'Input.dispatchMouseEvent',
    params: { ...baseParams, type: 'mousePressed' },
    signal: input.signal,
  })
  await input.bridge.sendCdpCommand({
    tabId: input.click.tabId,
    method: 'Input.dispatchMouseEvent',
    params: { ...baseParams, type: 'mouseReleased' },
    signal: input.signal,
  })
}

export async function wheelBrowserViewport(input: {
  readonly bridge: BrowserExtensionBridge
  readonly wheel: BrowserViewportWheelInput
  readonly signal: AbortSignal
}): Promise<void> {
  const point = await resolveViewportPoint({
    bridge: input.bridge,
    tabId: input.wheel.tabId,
    ratio: input.wheel.ratio,
    fallbackPoint: input.wheel.fallbackPoint,
    signal: input.signal,
  })
  await input.bridge.sendCdpCommand({
    tabId: input.wheel.tabId,
    method: 'Input.dispatchMouseEvent',
    params: {
      type: 'mouseWheel',
      x: Math.round(point.x),
      y: Math.round(point.y),
      deltaX: Math.round(input.wheel.deltaX),
      deltaY: Math.round(input.wheel.deltaY),
    },
    signal: input.signal,
  })
}

export async function typeBrowserViewport(input: {
  readonly bridge: BrowserExtensionBridge
  readonly key: BrowserViewportKeyboardInput
  readonly signal: AbortSignal
}): Promise<void> {
  await input.bridge.sendCdpCommand({
    tabId: input.key.tabId,
    method: 'Input.dispatchKeyEvent',
    params: createBrowserKeyboardEventParams(input.key),
    signal: input.signal,
  })
}

export async function insertBrowserViewportText(input: {
  readonly bridge: BrowserExtensionBridge
  readonly signal: AbortSignal
  readonly tabId: number
  readonly text: string
}): Promise<void> {
  const inserted = await input.bridge.sendCdpCommand({
    tabId: input.tabId,
    method: 'Runtime.evaluate',
    params: {
      expression: createBrowserTextInsertionExpression(input.text),
      returnByValue: true,
      userGesture: true,
    },
    signal: input.signal,
  })
  const runtimeResult = readRuntimeObjectResult(inserted)
  logBrowserActionDebug('insert-text.runtime', {
    textLength: input.text.length,
    ...(runtimeResult ?? {}),
  })
  if (runtimeResult?.inserted === true) return

  logBrowserActionDebug('insert-text.cdp-fallback', {
    textLength: input.text.length,
  })
  await input.bridge.sendCdpCommand({
    tabId: input.tabId,
    method: 'Input.insertText',
    params: { text: input.text },
    signal: input.signal,
  })
  logBrowserActionDebug('insert-text.cdp-fallback-sent', {
    textLength: input.text.length,
  })
}

function createBrowserTextInsertionExpression(text: string): string {
  return `
(() => {
  const describeTarget = (target) => {
    if (!(target instanceof HTMLElement)) {
      return {
        tagName: target && typeof target === 'object' ? target.nodeName : null,
      };
    }
    return {
      tagName: target.tagName,
      inputType: target instanceof HTMLInputElement ? target.type : undefined,
      contentEditable: target.isContentEditable,
      id: target.id || undefined,
      className:
        typeof target.className === 'string' && target.className.length > 0
          ? target.className.slice(0, 80)
          : undefined,
    };
  };

  try {
    const text = ${JSON.stringify(text)};
    const target = document.activeElement;
    if (!(target instanceof HTMLElement)) {
      return {
        inserted: false,
        reason: 'no_html_active_element',
        target: describeTarget(target),
      };
    }

    const dispatchInput = (element, data) => {
      const event =
        typeof InputEvent === 'function'
          ? new InputEvent('input', {
              bubbles: true,
              data,
              inputType: 'insertText',
            })
          : new Event('input', { bubbles: true });
      element.dispatchEvent(event);
    };

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (target.disabled || target.readOnly) {
        return {
          inserted: false,
          reason: target.disabled ? 'target_disabled' : 'target_readonly',
          target: describeTarget(target),
        };
      }
      const start =
        typeof target.selectionStart === 'number'
          ? target.selectionStart
          : target.value.length;
      const end =
        typeof target.selectionEnd === 'number' ? target.selectionEnd : start;
      const nextValue =
        target.value.slice(0, start) + text + target.value.slice(end);
      const prototype =
        target instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor?.set) {
        descriptor.set.call(target, nextValue);
      } else {
        target.value = nextValue;
      }
      const nextSelection = start + text.length;
      target.setSelectionRange(nextSelection, nextSelection);
      dispatchInput(target, text);
      return {
        inserted: true,
        reason: 'input_or_textarea',
        target: describeTarget(target),
      };
    }

    if (target.isContentEditable) {
      target.focus();
      if (
        typeof document.queryCommandSupported === 'function' &&
        document.queryCommandSupported('insertText')
      ) {
        const inserted = document.execCommand('insertText', false, text);
        return {
          inserted,
          reason: 'contenteditable_exec_command',
          target: describeTarget(target),
        };
      }
      const selection = window.getSelection();
      if (selection === null || selection.rangeCount === 0) {
        return {
          inserted: false,
          reason: 'contenteditable_no_selection',
          target: describeTarget(target),
        };
      }
      selection.deleteFromDocument();
      selection.getRangeAt(0).insertNode(document.createTextNode(text));
      selection.collapseToEnd();
      dispatchInput(target, text);
      return {
        inserted: true,
        reason: 'contenteditable_range',
        target: describeTarget(target),
      };
    }

    return {
      inserted: false,
      reason: 'active_element_not_editable',
      target: describeTarget(target),
    };
  } catch {
    return {
      inserted: false,
      reason: 'exception',
    };
  }
})()
`
}

function readRuntimeObjectResult(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  const result = record.result
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return null
  }
  const resultRecord = result as Record<string, unknown>
  return typeof resultRecord.value === 'object' &&
    resultRecord.value !== null &&
    !Array.isArray(resultRecord.value)
    ? (resultRecord.value as Record<string, unknown>)
    : null
}

function logBrowserActionDebug(
  event: string,
  details: Record<string, unknown>,
): void {
  // eslint-disable-next-line no-console
  console.info('[browser-view][web]', event, details)
}

async function resolveViewportPoint(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly ratio: BrowserViewportInputPoint
  readonly fallbackPoint: BrowserViewportInputPoint
  readonly signal: AbortSignal
}): Promise<BrowserViewportInputPoint> {
  try {
    const metrics = await input.bridge.sendCdpCommand({
      tabId: input.tabId,
      method: 'Page.getLayoutMetrics',
      signal: input.signal,
    })
    const size = readBrowserViewportSize(metrics)
    if (size !== null) {
      return { x: input.ratio.x * size.width, y: input.ratio.y * size.height }
    }
  } catch {
    // fall back to frame coordinates
  }
  return input.fallbackPoint
}

export async function goBackInBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly signal: AbortSignal
}): Promise<void> {
  await navigateHistory({ ...input, direction: 'back' })
}

export async function goForwardInBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly signal: AbortSignal
}): Promise<void> {
  await navigateHistory({ ...input, direction: 'forward' })
}

async function navigateHistory(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly signal: AbortSignal
  readonly direction: 'back' | 'forward'
}): Promise<void> {
  const history = await input.bridge.sendCdpCommand({
    tabId: input.tabId,
    method: 'Page.getNavigationHistory',
    signal: input.signal,
  })
  const parsed = parseNavigationHistory(history)
  if (parsed === null) return
  const nextIndex =
    input.direction === 'back'
      ? parsed.currentIndex - 1
      : parsed.currentIndex + 1
  const entry = parsed.entries[nextIndex]
  if (entry === undefined) return
  await input.bridge.sendCdpCommand({
    tabId: input.tabId,
    method: 'Page.navigateToHistoryEntry',
    params: { entryId: entry.id },
    signal: input.signal,
  })
}

export async function refreshBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly signal: AbortSignal
}): Promise<void> {
  await input.bridge.executeCommand(
    'chrome.call',
    { api: 'tabs.reload', args: [input.tabId] },
    input.signal,
  )
}

export async function navigateBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly url: string
  readonly signal: AbortSignal
}): Promise<void> {
  await input.bridge.executeCommand(
    'managedWindow.navigate',
    { tabId: input.tabId, url: input.url },
    input.signal,
  )
}

export async function createBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly windowId: number
  readonly signal: AbortSignal
}): Promise<BrowserWindowTab | null> {
  const result = await input.bridge.executeCommand(
    'chrome.call',
    {
      api: 'tabs.create',
      args: [{ windowId: input.windowId, active: true }],
    },
    input.signal,
  )
  return parseBrowserWindowTab(result)
}

export async function closeBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly signal: AbortSignal
}): Promise<BrowserWindowTab[] | null> {
  const result = await input.bridge.executeCommand(
    'managedWindow.closeTab',
    { tabId: input.tabId },
    input.signal,
  )
  return parseTabsFromCommandResult(result)
}

export async function activateBrowserTab(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly signal: AbortSignal
}): Promise<BrowserWindowTab[] | null> {
  const result = await input.bridge.executeCommand(
    'managedWindow.activateTab',
    { tabId: input.tabId },
    input.signal,
  )
  return parseTabsFromCommandResult(result)
}

export async function readBrowserNavigationState(input: {
  readonly bridge: BrowserExtensionBridge
  readonly tabId: number
  readonly signal: AbortSignal
}): Promise<{ canGoBack: boolean; canGoForward: boolean } | null> {
  try {
    const history = await input.bridge.sendCdpCommand({
      tabId: input.tabId,
      method: 'Page.getNavigationHistory',
      signal: input.signal,
    })
    const parsed = parseNavigationHistory(history)
    if (parsed === null) return null
    return {
      canGoBack: parsed.currentIndex > 0,
      canGoForward: parsed.currentIndex < parsed.entries.length - 1,
    }
  } catch {
    return null
  }
}

function parseNavigationHistory(
  value: unknown,
): { currentIndex: number; entries: { id: number }[] } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.currentIndex !== 'number') return null
  if (!Array.isArray(record.entries)) return null
  const entries: { id: number }[] = []
  for (const entry of record.entries) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { id?: unknown }).id === 'number'
    ) {
      entries.push({ id: (entry as { id: number }).id })
    }
  }
  return { currentIndex: record.currentIndex, entries }
}

function parseTabsFromCommandResult(value: unknown): BrowserWindowTab[] | null {
  if (Array.isArray(value)) return parseBrowserWindowTabs(value)
  if (typeof value !== 'object' || value === null) return null

  try {
    return parseChromeWindow(value).tabs
  } catch {
    // Some managed-window commands return nested records instead of a Chrome
    // window. Try the common nested tab collections before falling back to the
    // event stream.
  }

  const record = value as Record<string, unknown>
  if (Array.isArray(record.tabs)) return parseBrowserWindowTabs(record.tabs)
  const windowRecord = record.window
  if (typeof windowRecord === 'object' && windowRecord !== null) {
    const tabs = (windowRecord as Record<string, unknown>).tabs
    if (Array.isArray(tabs)) return parseBrowserWindowTabs(tabs)
  }
  return null
}
