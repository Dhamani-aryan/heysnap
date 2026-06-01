import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Cancel01Icon, InternetIcon } from '@hugeicons/core-free-icons'
import {
  getActiveBrowserExtensionBridge,
  isBrowserActionPending,
  useBrowserStore,
} from '../../../stores/browser/browser-store.ts'
import {
  activateBrowserTab,
  closeBrowserTab,
  createBrowserTab,
} from '../../../lib/browser/browser-actions.ts'
import { refreshBrowserTabs } from '../../../lib/browser/browser-ui-actions.ts'
import type { BrowserWindowTab } from '../../../lib/browser/types.ts'
import './browser-chrome.css'

export function BrowserTabBar() {
  const tabs = useBrowserStore((s) => s.tabs)
  const activeTabId = useBrowserStore((s) => s.activeTabId)
  const windowId = useBrowserStore((s) => s.windowId)
  const pendingActions = useBrowserStore((s) => s.pendingActions)
  const setPendingAction = useBrowserStore((s) => s.setPendingAction)
  const optimisticallyActivateTab = useBrowserStore(
    (s) => s.optimisticallyActivateTab,
  )
  const optimisticallyCloseTab = useBrowserStore(
    (s) => s.optimisticallyCloseTab,
  )
  const upsertCreatedTab = useBrowserStore((s) => s.upsertCreatedTab)
  const reconcileTabs = useBrowserStore((s) => s.reconcileTabs)
  const isCreatingTab =
    windowId !== null && isBrowserActionPending(pendingActions, 'create', windowId)

  return (
    <div
      role="tablist"
      aria-label="Browser tabs"
      className="browser-window-tabbar"
    >
      {tabs.map((tab) => (
        <BrowserTab
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          isActionPending={
            isBrowserActionPending(pendingActions, 'activate', tab.id) ||
            isBrowserActionPending(pendingActions, 'close', tab.id)
          }
          onSelect={() => {
            if (tab.id === activeTabId) return
            if (
              isBrowserActionPending(pendingActions, 'activate', tab.id) ||
              isBrowserActionPending(pendingActions, 'close', tab.id)
            ) {
              return
            }
            const bridge = getActiveBrowserExtensionBridge()
            if (bridge === null) return
            setPendingAction('activate', tab.id, true)
            optimisticallyActivateTab(tab.id)
            const controller = new AbortController()
            void activateBrowserTab({
              bridge,
              tabId: tab.id,
              signal: controller.signal,
            })
              .then((nextTabs) => {
                if (nextTabs !== null) reconcileTabs(nextTabs)
              })
              .catch(() => {
                setPendingAction('activate', tab.id, false)
                return refreshBrowserTabs(bridge)
              })
              .finally(() => setPendingAction('activate', tab.id, false))
          }}
          onClose={() => {
            if (isBrowserActionPending(pendingActions, 'close', tab.id)) return
            const bridge = getActiveBrowserExtensionBridge()
            if (bridge === null) return
            setPendingAction('close', tab.id, true)
            optimisticallyCloseTab(tab.id)
            const controller = new AbortController()
            void closeBrowserTab({
              bridge,
              tabId: tab.id,
              signal: controller.signal,
            })
              .then((nextTabs) => {
                if (nextTabs !== null) reconcileTabs(nextTabs)
              })
              .catch(() => {
                setPendingAction('close', tab.id, false)
                return refreshBrowserTabs(bridge)
              })
              .finally(() => setPendingAction('close', tab.id, false))
          }}
        />
      ))}
      <button
        type="button"
        aria-label="New tab"
        title="New tab"
        disabled={windowId === null || isCreatingTab}
        className={
          isCreatingTab
            ? 'browser-window-new-tab pending'
            : 'browser-window-new-tab'
        }
        onClick={() => {
          if (windowId === null) return
          if (isBrowserActionPending(pendingActions, 'create', windowId)) return
          const bridge = getActiveBrowserExtensionBridge()
          if (bridge === null) return
          setPendingAction('create', windowId, true)
          const controller = new AbortController()
          void createBrowserTab({
            bridge,
            windowId,
            signal: controller.signal,
          })
            .then((tab) => {
              if (tab !== null) {
                upsertCreatedTab({ ...tab, active: true })
                return
              }
              return refreshBrowserTabs(bridge)
            })
            .catch(() => {
              setPendingAction('create', windowId, false)
              return refreshBrowserTabs(bridge)
            })
            .finally(() => setPendingAction('create', windowId, false))
        }}
      >
        <HugeiconsIcon
          icon={Add01Icon}
          size={14}
          color="currentColor"
          strokeWidth={1.9}
        />
      </button>
    </div>
  )
}

function BrowserTab({
  tab,
  isActive,
  isActionPending,
  onSelect,
  onClose,
}: {
  tab: BrowserWindowTab
  isActive: boolean
  isActionPending: boolean
  onSelect: () => void
  onClose: () => void
}) {
  const isLoading = tab.status === 'loading'
  const className = [
    'browser-window-tab',
    isActive ? 'active' : '',
    isLoading ? 'loading' : '',
    isActionPending ? 'pending' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      role="tab"
      aria-selected={isActive}
      aria-busy={isActionPending || isLoading}
      tabIndex={isActive ? 0 : -1}
      title={tab.title ?? tab.url ?? `Tab ${tab.id}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect()
      }}
      className={className}
    >
      <span className="browser-window-tab-favicon" aria-hidden="true">
        {tab.favIconUrl === undefined || tab.favIconUrl.length === 0 ? (
          <HugeiconsIcon
            icon={InternetIcon}
            size={13}
            color="currentColor"
            strokeWidth={1.8}
          />
        ) : (
          <img src={tab.favIconUrl} alt="" draggable={false} />
        )}
      </span>
      <span className="browser-window-tab-title">
        {tab.title || tab.url || 'New tab'}
      </span>
      <button
        type="button"
        aria-label={`Close ${tab.title ?? tab.url ?? 'tab'}`}
        title="Close tab"
        disabled={isActionPending}
        className="browser-window-tab-close"
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
      >
        <HugeiconsIcon
          icon={Cancel01Icon}
          size={11}
          color="currentColor"
          strokeWidth={2}
        />
      </button>
    </div>
  )
}
