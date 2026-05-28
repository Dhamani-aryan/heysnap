export type VoiceHotkeyEventLike = {
  readonly altKey: boolean
  readonly code: string
  readonly ctrlKey: boolean
  readonly key: string
  readonly repeat?: boolean
}

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
