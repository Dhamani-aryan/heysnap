const SARVAM_API_BASE_URL = 'https://api.sarvam.ai'
export const SARVAM_SHORT_AUDIO_MAX_SECONDS = 30
const SARVAM_STT_MODEL = 'saaras:v3'
const SARVAM_STT_MODE = 'translit'

export const getPreferredRecordingMimeType = (): string | undefined => {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof MediaRecorder.isTypeSupported !== 'function'
  ) {
    return undefined
  }

  return [
    'audio/ogg;codecs=opus',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType))
}

export const normalizeSarvamAudioMimeType = (mimeType: string): string => {
  const normalizedMimeType = mimeType.toLowerCase().split(';')[0]?.trim() ?? ''

  if (
    normalizedMimeType === 'audio/webm' ||
    normalizedMimeType === 'video/webm'
  ) {
    return 'audio/webm'
  }

  if (
    normalizedMimeType === 'audio/ogg' ||
    normalizedMimeType === 'audio/opus'
  ) {
    return normalizedMimeType
  }

  if (
    normalizedMimeType === 'audio/mp4' ||
    normalizedMimeType === 'audio/x-m4a'
  ) {
    return normalizedMimeType
  }

  if (
    normalizedMimeType === 'audio/wav' ||
    normalizedMimeType === 'audio/x-wav' ||
    normalizedMimeType === 'audio/wave'
  ) {
    return normalizedMimeType
  }

  if (
    normalizedMimeType === 'audio/mpeg' ||
    normalizedMimeType === 'audio/mp3'
  ) {
    return normalizedMimeType
  }

  return 'audio/webm'
}

export const createSarvamAudioFileName = (mimeType: string): string => {
  const extension = getAudioFileExtension(mimeType)
  return `heysnap-recording-${Date.now()}.${extension}`
}

const getAudioFileExtension = (mimeType: string): string => {
  const normalizedMimeType = mimeType.toLowerCase()
  if (normalizedMimeType.includes('ogg')) return 'ogg'
  if (normalizedMimeType.includes('mp4')) return 'm4a'
  if (normalizedMimeType.includes('mpeg') || normalizedMimeType.includes('mp3'))
    return 'mp3'
  if (normalizedMimeType.includes('wav')) return 'wav'
  return 'webm'
}

export const transcribeBatchSarvamAudioViaGateway = async ({
  cloudServerUrl,
  authToken,
  audioBlob,
  fileName,
}: {
  readonly cloudServerUrl: string
  readonly authToken: string
  readonly audioBlob: Blob
  readonly fileName: string
}): Promise<unknown> => {
  const formData = new FormData()
  formData.set('file', audioBlob, fileName)

  const endpoint = `${cloudServerUrl}/sarvam/speech-to-text/batch`
  console.info('[sarvam] POST', endpoint, {
    sizeBytes: audioBlob.size,
    mimeType: audioBlob.type,
    fileName,
  })
  const startedAt = performance.now()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    body: formData,
  })
  console.info(
    '[sarvam] response',
    response.status,
    `(${Math.round(performance.now() - startedAt)}ms)`,
  )

  const text = await response.text()
  const body: unknown =
    text.length === 0
      ? null
      : (() => {
          try {
            return JSON.parse(text) as unknown
          } catch {
            return text
          }
        })()

  if (!response.ok) {
    const message =
      body !== null &&
      typeof body === 'object' &&
      'error' in body &&
      typeof (body as { error: unknown }).error === 'object' &&
      (body as { error: { message?: unknown } }).error !== null &&
      typeof (body as { error: { message?: unknown } }).error.message === 'string'
        ? (body as { error: { message: string } }).error.message
        : typeof body === 'string'
          ? body
          : JSON.stringify(body)
    throw new Error(
      `Sarvam batch gateway failed with ${String(response.status)}: ${message}`,
    )
  }

  return body
}

export const transcribeShortSarvamAudio = async ({
  apiKey,
  audioBlob,
  fileName,
}: {
  readonly apiKey: string
  readonly audioBlob: Blob
  readonly fileName: string
}): Promise<unknown> => {
  const formData = new FormData()
  formData.set('model', SARVAM_STT_MODEL)
  formData.set('mode', SARVAM_STT_MODE)
  formData.set('file', audioBlob, fileName)

  const response = await fetch(`${SARVAM_API_BASE_URL}/speech-to-text`, {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
    },
    body: formData,
  })

  const text = await response.text()
  const body: unknown =
    text.length === 0
      ? null
      : (() => {
          try {
            return JSON.parse(text) as unknown
          } catch {
            return text
          }
        })()

  if (!response.ok) {
    throw new Error(
      `Sarvam API failed with ${response.status}: ${
        typeof body === 'string' ? body : JSON.stringify(body)
      }`,
    )
  }

  return body
}

export const extractSarvamTranscript = (result: unknown): string | null => {
  if (typeof result === 'string') {
    const trimmed = result.trim()
    return trimmed.length === 0 ? null : trimmed
  }

  if (Array.isArray(result)) {
    const joined = result
      .map((item) => extractSarvamTranscript(item))
      .filter((transcript): transcript is string => transcript !== null)
      .join('\n')
      .trim()

    return joined.length === 0 ? null : joined
  }

  if (typeof result !== 'object' || result === null) {
    return null
  }

  const record = result as Record<string, unknown>

  if (typeof record['transcript'] === 'string') {
    const transcript = record['transcript'].trim()
    return transcript.length === 0 ? null : transcript
  }

  if ('output' in record) {
    return extractSarvamTranscript(record['output'])
  }

  if (Array.isArray(record['transcripts'])) {
    return extractSarvamTranscript(record['transcripts'])
  }

  return null
}

export const appendPromptTranscript = (
  draft: string,
  transcript: string,
): string => {
  const trimmedTranscript = transcript.trim()
  if (trimmedTranscript.length === 0) return draft
  const trimmedDraft = draft.trimEnd()
  return trimmedDraft.length === 0
    ? trimmedTranscript
    : `${trimmedDraft}\n${trimmedTranscript}`
}
