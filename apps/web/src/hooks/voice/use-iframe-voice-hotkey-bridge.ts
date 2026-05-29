import { useEffect, type RefObject } from 'react'
import {
  dispatchVoiceHotkeyEvent,
  isVoiceHotkey,
  isVoiceHotkeyCharacterKey,
  isVoiceHotkeyReleaseKey,
} from '../../lib/voice/voice-hotkey.ts'

export function useIframeVoiceHotkeyBridge(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  src: string | null,
): void {
  useEffect(() => {
    const iframe = iframeRef.current
    if (iframe === null || src === null) return

    let frameWindow: Window | null = null
    let isHotkeyActive = false
    let focusFrame: number | null = null

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || !isVoiceHotkey(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      isHotkeyActive = true
      dispatchVoiceHotkeyEvent(window, 'keydown', event)
    }

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (!isHotkeyActive || !isVoiceHotkeyReleaseKey(event)) return
      event.preventDefault()
      if (isVoiceHotkeyCharacterKey(event)) {
        isHotkeyActive = false
      }
      dispatchVoiceHotkeyEvent(window, 'keyup', event)
    }

    const keepParentFocused = (): void => {
      if (document.activeElement !== iframe) return
      iframe.blur()
      window.focus()
    }

    const scheduleParentFocus = (): void => {
      if (focusFrame !== null) {
        window.cancelAnimationFrame(focusFrame)
      }
      focusFrame = window.requestAnimationFrame(() => {
        focusFrame = null
        keepParentFocused()
      })
    }

    const detach = (): void => {
      try {
        frameWindow?.removeEventListener('keydown', handleKeyDown, true)
        frameWindow?.removeEventListener('keyup', handleKeyUp, true)
      } catch {
        // The iframe window can become cross-origin or detached before cleanup.
      }
      frameWindow = null
      isHotkeyActive = false
    }

    const attach = (): void => {
      detach()
      try {
        frameWindow = iframe.contentWindow
        frameWindow?.addEventListener('keydown', handleKeyDown, true)
        frameWindow?.addEventListener('keyup', handleKeyUp, true)
      } catch {
        frameWindow = null
      }
    }

    attach()
    iframe.addEventListener('focus', scheduleParentFocus)
    iframe.addEventListener('load', attach)
    window.addEventListener('blur', scheduleParentFocus)
    return () => {
      if (focusFrame !== null) {
        window.cancelAnimationFrame(focusFrame)
      }
      iframe.removeEventListener('focus', scheduleParentFocus)
      iframe.removeEventListener('load', attach)
      window.removeEventListener('blur', scheduleParentFocus)
      detach()
    }
  }, [iframeRef, src])
}
