import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getLastBrowserFrame,
  subscribeBrowserFrames,
  type BrowserFrame,
} from '../../lib/browser/browser-frame-bus.ts'
import {
  getActiveBrowserExtensionBridge,
  useBrowserStore,
} from '../../stores/browser/browser-store.ts'
import { getBrowserScreencastMode } from '../../lib/browser/browser-screencast-messages.ts'
import {
  activateBrowserTab,
  clickBrowserViewport,
  closeBrowserTab,
  createBrowserTab,
  goBackInBrowserTab,
  goForwardInBrowserTab,
  insertBrowserViewportText,
  navigateBrowserTab,
  refreshBrowserTab,
  typeBrowserViewport,
  wheelBrowserViewport,
} from '../../lib/browser/browser-actions.ts'
import type {
  BrowserViewportInputPoint,
  BrowserViewportKeyboardInput,
} from '../../lib/browser/browser-input-types.ts'
import type { BrowserWindowTab } from '../../lib/browser/types.ts'
import { refreshBrowserTabs } from '../../lib/browser/browser-ui-actions.ts'

const BROWSER_VIEW_PROTOCOL_VERSION = 1
const MAX_PUBLISHER_BUFFERED_BYTES = 4 * 1024 * 1024
const MAX_PUBLISHER_FPS = 12
const MIN_FRAME_INTERVAL_MS = Math.floor(1000 / MAX_PUBLISHER_FPS)
const BROWSER_VIEW_DEBUG = true

export type BrowserViewPublisherStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

type BrowserViewPublisherOptions = {
  readonly enabled: boolean
  readonly streamEnabled: boolean
  readonly url?: string
}

type ActiveBrowserTabSnapshot = {
  readonly windowId: number | null
  readonly tabId: number | null
  readonly title?: string
  readonly url?: string
}

type BrowserStatusSnapshot = {
  readonly activeTabId: number | null
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly connectionStatus: string
  readonly extensionStatus: string
  readonly tabCount: number
  readonly windowId: number | null
}

type StreamStatusSnapshot = {
  readonly reason:
    | 'browser_disconnected'
    | 'new_tab'
    | 'stream_not_present'
    | 'streaming'
    | 'unsupported'
  readonly streaming: boolean
}

type BrowserTabSnapshot = {
  readonly active: boolean
  readonly id: number
  readonly index: number
  readonly title?: string
  readonly url?: string
}

export function useBrowserViewPublisher({
  enabled,
  streamEnabled,
  url,
}: BrowserViewPublisherOptions): BrowserViewPublisherStatus {
  const [status, setStatus] = useState<BrowserViewPublisherStatus>('idle')
  const socketRef = useRef<WebSocket | null>(null)
  const activeTabRef = useRef<ActiveBrowserTabSnapshot>({
    windowId: null,
    tabId: null,
  })
  const browserStatusRef = useRef<BrowserStatusSnapshot>({
    activeTabId: null,
    canGoBack: false,
    canGoForward: false,
    connectionStatus: 'idle',
    extensionStatus: 'idle',
    tabCount: 0,
    windowId: null,
  })
  const streamStatusRef = useRef<StreamStatusSnapshot>({
    reason: 'stream_not_present',
    streaming: false,
  })
  const tabsRef = useRef<readonly BrowserTabSnapshot[]>([])
  const lastFrameSentAtRef = useRef(0)

  const windowId = useBrowserStore((state) => state.windowId)
  const activeTabId = useBrowserStore((state) => state.activeTabId)
  const tabs = useBrowserStore((state) => state.tabs)
  const extensionStatus = useBrowserStore((state) => state.extensionStatus)
  const connectionStatus = useBrowserStore((state) => state.connectionStatus)
  const navigation = useBrowserStore((state) => state.navigation)
  const activeTab = useMemo((): ActiveBrowserTabSnapshot => {
    const tab = activeTabId === null
      ? undefined
      : tabs.find((candidate) => candidate.id === activeTabId)
    return {
      windowId,
      tabId: activeTabId,
      title: tab?.title,
      url: tab?.url,
    }
  }, [activeTabId, tabs, windowId])
  const browserStatus = useMemo(
    (): BrowserStatusSnapshot => ({
      activeTabId,
      canGoBack: navigation.tabId === activeTabId && navigation.canGoBack,
      canGoForward: navigation.tabId === activeTabId && navigation.canGoForward,
      connectionStatus,
      extensionStatus,
      tabCount: tabs.length,
      windowId,
    }),
    [
      activeTabId,
      connectionStatus,
      extensionStatus,
      navigation.canGoBack,
      navigation.canGoForward,
      navigation.tabId,
      tabs.length,
      windowId,
    ],
  )
  const streamStatus = useMemo(
    (): StreamStatusSnapshot =>
      resolveStreamStatus({
        browserConnected:
          extensionStatus === 'available' && connectionStatus === 'connected',
        streamEnabled,
        url: activeTab.url,
      }),
    [activeTab.url, connectionStatus, extensionStatus, streamEnabled],
  )
  const tabSnapshots = useMemo(
    () => tabs.map(toBrowserTabSnapshot),
    [tabs],
  )

  useEffect(() => {
    activeTabRef.current = activeTab
    sendActiveTabSnapshot(socketRef.current, activeTab)
  }, [activeTab])

  useEffect(() => {
    browserStatusRef.current = browserStatus
    sendBrowserStatusSnapshot(socketRef.current, browserStatus)
  }, [browserStatus])

  useEffect(() => {
    tabsRef.current = tabSnapshots
    sendTabsSnapshot(socketRef.current, tabSnapshots)
  }, [tabSnapshots])

  useEffect(() => {
    streamStatusRef.current = streamStatus
    sendStreamStatusSnapshot(socketRef.current, streamStatus)

    if (!streamStatus.streaming) return
    const tabId = activeTabRef.current.tabId
    const socket = socketRef.current
    const lastFrame = tabId === null ? null : getLastBrowserFrame(tabId)
    if (socket !== null && socket.readyState === WebSocket.OPEN && lastFrame !== null) {
      void sendBrowserFrame(socket, lastFrame, activeTabRef.current, {
        force: true,
      })
    }
  }, [streamStatus])

  useEffect(() => {
    if (!enabled || url === undefined) {
      setStatus('idle')
      return
    }

    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch {
      setStatus('error')
      return
    }

    socketRef.current = socket
    socket.binaryType = 'arraybuffer'
    setStatus('connecting')

    socket.addEventListener('open', () => {
      if (socketRef.current !== socket) return
      setStatus('connected')
      sendPublisherJson(socket, {
        type: 'hello',
        role: 'publisher',
        protocolVersion: BROWSER_VIEW_PROTOCOL_VERSION,
      })
      sendBrowserStatusSnapshot(socket, browserStatusRef.current)
      sendStreamStatusSnapshot(socket, streamStatusRef.current)
      sendActiveTabSnapshot(socket, activeTabRef.current)
      sendTabsSnapshot(socket, tabsRef.current)
      const tabId = activeTabRef.current.tabId
      const lastFrame = tabId === null ? null : getLastBrowserFrame(tabId)
      if (streamStatusRef.current.streaming && lastFrame !== null) {
        void sendBrowserFrame(socket, lastFrame, activeTabRef.current, {
          force: true,
        })
      }
    })

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      void handleBrowserCommandMessage(socket, event.data)
    })

    socket.addEventListener('close', () => {
      if (socketRef.current === socket) {
        socketRef.current = null
        setStatus('disconnected')
      }
    })

    socket.addEventListener('error', () => {
      if (socketRef.current === socket) {
        setStatus('error')
      }
    })

    return () => {
      if (socketRef.current === socket) {
        socketRef.current = null
      }
      setStatus('idle')
      socket.close(1000, 'Browser view publisher stopped')
    }
  }, [enabled, url])

  useEffect(() => {
    if (!enabled || !streamStatus.streaming || activeTab.tabId === null) return

    const unsubscribe = subscribeBrowserFrames(activeTab.tabId, (frame) => {
      const socket = socketRef.current
      if (socket === null || socket.readyState !== WebSocket.OPEN) return

      const now = Date.now()
      if (now - lastFrameSentAtRef.current < MIN_FRAME_INTERVAL_MS) return
      lastFrameSentAtRef.current = now

      void sendBrowserFrame(socket, frame, activeTabRef.current)
    })

    const socket = socketRef.current
    const lastFrame = getLastBrowserFrame(activeTab.tabId)
    if (socket !== null && socket.readyState === WebSocket.OPEN && lastFrame !== null) {
      void sendBrowserFrame(socket, lastFrame, activeTabRef.current, {
        force: true,
      })
    }

    return unsubscribe
  }, [activeTab.tabId, enabled, streamStatus.streaming])

  return status
}

function sendBrowserStatusSnapshot(
  socket: WebSocket | null,
  snapshot: BrowserStatusSnapshot,
): void {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return
  sendPublisherJson(socket, {
    type: 'browser.status',
    activeTabId: snapshot.activeTabId,
    canGoBack: snapshot.canGoBack,
    canGoForward: snapshot.canGoForward,
    connected:
      snapshot.extensionStatus === 'available' &&
      snapshot.connectionStatus === 'connected',
    connectionStatus: snapshot.connectionStatus,
    extensionStatus: snapshot.extensionStatus,
    tabCount: snapshot.tabCount,
    timestamp: new Date().toISOString(),
    windowId: snapshot.windowId,
    windowReady: snapshot.windowId !== null,
  })
}

function sendStreamStatusSnapshot(
  socket: WebSocket | null,
  snapshot: StreamStatusSnapshot,
): void {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return
  sendPublisherJson(socket, {
    type: 'stream.status',
    reason: snapshot.reason,
    streaming: snapshot.streaming,
    timestamp: new Date().toISOString(),
  })
}

function resolveStreamStatus(input: {
  readonly browserConnected: boolean
  readonly streamEnabled: boolean
  readonly url?: string
}): StreamStatusSnapshot {
  if (!input.browserConnected) {
    return { reason: 'browser_disconnected', streaming: false }
  }
  if (!input.streamEnabled) {
    return { reason: 'stream_not_present', streaming: false }
  }

  const mode = getBrowserScreencastMode(input.url)
  if (mode === 'new_tab') return { reason: 'new_tab', streaming: false }
  if (mode === 'unsupported') return { reason: 'unsupported', streaming: false }
  return { reason: 'streaming', streaming: true }
}

function sendActiveTabSnapshot(
  socket: WebSocket | null,
  snapshot: ActiveBrowserTabSnapshot,
): void {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return
  sendPublisherJson(socket, {
    type: 'activeTab',
    windowId: snapshot.windowId,
    tabId: snapshot.tabId,
    title: snapshot.title,
    url: snapshot.url,
    timestamp: new Date().toISOString(),
  })
}

function sendTabsSnapshot(
  socket: WebSocket | null,
  tabs: readonly BrowserTabSnapshot[],
): void {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return
  sendPublisherJson(socket, {
    type: 'tabs',
    tabs,
    timestamp: new Date().toISOString(),
  })
}

function toBrowserTabSnapshot(tab: BrowserWindowTab): BrowserTabSnapshot {
  return {
    active: tab.active === true,
    id: tab.id,
    index: tab.index,
    title: tab.title,
    url: tab.url,
  }
}

async function sendBrowserFrame(
  socket: WebSocket,
  frame: BrowserFrame,
  activeTab: ActiveBrowserTabSnapshot,
  options: { readonly force?: boolean } = {},
): Promise<void> {
  if (socket.readyState !== WebSocket.OPEN) return
  if (!options.force && socket.bufferedAmount > MAX_PUBLISHER_BUFFERED_BYTES) {
    return
  }

  const parsed = parseDataUrl(frame.dataUrl)
  if (parsed === null) return
  if (socket.readyState !== WebSocket.OPEN) return

  sendPublisherJson(socket, {
    type: 'frame',
    sequence: frame.sequence,
    tabId: frame.tabId,
    activeTabId: activeTab.tabId,
    windowId: activeTab.windowId,
    title: activeTab.title,
    url: activeTab.url,
    aspectRatio: frame.aspectRatio,
    mimeType: parsed.mimeType,
    byteLength: parsed.bytes.byteLength,
    receivedAt: frame.receivedAt,
    sentAt: Date.now(),
  })

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(parsed.bytes)
  }
}

async function handleBrowserCommandMessage(
  socket: WebSocket,
  rawMessage: string,
): Promise<void> {
  const message = parseJsonRecord(rawMessage)
  if (message?.type !== 'browser.command') return

  const requestId =
    typeof message.requestId === 'string' ? message.requestId : undefined
  logBrowserViewPublisherDebug('command-message', {
    requestId,
    ...summarizeBrowserCommandMessage(message),
  })

  try {
    await runBrowserCommand(message)
    logBrowserViewPublisherDebug('command-result', {
      requestId,
      ok: true,
      ...summarizeBrowserCommandMessage(message),
    })
    sendPublisherJson(socket, {
      type: 'browser.command.result',
      requestId,
      ok: true,
    })
  } catch (error) {
    logBrowserViewPublisherDebug('command-result', {
      requestId,
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to run browser command.',
      ...summarizeBrowserCommandMessage(message),
    })
    sendPublisherJson(socket, {
      type: 'browser.command.result',
      requestId,
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to run browser command.',
    })
  }
}

async function runBrowserCommand(
  message: Record<string, unknown>,
): Promise<void> {
  const bridge = getActiveBrowserExtensionBridge()
  if (bridge === null) throw new Error('Browser extension is not available.')

  const controller = new AbortController()
  const state = useBrowserStore.getState()
  const command = typeof message.command === 'string' ? message.command : ''

  if (command === 'newTab') {
    const windowId =
      state.windowId ?? (await state.ensureBrowserWindow({ bounds: undefined }))
    if (windowId === null) throw new Error('Browser window is not available.')
    const tab = await createBrowserTab({
      bridge,
      windowId,
      signal: controller.signal,
    })
    if (tab !== null) {
      useBrowserStore.getState().upsertCreatedTab({ ...tab, active: true })
      return
    }
    await refreshBrowserTabs(bridge)
    return
  }

  if (command === 'activateTab') {
    const targetTabId = readFiniteNumber(message.tabId)
    if (targetTabId === null) throw new Error('Tab id is required.')
    if (!state.tabs.some((tab) => tab.id === targetTabId)) {
      throw new Error('Browser tab is not available.')
    }

    useBrowserStore.getState().optimisticallyActivateTab(targetTabId)
    const tabs = await activateBrowserTab({
      bridge,
      tabId: targetTabId,
      signal: controller.signal,
    })
    if (tabs !== null) {
      useBrowserStore.getState().setTabs(tabs)
      return
    }
    await refreshBrowserTabs(bridge)
    return
  }

  if (command === 'closeTab') {
    const targetTabId = readFiniteNumber(message.tabId)
    if (targetTabId === null) throw new Error('Tab id is required.')
    if (!state.tabs.some((tab) => tab.id === targetTabId)) {
      throw new Error('Browser tab is not available.')
    }

    useBrowserStore.getState().optimisticallyCloseTab(targetTabId)
    const tabs = await closeBrowserTab({
      bridge,
      tabId: targetTabId,
      signal: controller.signal,
    })
    if (tabs !== null) {
      useBrowserStore.getState().setTabs(tabs)
      return
    }
    await refreshBrowserTabs(bridge)
    return
  }

  const tabId = state.activeTabId
  if (tabId === null) throw new Error('Browser tab is not available.')

  if (command === 'back') {
    await goBackInBrowserTab({ bridge, tabId, signal: controller.signal })
    await refreshBrowserTabs(bridge)
    return
  }

  if (command === 'forward') {
    await goForwardInBrowserTab({ bridge, tabId, signal: controller.signal })
    await refreshBrowserTabs(bridge)
    return
  }

  if (command === 'reload') {
    await refreshBrowserTab({ bridge, tabId, signal: controller.signal })
    await refreshBrowserTabs(bridge)
    return
  }

  if (command === 'navigate') {
    const url = typeof message.url === 'string' ? message.url.trim() : ''
    if (url.length === 0) throw new Error('URL is required.')
    await navigateBrowserTab({
      bridge,
      tabId,
      url: normalizeBrowserUrl(url),
      signal: controller.signal,
    })
    await refreshBrowserTabs(bridge)
    return
  }

  if (command === 'viewport.click') {
    const ratio = readBrowserViewInputPoint(message.ratio)
    const fallbackPoint = readBrowserViewInputPoint(message.fallbackPoint)
    if (ratio === null || fallbackPoint === null) {
      throw new Error('Viewport click coordinates are required.')
    }

    await clickBrowserViewport({
      bridge,
      click: { tabId, ratio, fallbackPoint },
      signal: controller.signal,
    })
    return
  }

  if (command === 'viewport.wheel') {
    const ratio = readBrowserViewInputPoint(message.ratio)
    const fallbackPoint = readBrowserViewInputPoint(message.fallbackPoint)
    const deltaX = readFiniteNumber(message.deltaX)
    const deltaY = readFiniteNumber(message.deltaY)
    if (
      ratio === null ||
      fallbackPoint === null ||
      deltaX === null ||
      deltaY === null
    ) {
      throw new Error('Viewport wheel input is invalid.')
    }

    await wheelBrowserViewport({
      bridge,
      wheel: { tabId, ratio, fallbackPoint, deltaX, deltaY },
      signal: controller.signal,
    })
    return
  }

  if (command === 'viewport.key') {
    const key = readBrowserViewKeyboardInput(message.key, tabId)
    if (key === null) throw new Error('Viewport key input is invalid.')

    await typeBrowserViewport({
      bridge,
      key,
      signal: controller.signal,
    })
    return
  }

  if (command === 'viewport.insertText') {
    const text = typeof message.text === 'string' ? message.text : ''
    if (text.length === 0) throw new Error('Viewport text input is required.')

    await insertBrowserViewportText({
      bridge,
      tabId,
      text,
      signal: controller.signal,
    })
    return
  }

  throw new Error('Unsupported browser command.')
}

function readBrowserViewInputPoint(
  value: unknown,
): BrowserViewportInputPoint | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const x = readFiniteNumber(record.x)
  const y = readFiniteNumber(record.y)
  return x === null || y === null ? null : { x, y }
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readBrowserViewKeyboardInput(
  value: unknown,
  tabId: number,
): BrowserViewportKeyboardInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const type =
    record.type === 'keyDown'
      ? 'keyDown'
      : record.type === 'keyUp'
        ? 'keyUp'
        : null
  const key = typeof record.key === 'string' ? record.key : null
  const code = typeof record.code === 'string' ? record.code : null
  const keyCode = readFiniteNumber(record.keyCode)
  const location = readFiniteNumber(record.location)
  if (
    type === null ||
    key === null ||
    code === null ||
    keyCode === null ||
    location === null
  ) {
    return null
  }

  return {
    altKey: record.altKey === true,
    code,
    ctrlKey: record.ctrlKey === true,
    key,
    keyCode,
    location,
    metaKey: record.metaKey === true,
    repeat: record.repeat === true,
    shiftKey: record.shiftKey === true,
    tabId,
    text: typeof record.text === 'string' ? record.text : undefined,
    type,
  }
}

function sendPublisherJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(payload))
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function logBrowserViewPublisherDebug(
  event: string,
  details: Record<string, unknown>,
): void {
  if (!BROWSER_VIEW_DEBUG) return
  if (!shouldLogBrowserCommandDetails(details)) return
  // eslint-disable-next-line no-console
  console.info('[browser-view][web]', event, details)
}

function shouldLogBrowserCommandDetails(details: Record<string, unknown>): boolean {
  const command = details.command
  return command === 'viewport.insertText' || command === 'viewport.key'
}

function summarizeBrowserCommandMessage(
  message: Record<string, unknown>,
): Record<string, unknown> {
  const command = typeof message.command === 'string' ? message.command : undefined
  if (command === 'viewport.insertText') {
    return {
      command,
      textLength: typeof message.text === 'string' ? message.text.length : undefined,
    }
  }

  if (command === 'viewport.key') {
    const key = readRecord(message.key)
    const keyName = typeof key?.key === 'string' ? key.key : undefined
    return {
      command,
      keyName: keyName !== undefined && keyName.length > 1 ? keyName : undefined,
      keyType: typeof key?.type === 'string' ? key.type : undefined,
      printable: keyName?.length === 1,
    }
  }

  return { command }
}

function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) return trimmed
  if (/^[a-z]+:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('about:') || trimmed.startsWith('chrome://')) {
    return trimmed
  }
  if (/^[^\s]+\.[^\s]+$/.test(trimmed)) return `https://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

function parseDataUrl(
  dataUrl: string,
): { readonly mimeType: string; readonly bytes: ArrayBuffer } | null {
  const match = /^data:([^;,]+);base64,(.*)$/u.exec(dataUrl)
  if (match === null) return null

  const mimeType = match[1] ?? 'application/octet-stream'
  const payload = match[2] ?? ''
  const binary = window.atob(payload)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return { mimeType, bytes: bytes.buffer }
}
