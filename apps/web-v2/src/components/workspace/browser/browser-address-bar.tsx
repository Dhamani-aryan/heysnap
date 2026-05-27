import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft02Icon,
  ArrowRight02Icon,
  Refresh01Icon,
} from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState } from 'react'
import {
  getActiveBrowserExtensionBridge,
  useBrowserStore,
} from '../../../stores/browser/browser-store.ts'
import {
  goBackInBrowserTab,
  goForwardInBrowserTab,
  navigateBrowserTab,
  refreshBrowserTab,
} from '../../../lib/browser/browser-actions.ts'
import { getBrowserScreencastMode } from '../../../lib/browser/browser-screencast-messages.ts'
import './browser-chrome.css'

export function BrowserAddressBar() {
  const tabs = useBrowserStore((s) => s.tabs)
  const activeTabId = useBrowserStore((s) => s.activeTabId)
  const navigation = useBrowserStore((s) => s.navigation)
  const activeTab =
    activeTabId === null ? null : tabs.find((t) => t.id === activeTabId) ?? null
  const activeTabUrl = activeTab?.url
  const isNewTab = getBrowserScreencastMode(activeTabUrl) === 'new_tab'

  const inputRef = useRef<HTMLInputElement | null>(null)
  const [value, setValue] = useState('')
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    if (isNewTab) {
      setValue('')
      return
    }
    if (!isFocused) setValue(activeTabUrl ?? '')
  }, [activeTabUrl, isNewTab, isFocused])

  useEffect(() => {
    if (!isNewTab || activeTabId === null) return
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => {
      window.cancelAnimationFrame(id)
    }
  }, [activeTabId, isNewTab])

  const canGoBack =
    activeTabId !== null &&
    navigation.tabId === activeTabId &&
    navigation.canGoBack
  const canGoForward =
    activeTabId !== null &&
    navigation.tabId === activeTabId &&
    navigation.canGoForward

  const submit = (): void => {
    const url = value.trim()
    if (url.length === 0 || activeTabId === null) return
    const bridge = getActiveBrowserExtensionBridge()
    if (bridge === null) return
    const controller = new AbortController()
    void navigateBrowserTab({
      bridge,
      tabId: activeTabId,
      url: normalizeUrl(url),
      signal: controller.signal,
    }).catch(() => undefined)
  }

  return (
    <div className="browser-window-toolbar" aria-label="Browser toolbar">
      <NavIconButton
        icon={ArrowLeft02Icon}
        label="Back"
        disabled={!canGoBack}
        onClick={() => {
          if (activeTabId === null) return
          const bridge = getActiveBrowserExtensionBridge()
          if (bridge === null) return
          const controller = new AbortController()
          void goBackInBrowserTab({
            bridge,
            tabId: activeTabId,
            signal: controller.signal,
          }).catch(() => undefined)
        }}
      />
      <NavIconButton
        icon={ArrowRight02Icon}
        label="Forward"
        disabled={!canGoForward}
        onClick={() => {
          if (activeTabId === null) return
          const bridge = getActiveBrowserExtensionBridge()
          if (bridge === null) return
          const controller = new AbortController()
          void goForwardInBrowserTab({
            bridge,
            tabId: activeTabId,
            signal: controller.signal,
          }).catch(() => undefined)
        }}
      />
      <NavIconButton
        icon={Refresh01Icon}
        label="Refresh"
        disabled={activeTabId === null}
        onClick={() => {
          if (activeTabId === null) return
          const bridge = getActiveBrowserExtensionBridge()
          if (bridge === null) return
          const controller = new AbortController()
          void refreshBrowserTab({
            bridge,
            tabId: activeTabId,
            signal: controller.signal,
          }).catch(() => undefined)
        }}
      />
      <form
        className="browser-window-address-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          aria-label="Address"
          spellCheck={false}
          disabled={activeTabId === null}
          placeholder={isNewTab ? 'Enter a URL' : ''}
          onChange={(event) => setValue(event.currentTarget.value)}
          onFocus={(event) => {
            setIsFocused(true)
            event.currentTarget.select()
          }}
          onBlur={() => setIsFocused(false)}
          className="browser-window-address"
        />
      </form>
    </div>
  )
}

function NavIconButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="browser-window-toolbar-button"
    >
      <HugeiconsIcon icon={icon} size={16} color="currentColor" strokeWidth={2} />
    </button>
  )
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) return trimmed
  if (/^[a-z]+:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('about:') || trimmed.startsWith('chrome://')) {
    return trimmed
  }
  if (/^[^\s]+\.[^\s]+$/.test(trimmed)) return `https://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}
