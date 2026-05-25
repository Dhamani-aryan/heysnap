import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractSarvamTranscript,
  normalizeSarvamAudioMimeType,
  transcribeSarvamRecording,
} from "../../../../src/components/filesystem/voice/sarvam-speech-to-text";

describe("Sarvam speech-to-text helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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
    expect(extractSarvamTranscript([{ fileName: "0.json", output: { transcript: "batch output" } }])).toBe("batch output");
  });

  it("returns null for empty or unsupported transcript payloads", () => {
    expect(extractSarvamTranscript("   ")).toBeNull();
    expect(extractSarvamTranscript([" ", { transcript: "" }])).toBeNull();
    expect(extractSarvamTranscript(null)).toBeNull();
    expect(extractSarvamTranscript({ result: "not used" })).toBeNull();
  });

  it("routes long browser recordings through the batch proxy", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify([{ fileName: "0.json", output: { transcript: "long recording transcript" } }]),
      { status: 200 },
    ));

    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeSarvamRecording({
      audioBlob: new Blob(["voice"], { type: "audio/webm" }),
      durationSeconds: 31,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sarvam/speech-to-text/batch",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      }),
    );
    expect(extractSarvamTranscript(result)).toBe("long recording transcript");
  });
});
