import { create } from 'zustand'
import type {
  BrowserExtensionBridge,
  BrowserWindowBounds,
} from '../../lib/browser/browser-extension-bridge.ts'
import type { BrowserControlManager } from '../../lib/browser/browser-control-manager.ts'
import { DEFAULT_BROWSER_WINDOW_URL } from '../../lib/browser/parsers.ts'
import type {
  BrowserExtensionStatus,
  BrowserTabEvent,
  BrowserWindowTab,
} from '../../lib/browser/types.ts'
import type { BrowserControlConnectionStatus } from '../../lib/browser/browser-control-types.ts'
import type {
  BrowserScreencastState,
  BrowserScreencastStats,
} from '../../lib/browser/browser-screencast-types.ts'
import type { BrowserCaptureViewport } from '../../lib/browser/browser-screencast-profile.ts'
import { clearBrowserFramesForTab } from '../../lib/browser/browser-frame-bus.ts'

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
  pendingActions: BrowserPendingActions
  captureViewport: BrowserCaptureViewport | null
  screencast: BrowserScreencastState
  navigation: BrowserNavigationState
}

export type BrowserPendingAction = 'activate' | 'close' | 'create'
export type BrowserPendingActions = Readonly<Record<string, true>>

type BrowserActions = {
  setExtensionStatus: (status: BrowserExtensionStatus) => void
  setConnectionStatus: (status: BrowserControlConnectionStatus) => void
  hydrateWindowFromStorage: () => void
  setWindow: (snapshot: { id: number; tabs: BrowserWindowTab[] }) => void
  clearWindow: () => void
  setTabs: (tabs: BrowserWindowTab[]) => void
  reconcileTabs: (tabs: BrowserWindowTab[]) => void
  applyTabEvent: (event: BrowserTabEvent) => void
  setPendingAction: (
    action: BrowserPendingAction,
    id: number,
    isPending: boolean,
  ) => void
  optimisticallyActivateTab: (tabId: number) => void
  optimisticallyCloseTab: (tabId: number) => void
  upsertCreatedTab: (tab: BrowserWindowTab) => void
  ensureBrowserWindow: (options?: {
    readonly bounds?: BrowserWindowBounds
  }) => Promise<number | null>
  closeBrowserWindow: () => Promise<void>
  setCaptureViewport: (viewport: BrowserCaptureViewport | null) => void
  setScreencast: (state: BrowserScreencastState) => void
  setNavigation: (state: BrowserNavigationState) => void
  reset: () => void
}

export const initialBrowserScreencastStats: BrowserScreencastStats = {
  droppedFrames: 0,
  lastFrameEstimatedBytes: 0,
  lastPaintedAt: null,
  paintedFrames: 0,
  receivedFrames: 0,
  restartCount: 0,
  skippedFrames: 0,
}

const initialScreencast: BrowserScreencastState = {
  aspectRatio: null,
  lastFrameAt: null,
  stats: initialBrowserScreencastStats,
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
  pendingActions: {},
  captureViewport: null,
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

export function getBrowserPendingActionKey(
  action: BrowserPendingAction,
  id: number,
): string {
  return `${action}:${String(id)}`
}

export function isBrowserActionPending(
  pendingActions: BrowserPendingActions,
  action: BrowserPendingAction,
  id: number,
): boolean {
  return pendingActions[getBrowserPendingActionKey(action, id)] === true
}

export function deriveBrowserActiveTabId(
  tabs: readonly BrowserWindowTab[],
): number | null {
  return tabs.find((tab) => tab.active === true)?.id ?? null
}

export function areBrowserTabsEqual(
  left: BrowserWindowTab,
  right: BrowserWindowTab,
): boolean {
  return (
    left.id === right.id &&
    left.index === right.index &&
    left.active === right.active &&
    left.favIconUrl === right.favIconUrl &&
    left.status === right.status &&
    left.title === right.title &&
    left.url === right.url
  )
}

export function reconcileBrowserTabs(
  currentTabs: readonly BrowserWindowTab[],
  incomingTabs: readonly BrowserWindowTab[],
): BrowserWindowTab[] {
  const currentById = new Map(currentTabs.map((tab) => [tab.id, tab]))
  let didChange = currentTabs.length !== incomingTabs.length

  const nextTabs = incomingTabs.map((incomingTab, index) => {
    const currentTab = currentById.get(incomingTab.id)
    if (currentTab !== undefined && areBrowserTabsEqual(currentTab, incomingTab)) {
      if (currentTabs[index] !== currentTab) didChange = true
      return currentTab
    }
    didChange = true
    return incomingTab
  })

  return didChange ? nextTabs : (currentTabs as BrowserWindowTab[])
}

function getPendingTabActionId(
  pendingActions: BrowserPendingActions,
  action: Extract<BrowserPendingAction, 'activate' | 'close'>,
): number | null {
  const prefix = `${action}:`
  for (const key of Object.keys(pendingActions)) {
    if (!key.startsWith(prefix)) continue
    const id = Number.parseInt(key.slice(prefix.length), 10)
    if (Number.isInteger(id)) return id
  }
  return null
}

function prepareIncomingTabsForPendingActions(
  incomingTabs: readonly BrowserWindowTab[],
  pendingActions: BrowserPendingActions,
): BrowserWindowTab[] {
  const closingTabIds = new Set<number>()
  for (const key of Object.keys(pendingActions)) {
    if (!key.startsWith('close:')) continue
    const id = Number.parseInt(key.slice('close:'.length), 10)
    if (Number.isInteger(id)) closingTabIds.add(id)
  }

  const activateTabId = getPendingTabActionId(pendingActions, 'activate')
  const filteredTabs = incomingTabs.filter((tab) => !closingTabIds.has(tab.id))

  if (
    activateTabId === null ||
    !filteredTabs.some((tab) => tab.id === activateTabId)
  ) {
    return filteredTabs.slice()
  }

  return filteredTabs.map((tab) => {
    const active = tab.id === activateTabId
    return tab.active === active ? tab : { ...tab, active }
  })
}

function reconcileTabsForState(
  state: BrowserState,
  incomingTabs: readonly BrowserWindowTab[],
): Pick<BrowserState, 'tabs' | 'activeTabId'> | null {
  let preparedTabs = prepareIncomingTabsForPendingActions(
    incomingTabs,
    state.pendingActions,
  )
  if (
    deriveBrowserActiveTabId(preparedTabs) === null &&
    state.activeTabId !== null &&
    preparedTabs.some((tab) => tab.id === state.activeTabId)
  ) {
    preparedTabs = withActiveTab(preparedTabs, state.activeTabId)
  }
  const tabs = reconcileBrowserTabs(state.tabs, preparedTabs)
  const activeTabId = deriveBrowserActiveTabId(tabs)
  if (tabs === state.tabs && activeTabId === state.activeTabId) return null
  return { tabs, activeTabId }
}

function setPendingActionValue(
  pendingActions: BrowserPendingActions,
  action: BrowserPendingAction,
  id: number,
  isPending: boolean,
): BrowserPendingActions {
  const key = getBrowserPendingActionKey(action, id)
  const hasAction = pendingActions[key] === true
  if (hasAction === isPending) return pendingActions
  if (isPending) return { ...pendingActions, [key]: true }

  const next = { ...pendingActions }
  delete next[key]
  return next
}

function areBrowserScreencastStatesEqual(
  left: BrowserScreencastState,
  right: BrowserScreencastState,
): boolean {
  return (
    left.aspectRatio === right.aspectRatio &&
    left.lastFrameAt === right.lastFrameAt &&
    left.state === right.state &&
    left.tabId === right.tabId &&
    left.stats.droppedFrames === right.stats.droppedFrames &&
    left.stats.lastFrameEstimatedBytes === right.stats.lastFrameEstimatedBytes &&
    left.stats.lastPaintedAt === right.stats.lastPaintedAt &&
    left.stats.paintedFrames === right.stats.paintedFrames &&
    left.stats.receivedFrames === right.stats.receivedFrames &&
    left.stats.restartCount === right.stats.restartCount &&
    left.stats.skippedFrames === right.stats.skippedFrames
  )
}

function areBrowserCaptureViewportsEqual(
  left: BrowserCaptureViewport | null,
  right: BrowserCaptureViewport | null,
): boolean {
  if (left === null || right === null) return left === right
  return (
    left.devicePixelRatio === right.devicePixelRatio &&
    left.height === right.height &&
    left.width === right.width
  )
}

function withActiveTab(
  tabs: readonly BrowserWindowTab[],
  activeTabId: number | null,
): BrowserWindowTab[] {
  return tabs.map((tab) => {
    const active = tab.id === activeTabId
    return tab.active === active ? tab : { ...tab, active }
  })
}

function insertTabByIndex(
  tabs: readonly BrowserWindowTab[],
  tab: BrowserWindowTab,
): BrowserWindowTab[] {
  const withoutExistingTab = tabs.filter((candidate) => candidate.id !== tab.id)
  const insertionIndex = Math.max(
    0,
    Math.min(tab.index, withoutExistingTab.length),
  )
  return [
    ...withoutExistingTab.slice(0, insertionIndex),
    tab,
    ...withoutExistingTab.slice(insertionIndex),
  ]
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
      const previous = get()
      if (previous.windowId !== id) {
        for (const tab of previous.tabs) clearBrowserFramesForTab(tab.id)
      }
      persistWindowId(id)
      set((state) => {
        const isSameWindow = state.windowId === id
        const baseState = isSameWindow
          ? state
          : { ...state, tabs: [], activeTabId: null, pendingActions: {} }
        const reconciled = reconcileTabsForState(baseState, tabs)
        if (isSameWindow && reconciled === null && state.windowError === null) {
          return state
        }
        return {
          windowId: id,
          tabs: reconciled?.tabs ?? baseState.tabs,
          activeTabId: reconciled?.activeTabId ?? baseState.activeTabId,
          pendingActions: baseState.pendingActions,
          windowError: null,
        }
      })
    },

    clearWindow: () => {
      for (const tab of get().tabs) clearBrowserFramesForTab(tab.id)
      persistWindowId(null)
      set({
        windowId: null,
        tabs: [],
        activeTabId: null,
        pendingActions: {},
      })
    },

    setTabs: (tabs) => {
      get().reconcileTabs(tabs)
    },

    reconcileTabs: (tabs) => {
      set((state) => reconcileTabsForState(state, tabs) ?? state)
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
      get().reconcileTabs(event.tabs)
    },

    setPendingAction: (action, id, isPending) => {
      set((state) => {
        const pendingActions = setPendingActionValue(
          state.pendingActions,
          action,
          id,
          isPending,
        )
        return pendingActions === state.pendingActions ? state : { pendingActions }
      })
    },

    optimisticallyActivateTab: (tabId) => {
      set((state) => {
        if (!state.tabs.some((tab) => tab.id === tabId)) return state
        const tabs = reconcileBrowserTabs(
          state.tabs,
          withActiveTab(state.tabs, tabId),
        )
        if (tabs === state.tabs && state.activeTabId === tabId) return state
        return { tabs, activeTabId: tabId }
      })
    },

    optimisticallyCloseTab: (tabId) => {
      clearBrowserFramesForTab(tabId)
      set((state) => {
        const tabIndex = state.tabs.findIndex((tab) => tab.id === tabId)
        if (tabIndex === -1) return state

        const tab = state.tabs[tabIndex]
        const wasActive = tab?.active === true || state.activeTabId === tabId
        const remainingTabs = state.tabs.filter((candidate) => candidate.id !== tabId)
        const fallbackActiveTabId = wasActive
          ? (state.tabs[tabIndex + 1]?.id ?? state.tabs[tabIndex - 1]?.id ?? null)
          : state.activeTabId
        const activeTabId =
          fallbackActiveTabId !== null &&
          remainingTabs.some((candidate) => candidate.id === fallbackActiveTabId)
            ? fallbackActiveTabId
            : deriveBrowserActiveTabId(remainingTabs)
        return {
          tabs: withActiveTab(remainingTabs, activeTabId),
          activeTabId,
        }
      })
    },

    upsertCreatedTab: (tab) => {
      set((state) => {
        const tabs = reconcileBrowserTabs(
          state.tabs,
          withActiveTab(insertTabByIndex(state.tabs, tab), tab.id),
        )
        return {
          tabs,
          activeTabId: tab.id,
        }
      })
    },

    ensureBrowserWindow: async (options) => {
      const existing = get().windowId
      if (existing !== null) return existing

      const bridge = getActiveBrowserExtensionBridge()
      if (bridge === null || bridge.getStatus() !== 'available') {
        set({ windowError: 'Browser extension is not available.' })
        return null
      }

      set({ isOpeningWindow: true, windowError: null })
      try {
        const snapshot = await bridge.createBrowserWindow({
          bounds: options?.bounds,
        })
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

    setCaptureViewport: (viewport) => {
      set((state) =>
        areBrowserCaptureViewportsEqual(state.captureViewport, viewport)
          ? state
          : { captureViewport: viewport },
      )
    },

    setScreencast: (state) => {
      set((current) =>
        areBrowserScreencastStatesEqual(current.screencast, state)
          ? current
          : { screencast: state },
      )
    },

    setNavigation: (state) => {
      set({ navigation: state })
    },

    reset: () => {
      for (const tab of get().tabs) clearBrowserFramesForTab(tab.id)
      set({ ...initialState })
    },
  }),
)
