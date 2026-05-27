export type BrowserExtensionStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'unavailable'

export type BrowserWindowTab = {
  readonly id: number
  readonly index: number
  readonly active?: boolean
  readonly favIconUrl?: string
  readonly status?: string
  readonly title?: string
  readonly url?: string
}

export type ChromeWindowSnapshot = {
  readonly id: number
  readonly tabs: BrowserWindowTab[]
}

export type BrowserTabEvent =
  | {
      readonly type: 'tabsChanged'
      readonly tabs: BrowserWindowTab[]
      readonly windowId: number | null
    }
  | {
      readonly type: 'windowRemoved'
      readonly windowId: number
    }
