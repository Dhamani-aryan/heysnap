import { activateBrowserTab } from './browser-actions.ts'
import type { BrowserExtensionBridge } from './browser-extension-bridge.ts'
import {
  getActiveBrowserExtensionBridge,
  isBrowserActionPending,
  useBrowserStore,
} from '../../stores/browser/browser-store.ts'

export function focusBrowserTab(tabId: number): void {
  const state = useBrowserStore.getState()
  if (!state.tabs.some((tab) => tab.id === tabId)) return
  if (state.activeTabId === tabId) return
  if (
    isBrowserActionPending(state.pendingActions, 'activate', tabId) ||
    isBrowserActionPending(state.pendingActions, 'close', tabId)
  ) {
    return
  }

  const bridge = getActiveBrowserExtensionBridge()
  if (bridge === null) return

  state.setPendingAction('activate', tabId, true)
  state.optimisticallyActivateTab(tabId)

  const controller = new AbortController()
  void activateBrowserTab({
    bridge,
    tabId,
    signal: controller.signal,
  })
    .then((nextTabs) => {
      if (nextTabs !== null) {
        useBrowserStore.getState().reconcileTabs(nextTabs)
        return
      }

      return refreshBrowserTabs(bridge)
    })
    .catch(() => {
      useBrowserStore.getState().setPendingAction('activate', tabId, false)
      return refreshBrowserTabs(bridge)
    })
    .finally(() => {
      useBrowserStore.getState().setPendingAction('activate', tabId, false)
    })
}

export async function refreshBrowserTabs(
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
