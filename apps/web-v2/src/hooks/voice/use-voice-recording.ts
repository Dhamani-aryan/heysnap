import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isVoiceHotkey,
  isVoiceHotkeyCharacterKey,
  isVoiceHotkeyReleaseKey,
  VOICE_HOTKEY_KEYDOWN_EVENT,
  VOICE_HOTKEY_KEYUP_EVENT,
  type VoiceHotkeyEventLike,
} from '../../lib/voice/voice-hotkey.ts'

export type VoiceRecordingState =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'transcribing'

type Options = {
  onRecordingComplete?: (
    audioBlob: Blob,
    durationSeconds: number,
  ) => void | Promise<void>
}

export function useVoiceRecording({ onRecordingComplete }: Options = {}): {
  readonly recordingState: VoiceRecordingState
  readonly startRecording: () => Promise<void>
  readonly stopRecording: () => void
} {
  const [recordingState, setRecordingState] =
    useState<VoiceRecordingState>('idle')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingSessionRef = useRef(0)
  const recordingStartedAtRef = useRef(0)
  const shouldFinalizeOnStopRef = useRef(false)
  const hotkeyRecordingRef = useRef(false)
  const recordingStateRef = useRef(recordingState)
  const onRecordingCompleteRef = useRef(onRecordingComplete)

  useEffect(() => {
    recordingStateRef.current = recordingState
  }, [recordingState])

  useEffect(() => {
    onRecordingCompleteRef.current = onRecordingComplete
  }, [onRecordingComplete])

  const discardRecording = useCallback(() => {
    audioChunksRef.current = []
    const stream = mediaStreamRef.current
    mediaStreamRef.current = null
    stream?.getTracks().forEach((track) => track.stop())
  }, [])

  const finalizeRecording = useCallback(
    async (durationSeconds: number) => {
      const chunks = audioChunksRef.current
      const audioType = chunks[0]?.type ?? 'audio/webm'
      const audioBlob = new Blob(chunks, { type: audioType })
      discardRecording()

      try {
        await onRecordingCompleteRef.current?.(audioBlob, durationSeconds)
      } catch (error) {
        console.warn('Voice recording completion handler failed.', error)
      } finally {
        setRecordingState('idle')
      }
    },
    [discardRecording],
  )

  const stopRecording = useCallback(() => {
    hotkeyRecordingRef.current = false
    recordingSessionRef.current += 1
    const recorder = mediaRecorderRef.current
    mediaRecorderRef.current = null

    if (recorder !== null && recorder.state !== 'inactive') {
      shouldFinalizeOnStopRef.current = true
      setRecordingState('transcribing')
      recorder.stop()
    } else {
      discardRecording()
      setRecordingState('idle')
    }
  }, [discardRecording])

  const startRecording = useCallback(async () => {
    if (
      typeof window === 'undefined' ||
      typeof MediaRecorder === 'undefined' ||
      navigator.mediaDevices?.getUserMedia === undefined
    ) {
      return
    }

    setRecordingState('starting')
    const recordingSession = recordingSessionRef.current + 1
    recordingSessionRef.current = recordingSession

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      if (recordingSessionRef.current !== recordingSession) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      const recorder = new MediaRecorder(stream)
      shouldFinalizeOnStopRef.current = false
      audioChunksRef.current = []
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      recordingStartedAtRef.current = performance.now()

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      })
      recorder.addEventListener(
        'stop',
        () => {
          if (shouldFinalizeOnStopRef.current) {
            shouldFinalizeOnStopRef.current = false
            void finalizeRecording(
              (performance.now() - recordingStartedAtRef.current) / 1000,
            )
            return
          }
          discardRecording()
        },
        { once: true },
      )

      recorder.start()
      setRecordingState('recording')
    } catch (error) {
      discardRecording()
      setRecordingState('idle')
      console.warn('Microphone recording failed.', error)
    }
  }, [discardRecording, finalizeRecording])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent | VoiceHotkeyEvent): void => {
      const hotkeyEvent = readVoiceHotkeyEvent(event)
      if (hotkeyEvent.repeat || !isVoiceHotkey(hotkeyEvent)) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      if (recordingStateRef.current !== 'idle') return
      hotkeyRecordingRef.current = true
      void startRecording()
    }

    const handleKeyUp = (event: KeyboardEvent | VoiceHotkeyEvent): void => {
      const hotkeyEvent = readVoiceHotkeyEvent(event)
      if (
        !hotkeyRecordingRef.current ||
        !isVoiceHotkeyReleaseKey(hotkeyEvent)
      ) {
        return
      }
      event.preventDefault()
      if (isVoiceHotkeyCharacterKey(hotkeyEvent)) {
        event.stopPropagation()
        event.stopImmediatePropagation()
      }
      hotkeyRecordingRef.current = false
      stopRecording()
    }

    const handleWindowBlur = (): void => {
      if (!hotkeyRecordingRef.current) return
      hotkeyRecordingRef.current = false
      stopRecording()
    }

    const handleForwardedKeyDown = (event: Event): void => {
      if (event instanceof CustomEvent) handleKeyDown(event as VoiceHotkeyEvent)
    }

    const handleForwardedKeyUp = (event: Event): void => {
      if (event instanceof CustomEvent) handleKeyUp(event as VoiceHotkeyEvent)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener(VOICE_HOTKEY_KEYDOWN_EVENT, handleForwardedKeyDown)
    window.addEventListener(VOICE_HOTKEY_KEYUP_EVENT, handleForwardedKeyUp)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener(
        VOICE_HOTKEY_KEYDOWN_EVENT,
        handleForwardedKeyDown,
      )
      window.removeEventListener(VOICE_HOTKEY_KEYUP_EVENT, handleForwardedKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [startRecording, stopRecording])

  useEffect(
    () => () => {
      const recorder = mediaRecorderRef.current
      mediaRecorderRef.current = null
      shouldFinalizeOnStopRef.current = false
      if (recorder !== null && recorder.state !== 'inactive') {
        recorder.stop()
        return
      }
      discardRecording()
    },
    [discardRecording],
  )

  return { recordingState, startRecording, stopRecording }
}

type VoiceHotkeyEvent = CustomEvent<VoiceHotkeyEventLike>

function readVoiceHotkeyEvent(
  event: KeyboardEvent | VoiceHotkeyEvent,
): VoiceHotkeyEventLike {
  return event instanceof CustomEvent ? event.detail : event
}
