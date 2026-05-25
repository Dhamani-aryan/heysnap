const FILESYSTEM_VOICE_HOTKEY_MESSAGE_TYPE = "heysnap:filesystem-voice-hotkey";

type FilesystemVoiceHotkeyEventLike = {
  readonly altKey: boolean;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly repeat?: boolean;
};

const isFilesystemVoiceHotkeyCharacterKey = (event: Pick<FilesystemVoiceHotkeyEventLike, "code" | "key">): boolean =>
  event.code === "KeyM" || event.key.toLowerCase() === "m";

const isFilesystemVoiceHotkey = (event: FilesystemVoiceHotkeyEventLike): boolean =>
  (event.altKey || event.ctrlKey) && isFilesystemVoiceHotkeyCharacterKey(event);

const isFilesystemVoiceHotkeyReleaseKey = (event: Pick<FilesystemVoiceHotkeyEventLike, "code" | "key">): boolean =>
  isFilesystemVoiceHotkeyCharacterKey(event) ||
  event.key === "Alt" ||
  event.key === "Control" ||
  event.code === "AltLeft" ||
  event.code === "AltRight" ||
  event.code === "ControlLeft" ||
  event.code === "ControlRight";

export const installFilesystemVoiceHotkeyRelay = (targetWindow: Window): (() => void) | null => {
  if (window.parent === window) {
    return null;
  }

  const parentWindow = window.parent;
  let isRelayingHotkey = false;

  const postKeyMessage = (phase: "keydown" | "keyup", event: KeyboardEvent): void => {
    parentWindow.postMessage({
      type: FILESYSTEM_VOICE_HOTKEY_MESSAGE_TYPE,
      phase,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      code: event.code,
      key: event.key,
      repeat: event.repeat,
    }, "*");
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || !isFilesystemVoiceHotkey(event)) {
      return;
    }

    isRelayingHotkey = true;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    postKeyMessage("keydown", event);
  };

  const handleKeyUp = (event: KeyboardEvent): void => {
    if (!isRelayingHotkey || !isFilesystemVoiceHotkeyReleaseKey(event)) {
      return;
    }

    postKeyMessage("keyup", event);

    if (isFilesystemVoiceHotkeyCharacterKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      isRelayingHotkey = false;
    }
  };

  const handleBlur = (): void => {
    if (!isRelayingHotkey) {
      return;
    }

    isRelayingHotkey = false;
    parentWindow.postMessage({
      type: FILESYSTEM_VOICE_HOTKEY_MESSAGE_TYPE,
      phase: "blur",
    }, "*");
  };

  try {
    targetWindow.addEventListener("keydown", handleKeyDown, true);
    targetWindow.addEventListener("keyup", handleKeyUp, true);
    targetWindow.addEventListener("blur", handleBlur);
  } catch {
    return null;
  }

  return () => {
    try {
      targetWindow.removeEventListener("keydown", handleKeyDown, true);
      targetWindow.removeEventListener("keyup", handleKeyUp, true);
      targetWindow.removeEventListener("blur", handleBlur);
    } catch {
      // The frame may have navigated cross-origin between install and cleanup.
    }
  };
};
