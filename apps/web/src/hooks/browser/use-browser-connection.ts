import { useEffect } from 'react'
import { BrowserExtensionBridge } from '../../lib/browser/browser-extension-bridge.ts'
import { BrowserControlManager } from '../../lib/browser/browser-control-manager.ts'
import { DEFAULT_BROWSER_WINDOW_URL } from '../../lib/browser/parsers.ts'
import {
  BROWSER_SCREENCAST_PORT_NAME,
  disconnectBrowserScreencastPort,
  getBrowserScreencastMode,
  parseBrowserScreencastMessage,
} from '../../lib/browser/browser-screencast-messages.ts'
import { readBrowserNavigationState } from '../../lib/browser/browser-actions.ts'
import {
  connectExtensionPort,
  type ChromeRuntimePort,
} from '../../lib/browser/extension-messaging.ts'
import {
  getActiveBrowserExtensionBridge,
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
        frameUrl: null,
        state: 'idle',
        tabId: activeTabId,
      })
      return
    }

    if (activeTabId === null) {
      useBrowserStore.getState().setScreencast({
        aspectRatio: null,
        frameUrl: null,
        state: 'idle',
        tabId: null,
      })
      return
    }

    if (screencastMode === 'new_tab') {
      useBrowserStore.getState().setScreencast({
        aspectRatio: null,
        frameUrl: null,
        state: 'new_tab',
        tabId: activeTabId,
      })
      return
    }

    if (screencastMode !== 'streamable') {
      useBrowserStore.getState().setScreencast({
        aspectRatio: null,
        frameUrl: null,
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
    const transitionFrameUrl = startState.screencast.frameUrl
    const transitionAspectRatio = startState.screencast.aspectRatio

    useBrowserStore.getState().setScreencast({
      aspectRatio: transitionAspectRatio,
      frameUrl: transitionFrameUrl,
      state: 'connecting',
      tabId,
    })

    let isCancelled = false
    const abortController = new AbortController()
    let port: ChromeRuntimePort

    try {
      port = connectExtensionPort(
        env.chromeExtensionId,
        BROWSER_SCREENCAST_PORT_NAME,
      )
    } catch {
      useBrowserStore.getState().setScreencast({
        aspectRatio: null,
        frameUrl: null,
        state: 'error',
        tabId,
      })
      return
    }

    port.onMessage.addListener((message) => {
      if (isCancelled) return
      const event = parseBrowserScreencastMessage(message)
      if (event === null) return

      const store = useBrowserStore.getState()
      if (event.type === 'started') {
        const current = store.screencast
        store.setScreencast({
          aspectRatio: current.tabId === tabId ? current.aspectRatio : null,
          frameUrl: current.tabId === tabId ? current.frameUrl : null,
          state: 'connecting',
          tabId,
        })
        return
      }
      if (event.type === 'frame') {
        if (event.tabId !== tabId) return
        store.setScreencast({
          aspectRatio: event.aspectRatio,
          frameUrl: event.dataUrl,
          state: 'streaming',
          tabId,
        })
        return
      }
      if (event.type === 'stopped') {
        const current = store.screencast
        store.setScreencast({
          aspectRatio: current.tabId === tabId ? current.aspectRatio : null,
          frameUrl: current.tabId === tabId ? current.frameUrl : null,
          state: 'stopped',
          tabId,
        })
        return
      }
      store.setScreencast({
        aspectRatio: null,
        frameUrl: null,
        state: 'error',
        tabId,
      })
    })

    port.onDisconnect.addListener(() => {
      if (isCancelled) return
      const store = useBrowserStore.getState()
      const current = store.screencast
      if (current.tabId !== tabId) return
      store.setScreencast({
        ...current,
        state: current.state === 'streaming' ? 'stopped' : current.state,
      })
    })

    void (async () => {
      try {
        const bridge = getActiveBrowserExtensionBridge()
        if (bridge === null) {
          throw new Error('Browser extension bridge is not active.')
        }
        await bridge.rememberManagedWindow(
          { windowId: currentWindowId, tabId, url: tabUrl },
          abortController.signal,
        )
        if (isCancelled || abortController.signal.aborted) return
        port.postMessage({
          type: 'start',
          windowId: currentWindowId,
          format: 'png',
          quality: 100,
          maxWidth: 1920,
          maxHeight: 1200,
          everyNthFrame: 1,
        })
      } catch {
        if (isCancelled) return
        useBrowserStore.getState().setScreencast({
          aspectRatio: null,
          frameUrl: null,
          state: 'error',
          tabId,
        })
      }
    })()

    return () => {
      isCancelled = true
      abortController.abort()
      disconnectBrowserScreencastPort(port)
    }
  }, [extensionStatus, windowId, activeTabId, screencastMode])

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
