export const FILESYSTEM_VOICE_HOTKEY_MESSAGE_TYPE = "heysnap:filesystem-voice-hotkey";

export type FilesystemVoiceHotkeyPhase = "keydown" | "keyup" | "blur";

export type FilesystemVoiceHotkeyEventLike = {
  readonly altKey: boolean;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly repeat?: boolean;
};

export type FilesystemVoiceHotkeyMessage = FilesystemVoiceHotkeyEventLike & {
  readonly type: typeof FILESYSTEM_VOICE_HOTKEY_MESSAGE_TYPE;
  readonly phase: Exclude<FilesystemVoiceHotkeyPhase, "blur">;
} | {
  readonly type: typeof FILESYSTEM_VOICE_HOTKEY_MESSAGE_TYPE;
  readonly phase: "blur";
};

export const isFilesystemVoiceHotkey = (event: FilesystemVoiceHotkeyEventLike): boolean =>
  (event.altKey || event.ctrlKey) && isFilesystemVoiceHotkeyCharacterKey(event);

export const isFilesystemVoiceHotkeyCharacterKey = (
  event: Pick<FilesystemVoiceHotkeyEventLike, "code" | "key">,
): boolean =>
  event.code === "KeyM" || event.key.toLowerCase() === "m";

export const isFilesystemVoiceHotkeyReleaseKey = (
  event: Pick<FilesystemVoiceHotkeyEventLike, "code" | "key">,
): boolean =>
  isFilesystemVoiceHotkeyCharacterKey(event) ||
  event.key === "Alt" ||
  event.key === "Control" ||
  event.code === "AltLeft" ||
  event.code === "AltRight" ||
  event.code === "ControlLeft" ||
  event.code === "ControlRight";

export const isFilesystemVoiceHotkeyMessage = (value: unknown): value is FilesystemVoiceHotkeyMessage => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (record.type !== FILESYSTEM_VOICE_HOTKEY_MESSAGE_TYPE) {
    return false;
  }

  if (record.phase === "blur") {
    return true;
  }

  return (
    (record.phase === "keydown" || record.phase === "keyup") &&
    typeof record.altKey === "boolean" &&
    typeof record.ctrlKey === "boolean" &&
    typeof record.code === "string" &&
    typeof record.key === "string" &&
    (record.repeat === undefined || typeof record.repeat === "boolean")
  );
};
