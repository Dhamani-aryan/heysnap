import { create } from 'zustand'
import type { BrowserExtensionBridge } from '../../lib/browser/browser-extension-bridge.ts'
import type { BrowserControlManager } from '../../lib/browser/browser-control-manager.ts'
import { DEFAULT_BROWSER_WINDOW_URL } from '../../lib/browser/parsers.ts'
import type {
  BrowserExtensionStatus,
  BrowserTabEvent,
  BrowserWindowTab,
} from '../../lib/browser/types.ts'
import type { BrowserControlConnectionStatus } from '../../lib/browser/browser-control-types.ts'
import type { BrowserScreencastState } from '../../lib/browser/browser-screencast-types.ts'

const WINDOW_ID_STORAGE_KEY = 'heysnap:browser-window-id'

let activeExtensionBridge: BrowserExtensionBridge | null = null
let activeControlManager: BrowserControlManager | null = null

export function setActiveBrowserExtensionBridge(
  bridge: BrowserExtensionBridge | null,
): void {
  activeExtensionBridge = bridge
}

export function getActiveBrowserExtensionBridge(): BrowserExtensionBridge | null {
  return activeExtensionBridge
}

export function setActiveBrowserControlManager(
  manager: BrowserControlManager | null,
): void {
  activeControlManager = manager
}

export function getActiveBrowserControlManager(): BrowserControlManager | null {
  return activeControlManager
}

export type BrowserNavigationState = {
  readonly tabId: number | null
  readonly canGoBack: boolean
  readonly canGoForward: boolean
}

type BrowserState = {
  extensionStatus: BrowserExtensionStatus
  connectionStatus: BrowserControlConnectionStatus
  windowId: number | null
  isWindowHydrated: boolean
  isOpeningWindow: boolean
  windowError: string | null
  tabs: BrowserWindowTab[]
  activeTabId: number | null
  screencast: BrowserScreencastState
  navigation: BrowserNavigationState
}

type BrowserActions = {
  setExtensionStatus: (status: BrowserExtensionStatus) => void
  setConnectionStatus: (status: BrowserControlConnectionStatus) => void
  hydrateWindowFromStorage: () => void
  setWindow: (snapshot: { id: number; tabs: BrowserWindowTab[] }) => void
  clearWindow: () => void
  setTabs: (tabs: BrowserWindowTab[]) => void
  applyTabEvent: (event: BrowserTabEvent) => void
  ensureBrowserWindow: () => Promise<number | null>
  closeBrowserWindow: () => Promise<void>
  setScreencast: (state: BrowserScreencastState) => void
  setNavigation: (state: BrowserNavigationState) => void
  reset: () => void
}

const initialScreencast: BrowserScreencastState = {
  aspectRatio: null,
  frameUrl: null,
  state: 'idle',
  tabId: null,
}

const initialNavigation: BrowserNavigationState = {
  tabId: null,
  canGoBack: false,
  canGoForward: false,
}

const initialState: BrowserState = {
  extensionStatus: 'idle',
  connectionStatus: 'idle',
  windowId: null,
  isWindowHydrated: false,
  isOpeningWindow: false,
  windowError: null,
  tabs: [],
  activeTabId: null,
  screencast: initialScreencast,
  navigation: initialNavigation,
}

function readPersistedWindowId(): number | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(WINDOW_ID_STORAGE_KEY)
  if (raw === null) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) ? parsed : null
}

function persistWindowId(windowId: number | null): void {
  if (typeof window === 'undefined') return
  if (windowId === null) {
    window.localStorage.removeItem(WINDOW_ID_STORAGE_KEY)
  } else {
    window.localStorage.setItem(WINDOW_ID_STORAGE_KEY, String(windowId))
  }
}

function deriveActiveTabId(tabs: readonly BrowserWindowTab[]): number | null {
  return tabs.find((tab) => tab.active === true)?.id ?? null
}

export const useBrowserStore = create<BrowserState & BrowserActions>(
  (set, get) => ({
    ...initialState,

    setExtensionStatus: (status) => {
      set({ extensionStatus: status })
    },

    setConnectionStatus: (status) => {
      set({ connectionStatus: status })
    },

    hydrateWindowFromStorage: () => {
      if (get().isWindowHydrated) return
      const stored = readPersistedWindowId()
      set({ windowId: stored, isWindowHydrated: true })
    },

    setWindow: ({ id, tabs }) => {
      persistWindowId(id)
      set({
        windowId: id,
        tabs,
        activeTabId: deriveActiveTabId(tabs),
        windowError: null,
      })
    },

    clearWindow: () => {
      persistWindowId(null)
      set({
        windowId: null,
        tabs: [],
        activeTabId: null,
      })
    },

    setTabs: (tabs) => {
      set({ tabs, activeTabId: deriveActiveTabId(tabs) })
    },

    applyTabEvent: (event) => {
      const { windowId } = get()
      if (event.type === 'windowRemoved') {
        if (event.windowId === windowId) {
          get().clearWindow()
        }
        return
      }
      if (event.windowId !== null && event.windowId !== windowId) return
      set({ tabs: event.tabs, activeTabId: deriveActiveTabId(event.tabs) })
    },

    ensureBrowserWindow: async () => {
      const existing = get().windowId
      if (existing !== null) return existing

      const bridge = getActiveBrowserExtensionBridge()
      if (bridge === null || bridge.getStatus() !== 'available') {
        set({ windowError: 'Browser extension is not available.' })
        return null
      }

      set({ isOpeningWindow: true, windowError: null })
      try {
        const snapshot = await bridge.createBrowserWindow()
        const firstTab =
          snapshot.tabs.find((tab) => tab.active === true) ?? snapshot.tabs[0]
        if (firstTab === undefined) {
          throw new Error('Chrome did not return a first tab.')
        }
        await bridge.rememberManagedWindow({
          windowId: snapshot.id,
          tabId: firstTab.id,
          url: firstTab.url || DEFAULT_BROWSER_WINDOW_URL,
        })
        get().setWindow(snapshot)
        return snapshot.id
      } catch (error) {
        set({
          windowError:
            error instanceof Error
              ? error.message
              : 'Failed to open browser window.',
        })
        return null
      } finally {
        set({ isOpeningWindow: false })
      }
    },

    closeBrowserWindow: async () => {
      const existing = get().windowId
      if (existing === null) return
      const bridge = getActiveBrowserExtensionBridge()
      if (bridge !== null) {
        const controller = new AbortController()
        await bridge
          .executeCommand(
            'chrome.call',
            { api: 'windows.remove', args: [existing] },
            controller.signal,
          )
          .catch(() => undefined)
      }
      get().clearWindow()
    },

    setScreencast: (state) => {
      set({ screencast: state })
    },

    setNavigation: (state) => {
      set({ navigation: state })
    },

    reset: () => {
      set({ ...initialState })
    },
  }),
)
