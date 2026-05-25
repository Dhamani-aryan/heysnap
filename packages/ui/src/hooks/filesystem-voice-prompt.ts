import { useCallback, useEffect, useRef, useState } from "react";

import type { PromptVoiceState } from "../agent/prompt-composer";
import {
  extractSarvamTranscript,
  getPreferredRecordingMimeType,
  normalizeSarvamAudioMimeType,
  transcribeSarvamRecording,
} from "../components/filesystem/voice/sarvam-speech-to-text";
import {
  isFilesystemVoiceHotkey,
  isFilesystemVoiceHotkeyCharacterKey,
  isFilesystemVoiceHotkeyMessage,
  isFilesystemVoiceHotkeyReleaseKey,
} from "../components/filesystem/voice/filesystem-voice-hotkey";

export const appendPromptTranscript = (draft: string, transcript: string): string => {
  const trimmedTranscript = transcript.trim();

  if (trimmedTranscript.length === 0) {
    return draft;
  }

  const trimmedDraft = draft.trimEnd();
  return trimmedDraft.length === 0 ? trimmedTranscript : `${trimmedDraft}\n${trimmedTranscript}`;
};

export const useFilesystemVoicePrompt = ({
  sarvamApiKey,
  onTranscript,
}: {
  readonly sarvamApiKey?: string;
  readonly onTranscript: (transcript: string) => void;
}): {
  readonly recordingState: PromptVoiceState;
  readonly startRecording: () => Promise<void>;
  readonly stopRecording: () => void;
} => {
  const [recordingState, setRecordingState] = useState<PromptVoiceState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingSessionRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const shouldTranscribeOnStopRef = useRef(false);
  const hotkeyRecordingRef = useRef(false);
  const recordingStateRef = useRef(recordingState);

  useEffect(() => {
    recordingStateRef.current = recordingState;
  }, [recordingState]);

  const discardRecording = useCallback(() => {
    audioChunksRef.current = [];

    const stream = mediaStreamRef.current;
    mediaStreamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  const handleRecordingStopped = useCallback(async (durationSeconds: number): Promise<void> => {
    const audioType = normalizeSarvamAudioMimeType(audioChunksRef.current[0]?.type || "audio/webm");
    const audioBlob = new Blob(audioChunksRef.current, { type: audioType });

    try {
      const result = await transcribeSarvamRecording({
        apiKey: sarvamApiKey,
        audioBlob,
        durationSeconds,
      });
      const transcript = extractSarvamTranscript(result);

      if (transcript !== null) {
        onTranscript(transcript);
      }
    } catch (error) {
      console.error("Sarvam STT failed.", error);
    } finally {
      discardRecording();
      setRecordingState("idle");
    }
  }, [discardRecording, onTranscript, sarvamApiKey]);

  const stopRecording = useCallback(() => {
    hotkeyRecordingRef.current = false;
    recordingSessionRef.current += 1;
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;

    if (recorder !== null && recorder.state !== "inactive") {
      shouldTranscribeOnStopRef.current = true;
      setRecordingState("transcribing");
      recorder.stop();
    } else {
      discardRecording();
      setRecordingState("idle");
    }
  }, [discardRecording]);

  const startRecording = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      typeof MediaRecorder === "undefined" ||
      navigator.mediaDevices?.getUserMedia === undefined
    ) {
      return;
    }

    setRecordingState("starting");
    const recordingSession = recordingSessionRef.current + 1;
    recordingSessionRef.current = recordingSession;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (recordingSessionRef.current !== recordingSession) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const recordingMimeType = getPreferredRecordingMimeType();
      const recorder = new MediaRecorder(
        stream,
        recordingMimeType === undefined ? undefined : { mimeType: recordingMimeType },
      );

      shouldTranscribeOnStopRef.current = false;
      audioChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = performance.now();
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        if (shouldTranscribeOnStopRef.current) {
          shouldTranscribeOnStopRef.current = false;
          void handleRecordingStopped((performance.now() - recordingStartedAtRef.current) / 1000);
          return;
        }

        discardRecording();
      }, { once: true });
      recorder.start();
      setRecordingState("recording");
    } catch (error) {
      discardRecording();
      setRecordingState("idle");
      console.warn("Microphone recording failed.", error);
    }
  }, [discardRecording, handleRecordingStopped]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || !isFilesystemVoiceHotkey(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (recordingStateRef.current !== "idle") {
        return;
      }

      hotkeyRecordingRef.current = true;
      void startRecording();
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (
        !hotkeyRecordingRef.current ||
        !isFilesystemVoiceHotkeyReleaseKey(event)
      ) {
        return;
      }

      event.preventDefault();
      if (isFilesystemVoiceHotkeyCharacterKey(event)) {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      hotkeyRecordingRef.current = false;
      stopRecording();
    };

    const handleWindowBlur = (): void => {
      if (!hotkeyRecordingRef.current) {
        return;
      }

      hotkeyRecordingRef.current = false;
      stopRecording();
    };

    const handlePreviewHotkeyMessage = (event: MessageEvent): void => {
      if (!isTrustedFilesystemPreviewMessageSource(event.source) || !isFilesystemVoiceHotkeyMessage(event.data)) {
        return;
      }

      const message = event.data;

      if (message.phase === "blur") {
        if (hotkeyRecordingRef.current) {
          hotkeyRecordingRef.current = false;
          stopRecording();
        }
        return;
      }

      if (message.phase === "keydown") {
        if (message.repeat || !isFilesystemVoiceHotkey(message) || recordingStateRef.current !== "idle") {
          return;
        }

        hotkeyRecordingRef.current = true;
        void startRecording();
        return;
      }

      if (!hotkeyRecordingRef.current || !isFilesystemVoiceHotkeyReleaseKey(message)) {
        return;
      }

      hotkeyRecordingRef.current = false;
      stopRecording();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("message", handlePreviewHotkeyMessage);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("message", handlePreviewHotkeyMessage);
    };
  }, [startRecording, stopRecording]);

  useEffect(() => () => {
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    shouldTranscribeOnStopRef.current = false;

    if (recorder !== null && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }

    discardRecording();
  }, [discardRecording]);

  return {
    recordingState,
    startRecording,
    stopRecording,
  };
};

const isTrustedFilesystemPreviewMessageSource = (source: MessageEventSource | null): boolean => {
  if (source === null || typeof document === "undefined") {
    return false;
  }

  const previewFrames = document.querySelectorAll<HTMLIFrameElement>("iframe.heysnap-file-preview-frame");

  for (const frame of previewFrames) {
    if (frame.contentWindow === source) {
      return true;
    }
  }

  return false;
};
