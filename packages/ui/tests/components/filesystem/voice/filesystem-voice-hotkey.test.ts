import { describe, expect, it } from "vitest";

import {
  FILESYSTEM_VOICE_HOTKEY_MESSAGE_TYPE,
  isFilesystemVoiceHotkey,
  isFilesystemVoiceHotkeyCharacterKey,
  isFilesystemVoiceHotkeyMessage,
  isFilesystemVoiceHotkeyReleaseKey,
} from "../../../../src/components/filesystem/voice/filesystem-voice-hotkey";

describe("filesystem voice hotkey helpers", () => {
  it("recognizes Alt+M and Ctrl+M as voice hotkeys", () => {
    expect(isFilesystemVoiceHotkey({
      altKey: true,
      ctrlKey: false,
      code: "KeyM",
      key: "m",
    })).toBe(true);
    expect(isFilesystemVoiceHotkey({
      altKey: false,
      ctrlKey: true,
      code: "KeyM",
      key: "M",
    })).toBe(true);
    expect(isFilesystemVoiceHotkey({
      altKey: false,
      ctrlKey: false,
      code: "KeyM",
      key: "m",
    })).toBe(false);
  });

  it("recognizes the M key and modifier releases that end hotkey recording", () => {
    expect(isFilesystemVoiceHotkeyCharacterKey({ code: "KeyM", key: "m" })).toBe(true);
    expect(isFilesystemVoiceHotkeyCharacterKey({ code: "KeyN", key: "n" })).toBe(false);
    expect(isFilesystemVoiceHotkeyReleaseKey({ code: "KeyM", key: "m" })).toBe(true);
    expect(isFilesystemVoiceHotkeyReleaseKey({ code: "AltLeft", key: "Alt" })).toBe(true);
    expect(isFilesystemVoiceHotkeyReleaseKey({ code: "ControlRight", key: "Control" })).toBe(true);
    expect(isFilesystemVoiceHotkeyReleaseKey({ code: "KeyN", key: "n" })).toBe(false);
  });

  it("validates previewer hotkey relay messages", () => {
    expect(isFilesystemVoiceHotkeyMessage({
      type: FILESYSTEM_VOICE_HOTKEY_MESSAGE_TYPE,
      phase: "keydown",
      altKey: true,
      ctrlKey: false,
      code: "KeyM",
      key: "m",
      repeat: false,
    })).toBe(true);
    expect(isFilesystemVoiceHotkeyMessage({
      type: FILESYSTEM_VOICE_HOTKEY_MESSAGE_TYPE,
      phase: "blur",
    })).toBe(true);
    expect(isFilesystemVoiceHotkeyMessage({
      type: FILESYSTEM_VOICE_HOTKEY_MESSAGE_TYPE,
      phase: "keydown",
      altKey: true,
      code: "KeyM",
      key: "m",
    })).toBe(false);
    expect(isFilesystemVoiceHotkeyMessage({
      type: "other",
      phase: "keydown",
      altKey: true,
      ctrlKey: false,
      code: "KeyM",
      key: "m",
    })).toBe(false);
  });
});
