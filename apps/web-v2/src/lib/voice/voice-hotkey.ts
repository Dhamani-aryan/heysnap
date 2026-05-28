export type VoiceHotkeyEventLike = {
  readonly altKey: boolean
  readonly code: string
  readonly ctrlKey: boolean
  readonly key: string
  readonly repeat?: boolean
}

export const VOICE_HOTKEY_KEYDOWN_EVENT = 'heysnap:voice-hotkey-keydown'
export const VOICE_HOTKEY_KEYUP_EVENT = 'heysnap:voice-hotkey-keyup'

export const isVoiceHotkey = (event: VoiceHotkeyEventLike): boolean =>
  (event.altKey || event.ctrlKey) && isVoiceHotkeyCharacterKey(event)

export const isVoiceHotkeyCharacterKey = (
  event: Pick<VoiceHotkeyEventLike, 'code' | 'key'>,
): boolean => event.code === 'KeyM' || event.key.toLowerCase() === 'm'

export const isVoiceHotkeyReleaseKey = (
  event: Pick<VoiceHotkeyEventLike, 'code' | 'key'>,
): boolean =>
  isVoiceHotkeyCharacterKey(event) ||
  event.key === 'Alt' ||
  event.key === 'Control' ||
  event.code === 'AltLeft' ||
  event.code === 'AltRight' ||
  event.code === 'ControlLeft' ||
  event.code === 'ControlRight'

export function dispatchVoiceHotkeyEvent(
  target: Window,
  type: 'keydown' | 'keyup',
  event: KeyboardEvent,
): void {
  target.dispatchEvent(
    new CustomEvent<VoiceHotkeyEventLike>(
      type === 'keydown'
        ? VOICE_HOTKEY_KEYDOWN_EVENT
        : VOICE_HOTKEY_KEYUP_EVENT,
      {
        detail: {
          altKey: event.altKey,
          code: event.code,
          ctrlKey: event.ctrlKey,
          key: event.key,
          repeat: event.repeat,
        },
      },
    ),
  )
}
