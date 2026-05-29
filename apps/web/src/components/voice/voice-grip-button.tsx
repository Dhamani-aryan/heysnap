import { useCallback } from 'react'
import { useVoiceRecording } from '../../hooks/voice/use-voice-recording.ts'
import { env } from '../../lib/env.ts'
import {
  appendPromptTranscript,
  createSarvamAudioFileName,
  extractSarvamTranscript,
  normalizeSarvamAudioMimeType,
  SARVAM_SHORT_AUDIO_MAX_SECONDS,
  transcribeBatchSarvamAudioViaGateway,
  transcribeShortSarvamAudio,
} from '../../lib/voice/sarvam-speech-to-text.ts'
import { useAgentChatStore } from '../../stores/agent/agent-chat-store.ts'
import { useAgentPromptFocusStore } from '../../stores/agent/agent-prompt-focus-store.ts'
import {
  selectPromptDraft,
  useAgentPromptDraftStore,
} from '../../stores/agent/agent-prompt-draft-store.ts'
import { getAuthToken } from '../../stores/auth/auth-store.ts'

export function VoiceGripButton() {
  const handleRecordingComplete = useCallback(
    async (audioBlob: Blob, durationSeconds: number) => {
      if (audioBlob.size === 0) {
        console.warn('Sarvam STT skipped because the recording was empty.')
        return
      }

      const normalizedType = normalizeSarvamAudioMimeType(audioBlob.type)
      const normalizedBlob =
        audioBlob.type === normalizedType
          ? audioBlob
          : audioBlob.slice(0, audioBlob.size, normalizedType)
      const fileName = createSarvamAudioFileName(normalizedType)
      const useShortAudio = durationSeconds < SARVAM_SHORT_AUDIO_MAX_SECONDS

      let result: unknown
      try {
        result = useShortAudio
          ? await (async () => {
              const apiKey = env.sarvamApiKey
              if (apiKey === undefined) {
                console.warn(
                  'Sarvam STT skipped because VITE_SARVAM_API_KEY is not set.',
                )
                return null
              }
              return transcribeShortSarvamAudio({
                apiKey,
                audioBlob: normalizedBlob,
                fileName,
              })
            })()
          : await (async () => {
              const authToken = getAuthToken()
              if (authToken === null || authToken.length === 0) {
                console.warn(
                  'Sarvam batch STT skipped because the user is not signed in.',
                )
                return null
              }
              return transcribeBatchSarvamAudioViaGateway({
                cloudServerUrl: env.cloudServerUrl,
                authToken,
                audioBlob: normalizedBlob,
                fileName,
              })
            })()
      } catch (error) {
        console.warn('Sarvam STT failed.', error)
        return
      }

      if (result === null) return
      const transcript = extractSarvamTranscript(result)
      if (transcript === null) return

      const threadId = useAgentChatStore.getState().selectedThreadId
      const draftState = useAgentPromptDraftStore.getState()
      const currentText = selectPromptDraft(threadId)(draftState).text
      const nextText = appendPromptTranscript(currentText, transcript)
      draftState.setText(threadId, nextText)
      useAgentPromptFocusStore.getState().requestFocus()
    },
    [],
  )

  const { recordingState, startRecording, stopRecording } = useVoiceRecording({
    onRecordingComplete: handleRecordingComplete,
  })

  const isRecording = recordingState === 'recording'
  const isLoading =
    recordingState === 'starting' || recordingState === 'transcribing'
  const isExpanded = recordingState !== 'idle'

  return (
    <button
      type="button"
      className="voice-grip"
      aria-label={isRecording ? 'Stop recording' : 'Start recording'}
      aria-pressed={isRecording}
      data-expanded={isExpanded ? 'true' : 'false'}
      data-recording={isRecording ? 'true' : 'false'}
      data-loading={isLoading ? 'true' : 'false'}
      onClick={() => {
        if (isLoading) return
        if (recordingState === 'idle') {
          void startRecording()
          return
        }
        stopRecording()
      }}
    >
      {isLoading ? (
        <span className="voice-grip-loading" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      ) : (
        <span className="voice-grip-dots" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <span key={index} />
          ))}
        </span>
      )}
    </button>
  )
}
