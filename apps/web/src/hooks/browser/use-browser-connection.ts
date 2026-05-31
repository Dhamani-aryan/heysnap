import { useEffect, useMemo } from 'react'
import { BrowserExtensionBridge } from '../../lib/browser/browser-extension-bridge.ts'
import { BrowserControlManager } from '../../lib/browser/browser-control-manager.ts'
import { DEFAULT_BROWSER_WINDOW_URL } from '../../lib/browser/parsers.ts'
import {
  getBrowserFrameStats,
  getLastBrowserFrame,
  publishBrowserFrame,
  recordBrowserScreencastRestart,
} from '../../lib/browser/browser-frame-bus.ts'
import {
  BROWSER_SCREENCAST_PORT_NAME,
  disconnectBrowserScreencastPort,
  getBrowserScreencastMode,
  parseBrowserScreencastMessage,
} from '../../lib/browser/browser-screencast-messages.ts'
import { buildBrowserScreencastProfile } from '../../lib/browser/browser-screencast-profile.ts'
import type {
  BrowserScreencastConnectionState,
  BrowserScreencastStats,
} from '../../lib/browser/browser-screencast-types.ts'
import {
  BROWSER_SCREENCAST_WATCHDOG_INTERVAL_MS,
  getBrowserScreencastRestartDelay,
  shouldRestartBrowserScreencast,
} from '../../lib/browser/browser-screencast-watchdog.ts'
import { readBrowserNavigationState } from '../../lib/browser/browser-actions.ts'
import {
  connectExtensionPort,
  type ChromeRuntimePort,
} from '../../lib/browser/extension-messaging.ts'
import {
  getActiveBrowserExtensionBridge,
  initialBrowserScreencastStats,
  setActiveBrowserControlManager,
  setActiveBrowserExtensionBridge,
  useBrowserStore,
} from '../../stores/browser/browser-store.ts'
import { env } from '../../lib/env.ts'

const WINDOW_PROBE_INTERVAL_MS = 1500

export function useBrowserConnection(options: {
  controlWebSocketUrl?: string
}): void {
  const { controlWebSocketUrl } = options
  const extensionStatus = useBrowserStore((s) => s.extensionStatus)
  const windowId = useBrowserStore((s) => s.windowId)
  const isWindowHydrated = useBrowserStore((s) => s.isWindowHydrated)
  const activeTabId = useBrowserStore((s) => s.activeTabId)
  const activeTabUrl = useBrowserStore((s) => {
    const id = s.activeTabId
    if (id === null) return undefined
    return s.tabs.find((tab) => tab.id === id)?.url
  })
  const screencastMode = getBrowserScreencastMode(activeTabUrl)
  const captureViewport = useBrowserStore((s) => s.captureViewport)
  const screencastProfile = useMemo(
    () => buildBrowserScreencastProfile(captureViewport),
    [captureViewport],
  )

  useEffect(() => {
    const bridge = new BrowserExtensionBridge({
      extensionId: env.chromeExtensionId,
      callbacks: {
        onStatusChange: (status) => {
          useBrowserStore.getState().setExtensionStatus(status)
        },
        onTabEvent: (event) => {
          useBrowserStore.getState().applyTabEvent(event)
        },
        onTabEventsReconnect: () => {
          void refreshBrowserWindowSnapshot(bridge)
        },
      },
    })

    setActiveBrowserExtensionBridge(bridge)
    useBrowserStore.getState().hydrateWindowFromStorage()
    bridge.start()

    return () => {
      bridge.stop()
      setActiveBrowserExtensionBridge(null)
      useBrowserStore.getState().reset()
    }
  }, [])

  useEffect(() => {
    if (extensionStatus !== 'available') return
    if (!isWindowHydrated) return
    if (windowId === null) return

    const bridge = getActiveBrowserExtensionBridge()
    if (bridge === null) return

    const controller = new AbortController()
    void (async () => {
      try {
        const snapshot = await bridge.getBrowserWindow(
          windowId,
          { populate: true },
          controller.signal,
        )
        const firstTab =
          snapshot.tabs.find((tab) => tab.active === true) ?? snapshot.tabs[0]
        if (firstTab === undefined) {
          throw new Error('Chrome did not return a tab for the stored window.')
        }
        await bridge.rememberManagedWindow(
          {
            windowId: snapshot.id,
            tabId: firstTab.id,
            url: firstTab.url || DEFAULT_BROWSER_WINDOW_URL,
          },
          controller.signal,
        )
        if (controller.signal.aborted) return
        useBrowserStore.getState().setWindow(snapshot)
      } catch {
        if (controller.signal.aborted) return
        useBrowserStore.getState().clearWindow()
      }
    })()

    return () => {
      controller.abort()
    }
  }, [extensionStatus, isWindowHydrated, windowId])

  useEffect(() => {
    if (extensionStatus !== 'available') return
    if (windowId === null) return

    let isCancelled = false
    let isProbing = false

    const probe = async (): Promise<void> => {
      if (isProbing) return
      const bridge = getActiveBrowserExtensionBridge()
      if (bridge === null) return
      isProbing = true
      const controller = new AbortController()
      try {
        const snapshot = await bridge.getBrowserWindow(
          windowId,
          { populate: true },
          controller.signal,
        )
        if (isCancelled) return
        useBrowserStore.getState().setTabs(snapshot.tabs)
      } catch {
        if (!isCancelled) {
          useBrowserStore.getState().clearWindow()
        }
      } finally {
        isProbing = false
      }
    }

    const intervalId = setInterval(() => {
      void probe()
    }, WINDOW_PROBE_INTERVAL_MS)

    return () => {
      isCancelled = true
      clearInterval(intervalId)
    }
  }, [extensionStatus, windowId])

  useEffect(() => {
    if (extensionStatus !== 'available') return
    if (controlWebSocketUrl === undefined) return

    const bridge = getActiveBrowserExtensionBridge()
    if (bridge === null) return

    const manager = new BrowserControlManager({
      url: controlWebSocketUrl,
      bridge,
      callbacks: {
        onStatusChange: (status) => {
          useBrowserStore.getState().setConnectionStatus(status)
        },
        getWindowId: () => useBrowserStore.getState().windowId,
        ensureWindow: () => useBrowserStore.getState().ensureBrowserWindow(),
      },
    })

    setActiveBrowserControlManager(manager)
    manager.start()

    return () => {
      manager.stop()
      setActiveBrowserControlManager(null)
      useBrowserStore.getState().setConnectionStatus('idle')
    }
  }, [extensionStatus, controlWebSocketUrl])

  useEffect(() => {
    if (extensionStatus !== 'available' || windowId === null) {
      useBrowserStore.getState().setScreencast({
        aspectRatio: null,
        lastFrameAt: null,
        stats: initialBrowserScreencastStats,
        state: 'idle',
        tabId: activeTabId,
      })
      return
    }

    if (activeTabId === null) {
      useBrowserStore.getState().setScreencast({
        aspectRatio: null,
        lastFrameAt: null,
        stats: initialBrowserScreencastStats,
        state: 'idle',
        tabId: null,
      })
      return
    }

    if (screencastMode === 'new_tab') {
      useBrowserStore.getState().setScreencast({
        aspectRatio: null,
        lastFrameAt: null,
        stats: toBrowserScreencastStats(activeTabId),
        state: 'new_tab',
        tabId: activeTabId,
      })
      return
    }

    if (screencastMode !== 'streamable') {
      useBrowserStore.getState().setScreencast({
        aspectRatio: null,
        lastFrameAt: null,
        stats: toBrowserScreencastStats(activeTabId),
        state: 'idle',
        tabId: activeTabId,
      })
      return
    }

    const tabId = activeTabId
    const currentWindowId = windowId
    const startState = useBrowserStore.getState()
    const tabUrl =
      startState.tabs.find((tab) => tab.id === tabId)?.url ||
      DEFAULT_BROWSER_WINDOW_URL
    const lastFrame = getLastBrowserFrame(tabId)
    const transitionAspectRatio =
      lastFrame?.aspectRatio ?? startState.screencast.aspectRatio
    const transitionLastFrameAt =
      lastFrame?.receivedAt ?? startState.screencast.lastFrameAt

    useBrowserStore.getState().setScreencast({
      aspectRatio: transitionAspectRatio,
      lastFrameAt: transitionLastFrameAt,
      stats: toBrowserScreencastStats(tabId),
      state: 'connecting',
      tabId,
    })

    let isCancelled = false
    let activePort: ChromeRuntimePort | null = null
    let activeAbortController: AbortController | null = null
    let watchdogIntervalId: number | null = null
    let restartTimeoutId: number | null = null
    let restartAttempt = 0
    let isRestartScheduled = false
    let lastSignalAt: number | null = Date.now()
    let streamState: BrowserScreencastConnectionState = 'connecting'
    let currentAspectRatio = transitionAspectRatio
    let lastMetadataUpdateAt = 0

    const setStreamState = (
      state: BrowserScreencastConnectionState,
      options?: { readonly force?: boolean; readonly lastFrameAt?: number | null },
    ): void => {
      const store = useBrowserStore.getState()
      const current = store.screencast
      if (current.tabId !== tabId && current.tabId !== null) return
      const now = Date.now()
      const shouldUpdate =
        options?.force === true ||
        current.state !== state ||
        current.aspectRatio !== currentAspectRatio ||
        now - lastMetadataUpdateAt >= 1000
      if (!shouldUpdate) return
      lastMetadataUpdateAt = now
      store.setScreencast({
        aspectRatio: currentAspectRatio,
        lastFrameAt: options?.lastFrameAt ?? current.lastFrameAt,
        stats: toBrowserScreencastStats(tabId),
        state,
        tabId,
      })
    }

    const disconnectActivePort = (): void => {
      const port = activePort
      activePort = null
      if (port !== null) disconnectBrowserScreencastPort(port)
    }

    const clearRestartTimeout = (): void => {
      if (restartTimeoutId === null) return
      window.clearTimeout(restartTimeoutId)
      restartTimeoutId = null
    }

    const scheduleRestart = (): void => {
      if (isCancelled || isRestartScheduled) return
      isRestartScheduled = true
      disconnectActivePort()
      activeAbortController?.abort()
      activeAbortController = null
      recordBrowserScreencastRestart(tabId)
      streamState = 'connecting'
      setStreamState('connecting', { force: true })

      const delay = getBrowserScreencastRestartDelay(restartAttempt)
      restartAttempt += 1
      clearRestartTimeout()
      restartTimeoutId = window.setTimeout(() => {
        restartTimeoutId = null
        isRestartScheduled = false
        lastSignalAt = Date.now()
        void openPort()
      }, delay)
    }

    const openPort = async (): Promise<void> => {
      if (isCancelled) return
      disconnectActivePort()
      activeAbortController?.abort()
      const abortController = new AbortController()
      activeAbortController = abortController
      lastSignalAt = Date.now()
      streamState = 'connecting'

      let port: ChromeRuntimePort
      try {
        port = connectExtensionPort(
          env.chromeExtensionId,
          BROWSER_SCREENCAST_PORT_NAME,
        )
        activePort = port
      } catch {
        useBrowserStore.getState().setScreencast({
          aspectRatio: null,
          lastFrameAt: null,
          stats: toBrowserScreencastStats(tabId),
          state: 'error',
          tabId,
        })
        return
      }

      port.onMessage.addListener((message) => {
        if (isCancelled || port !== activePort) return
        const event = parseBrowserScreencastMessage(message)
        if (event === null) return

        if (event.type === 'started') {
          lastSignalAt = Date.now()
          streamState = 'connecting'
          setStreamState('connecting', { force: true })
          return
        }

        if (event.type === 'frame') {
          if (event.tabId !== tabId) return
          const frame = publishBrowserFrame({
            aspectRatio: event.aspectRatio,
            dataUrl: event.dataUrl,
            tabId,
          })
          lastSignalAt = frame.receivedAt
          restartAttempt = 0
          currentAspectRatio = frame.aspectRatio ?? currentAspectRatio
          streamState = 'streaming'
          setStreamState('streaming', {
            force: useBrowserStore.getState().screencast.state !== 'streaming',
            lastFrameAt: frame.receivedAt,
          })
          return
        }

        if (event.type === 'stopped') {
          lastSignalAt = Date.now()
          streamState = 'stopped'
          setStreamState('stopped', { force: true })
          return
        }

        streamState = 'error'
        useBrowserStore.getState().setScreencast({
          aspectRatio: null,
          lastFrameAt: null,
          stats: toBrowserScreencastStats(tabId),
          state: 'error',
          tabId,
        })
      })

      port.onDisconnect.addListener(() => {
        if (isCancelled || port !== activePort) return
        activePort = null
        scheduleRestart()
      })

      try {
        const bridge = getActiveBrowserExtensionBridge()
        if (bridge === null) throw new Error('Browser extension bridge is not active.')
        await bridge.rememberManagedWindow(
          { windowId: currentWindowId, tabId, url: tabUrl },
          abortController.signal,
        )
        if (
          isCancelled ||
          abortController.signal.aborted ||
          port !== activePort
        ) {
          return
        }
        port.postMessage({
          type: 'start',
          windowId: currentWindowId,
          ...screencastProfile,
        })
      } catch {
        if (isCancelled || port !== activePort) return
        streamState = 'error'
        useBrowserStore.getState().setScreencast({
          aspectRatio: null,
          lastFrameAt: null,
          stats: toBrowserScreencastStats(tabId),
          state: 'error',
          tabId,
        })
      }
    }

    watchdogIntervalId = window.setInterval(() => {
      if (
        isRestartScheduled ||
        !shouldRestartBrowserScreencast({
          lastSignalAt,
          now: Date.now(),
          state: streamState,
        })
      ) {
        return
      }
      scheduleRestart()
    }, BROWSER_SCREENCAST_WATCHDOG_INTERVAL_MS)

    void openPort()

    return () => {
      isCancelled = true
      clearRestartTimeout()
      if (watchdogIntervalId !== null) window.clearInterval(watchdogIntervalId)
      activeAbortController?.abort()
      disconnectActivePort()
    }
  }, [
    extensionStatus,
    windowId,
    activeTabId,
    screencastMode,
    screencastProfile.everyNthFrame,
    screencastProfile.format,
    screencastProfile.maxHeight,
    screencastProfile.maxWidth,
    screencastProfile.quality,
  ])

  useEffect(() => {
    if (extensionStatus !== 'available' || activeTabId === null) {
      useBrowserStore.getState().setNavigation({
        tabId: activeTabId,
        canGoBack: false,
        canGoForward: false,
      })
      return
    }

    if (screencastMode !== 'streamable') {
      useBrowserStore.getState().setNavigation({
        tabId: activeTabId,
        canGoBack: false,
        canGoForward: false,
      })
      return
    }

    const bridge = getActiveBrowserExtensionBridge()
    if (bridge === null) return

    const controller = new AbortController()
    const tabId = activeTabId

    void (async () => {
      const state = await readBrowserNavigationState({
        bridge,
        tabId,
        signal: controller.signal,
      })
      if (controller.signal.aborted || state === null) return
      useBrowserStore.getState().setNavigation({ tabId, ...state })
    })()

    return () => {
      controller.abort()
    }
  }, [extensionStatus, activeTabId, activeTabUrl, screencastMode])
}

async function refreshBrowserWindowSnapshot(
  bridge: BrowserExtensionBridge,
): Promise<void> {
  const windowId = useBrowserStore.getState().windowId
  if (windowId === null) return

  const controller = new AbortController()
  try {
    const snapshot = await bridge.getBrowserWindow(
      windowId,
      { populate: true },
      controller.signal,
    )
    useBrowserStore.getState().setWindow(snapshot)
  } catch {
    if (!controller.signal.aborted) {
      useBrowserStore.getState().clearWindow()
    }
  }
}

function toBrowserScreencastStats(tabId: number): BrowserScreencastStats {
  const stats = getBrowserFrameStats(tabId)
  return {
    droppedFrames: stats.droppedFrames,
    lastFrameEstimatedBytes: stats.lastFrameEstimatedBytes,
    lastPaintedAt: stats.lastPaintedAt,
    paintedFrames: stats.paintedFrames,
    receivedFrames: stats.receivedFrames,
    restartCount: stats.restartCount,
    skippedFrames: stats.skippedFrames,
  }
}
