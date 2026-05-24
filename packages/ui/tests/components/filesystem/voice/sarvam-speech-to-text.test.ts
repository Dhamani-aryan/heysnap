import { describe, expect, it } from "vitest";

import {
  extractSarvamTranscript,
  normalizeSarvamAudioMimeType,
} from "../../../../src/components/filesystem/voice/sarvam-speech-to-text";

describe("Sarvam speech-to-text helpers", () => {
  it("normalizes supported audio mime types", () => {
    expect(normalizeSarvamAudioMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizeSarvamAudioMimeType("video/webm")).toBe("audio/webm");
    expect(normalizeSarvamAudioMimeType("audio/ogg")).toBe("audio/ogg");
    expect(normalizeSarvamAudioMimeType("audio/opus")).toBe("audio/opus");
    expect(normalizeSarvamAudioMimeType("audio/mp4")).toBe("audio/mp4");
    expect(normalizeSarvamAudioMimeType("audio/x-m4a")).toBe("audio/x-m4a");
    expect(normalizeSarvamAudioMimeType("audio/wav")).toBe("audio/wav");
    expect(normalizeSarvamAudioMimeType("audio/x-wav")).toBe("audio/x-wav");
    expect(normalizeSarvamAudioMimeType("audio/wave")).toBe("audio/wave");
    expect(normalizeSarvamAudioMimeType("audio/mpeg")).toBe("audio/mpeg");
    expect(normalizeSarvamAudioMimeType("audio/mp3")).toBe("audio/mp3");
  });

  it("falls back to webm for unknown or empty mime types", () => {
    expect(normalizeSarvamAudioMimeType("application/octet-stream")).toBe("audio/webm");
    expect(normalizeSarvamAudioMimeType("")).toBe("audio/webm");
  });

  it("extracts transcripts from strings, arrays, and nested records", () => {
    expect(extractSarvamTranscript(" hello ")).toBe("hello");
    expect(extractSarvamTranscript([" first ", { transcript: "second" }])).toBe("first\nsecond");
    expect(extractSarvamTranscript({ output: { transcript: "nested output" } })).toBe("nested output");
    expect(extractSarvamTranscript({ transcripts: [{ transcript: "one" }, "two"] })).toBe("one\ntwo");
  });

  it("returns null for empty or unsupported transcript payloads", () => {
    expect(extractSarvamTranscript("   ")).toBeNull();
    expect(extractSarvamTranscript([" ", { transcript: "" }])).toBeNull();
    expect(extractSarvamTranscript(null)).toBeNull();
    expect(extractSarvamTranscript({ result: "not used" })).toBeNull();
  });
});
