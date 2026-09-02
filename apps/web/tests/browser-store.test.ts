import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activateBrowserTab,
  createBrowserTab,
} from '../src/lib/browser/browser-actions.ts'
import type { BrowserExtensionBridge } from '../src/lib/browser/browser-extension-bridge.ts'
import {
  reconcileBrowserTabs,
  useBrowserStore,
} from '../src/stores/browser/browser-store.ts'
import type { BrowserWindowTab } from '../src/lib/browser/types.ts'

const tab = (
  id: number,
  index: number,
  active = false,
  overrides: Partial<BrowserWindowTab> = {},
): BrowserWindowTab => ({
  id,
  index,
  active,
  title: `Tab ${String(id)}`,
  url: `https://example.com/${String(id)}`,
  ...overrides,
})

describe('browser tab store', () => {
  beforeEach(() => {
    useBrowserStore.getState().reset()
  })

  it('preserves tab references for no-op snapshots', () => {
    const tabs = [tab(1, 0, true), tab(2, 1)]
    const reconciled = reconcileBrowserTabs(tabs, [
      { ...tabs[0] },
      { ...tabs[1] },
    ])

    expect(reconciled).toBe(tabs)
    expect(reconciled[0]).toBe(tabs[0])
    expect(reconciled[1]).toBe(tabs[1])
  })

  it('keeps unchanged tabs stable when one tab changes', () => {
    const tabs = [tab(1, 0, true), tab(2, 1)]
    const reconciled = reconcileBrowserTabs(tabs, [
      tabs[0],
      { ...tabs[1], title: 'Updated' },
    ])

    expect(reconciled).not.toBe(tabs)
    expect(reconciled[0]).toBe(tabs[0])
    expect(reconciled[1]).not.toBe(tabs[1])
    expect(reconciled[1]?.title).toBe('Updated')
  })

  it('optimistically activates tabs', () => {
    const store = useBrowserStore.getState()
    store.setWindow({ id: 10, tabs: [tab(1, 0, true), tab(2, 1)] })

    useBrowserStore.getState().optimisticallyActivateTab(2)

    const state = useBrowserStore.getState()
    expect(state.activeTabId).toBe(2)
    expect(state.tabs.map((candidate) => candidate.active)).toEqual([
      false,
      true,
    ])
  })

  it('optimistically closes the active tab and selects the next neighbor', () => {
    const store = useBrowserStore.getState()
    store.setWindow({
      id: 10,
      tabs: [tab(1, 0), tab(2, 1, true), tab(3, 2)],
    })

    useBrowserStore.getState().optimisticallyCloseTab(2)

    const state = useBrowserStore.getState()
    expect(state.tabs.map((candidate) => candidate.id)).toEqual([1, 3])
    expect(state.activeTabId).toBe(3)
    expect(state.tabs.find((candidate) => candidate.id === 3)?.active).toBe(true)
  })

  it('does not let stale snapshots undo pending optimistic activation', () => {
    const store = useBrowserStore.getState()
    store.setWindow({ id: 10, tabs: [tab(1, 0, true), tab(2, 1)] })
    store.setPendingAction('activate', 2, true)
    store.optimisticallyActivateTab(2)

    useBrowserStore
      .getState()
      .reconcileTabs([tab(1, 0, true), tab(2, 1, false)])

    const state = useBrowserStore.getState()
    expect(state.activeTabId).toBe(2)
    expect(state.tabs.map((candidate) => candidate.active)).toEqual([
      false,
      true,
    ])
  })

  it('does not let stale snapshots re-add pending optimistic closes', () => {
    const store = useBrowserStore.getState()
    store.setWindow({ id: 10, tabs: [tab(1, 0, true), tab(2, 1)] })
    store.setPendingAction('close', 1, true)
    store.optimisticallyCloseTab(1)

    useBrowserStore
      .getState()
      .reconcileTabs([tab(1, 0, true), tab(2, 1, false)])

    const state = useBrowserStore.getState()
    expect(state.tabs.map((candidate) => candidate.id)).toEqual([2])
    expect(state.activeTabId).toBe(2)
  })
})

describe('browser tab actions', () => {
  it('returns the tab created by Chrome', async () => {
    const createdTab = tab(3, 2, true)
    const executeCommand = vi.fn().mockResolvedValue(createdTab)
    const bridge = { executeCommand } as unknown as BrowserExtensionBridge
    const signal = new AbortController().signal

    await expect(
      createBrowserTab({ bridge, windowId: 10, signal }),
    ).resolves.toEqual(createdTab)
    expect(executeCommand).toHaveBeenCalledWith(
      'chrome.call',
      {
        api: 'tabs.create',
        args: [{ windowId: 10, active: true }],
      },
      signal,
    )
  })

  it('returns nested tabs from managed-window command results', async () => {
    const tabs = [tab(1, 0), tab(2, 1, true)]
    const executeCommand = vi.fn().mockResolvedValue({ window: { tabs } })
    const bridge = { executeCommand } as unknown as BrowserExtensionBridge

    await expect(
      activateBrowserTab({
        bridge,
        tabId: 2,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual(tabs)
  })
})
