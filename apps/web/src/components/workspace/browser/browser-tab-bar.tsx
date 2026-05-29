import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Cancel01Icon, InternetIcon } from '@hugeicons/core-free-icons'
import {
  getActiveBrowserExtensionBridge,
  useBrowserStore,
} from '../../../stores/browser/browser-store.ts'
import {
  activateBrowserTab,
  closeBrowserTab,
  createBrowserTab,
} from '../../../lib/browser/browser-actions.ts'
import type { BrowserWindowTab } from '../../../lib/browser/types.ts'
import './browser-chrome.css'

export function BrowserTabBar() {
  const tabs = useBrowserStore((s) => s.tabs)
  const activeTabId = useBrowserStore((s) => s.activeTabId)
  const windowId = useBrowserStore((s) => s.windowId)

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
          onSelect={() => {
            const bridge = getActiveBrowserExtensionBridge()
            if (bridge === null) return
            const controller = new AbortController()
            void activateBrowserTab({
              bridge,
              tabId: tab.id,
              signal: controller.signal,
            }).catch(() => undefined)
          }}
          onClose={() => {
            const bridge = getActiveBrowserExtensionBridge()
            if (bridge === null) return
            const controller = new AbortController()
            void closeBrowserTab({
              bridge,
              tabId: tab.id,
              signal: controller.signal,
            }).catch(() => undefined)
          }}
        />
      ))}
      <button
        type="button"
        aria-label="New tab"
        title="New tab"
        disabled={windowId === null}
        className="browser-window-new-tab"
        onClick={() => {
          if (windowId === null) return
          const bridge = getActiveBrowserExtensionBridge()
          if (bridge === null) return
          const controller = new AbortController()
          void createBrowserTab({
            bridge,
            windowId,
            signal: controller.signal,
          }).catch(() => undefined)
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
  onSelect,
  onClose,
}: {
  tab: BrowserWindowTab
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}) {
  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      title={tab.title ?? tab.url ?? `Tab ${tab.id}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect()
      }}
      className={isActive ? 'browser-window-tab active' : 'browser-window-tab'}
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
