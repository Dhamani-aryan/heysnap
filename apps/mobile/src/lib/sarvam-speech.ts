import { SARVAM_API_SUBSCRIPTION_KEY } from '@/constants/config';
import { env } from '@/lib/env';
import { getAuthToken } from '@/stores/auth/auth-store';

const SARVAM_API_BASE_URL = 'https://api.sarvam.ai';
const SARVAM_STT_MODEL = 'saaras:v3';
const SARVAM_STT_MODE = 'translit';
export const SARVAM_SHORT_AUDIO_MAX_SECONDS = 30;

type MobileAudioFile = {
  uri: string;
  name: string;
  type: string;
};

const getAudioType = (uri: string): string => {
  const extension = uri.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'mp3':
      return 'audio/mp3';
    case 'wav':
      return 'audio/wav';
    case 'm4a':
      return 'audio/m4a';
    case 'aac':
      return 'audio/aac';
    default:
      return 'audio/m4a';
  }
};

const getAudioName = (uri: string): string => {
  const name = uri.split('/').pop();
  return name && name.length > 0 ? name : `recording-${Date.now().toString()}.m4a`;
};

const createAudioFile = (uri: string): MobileAudioFile => ({
  uri,
  name: getAudioName(uri),
  type: getAudioType(uri),
});

const readResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();

  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const parseSpeechError = (body: unknown, fallback: string): string => {
  if (typeof body === 'string' && body.length > 0) {
    return body;
  }

  if (typeof body === 'object' && body !== null) {
    const record = body as {
      error?: { message?: unknown };
      message?: unknown;
    };
    if (typeof record.message === 'string' && record.message.length > 0) {
      return record.message;
    }
    if (typeof record.error?.message === 'string' && record.error.message.length > 0) {
      return record.error.message;
    }
  }

  return fallback;
};

const transcribeShortSarvamAudio = async (file: MobileAudioFile): Promise<unknown> => {
  if (SARVAM_API_SUBSCRIPTION_KEY.length === 0) {
    throw new Error('Missing EXPO_PUBLIC_SARVAM_API_SUBSCRIPTION_KEY.');
  }

  const formData = new FormData();
  formData.append('model', SARVAM_STT_MODEL);
  formData.append('mode', SARVAM_STT_MODE);
  formData.append('file', file as unknown as Blob);

  const response = await fetch(`${SARVAM_API_BASE_URL}/speech-to-text`, {
    method: 'POST',
    headers: {
      'api-subscription-key': SARVAM_API_SUBSCRIPTION_KEY,
    },
    body: formData,
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    throw new Error(parseSpeechError(
      body,
      `Sarvam API failed with ${response.status.toString()}.`,
    ));
  }

  return body;
};

const transcribeBatchSarvamAudioViaGateway = async (file: MobileAudioFile): Promise<unknown> => {
  const authToken = getAuthToken();

  if (authToken === null || authToken.length === 0) {
    throw new Error('Sign in is required for long voice transcription.');
  }

  const formData = new FormData();
  formData.append('file', file as unknown as Blob);

  const response = await fetch(`${env.cloudServerUrl}/sarvam/speech-to-text/batch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    body: formData,
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    throw new Error(parseSpeechError(
      body,
      `Sarvam batch gateway failed with ${response.status.toString()}.`,
    ));
  }

  return body;
};

export const extractSarvamTranscript = (result: unknown): string | null => {
  if (typeof result === 'string') {
    const trimmed = result.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  if (Array.isArray(result)) {
    const joined = result
      .map((item) => extractSarvamTranscript(item))
      .filter((transcript): transcript is string => transcript !== null)
      .join('\n')
      .trim();

    return joined.length === 0 ? null : joined;
  }

  if (typeof result !== 'object' || result === null) {
    return null;
  }

  const record = result as Record<string, unknown>;

  if (typeof record['transcript'] === 'string') {
    const transcript = record['transcript'].trim();
    return transcript.length === 0 ? null : transcript;
  }

  if ('output' in record) {
    return extractSarvamTranscript(record['output']);
  }

  if (Array.isArray(record['transcripts'])) {
    return extractSarvamTranscript(record['transcripts']);
  }

  return null;
};

export async function transliterateSpeech(
  uri: string,
  input: { durationSeconds?: number } = {},
): Promise<string> {
  const file = createAudioFile(uri);
  const result =
    input.durationSeconds !== undefined &&
    input.durationSeconds >= SARVAM_SHORT_AUDIO_MAX_SECONDS
      ? await transcribeBatchSarvamAudioViaGateway(file)
      : await transcribeShortSarvamAudio(file);
  const transcript = extractSarvamTranscript(result);

  if (transcript === null) {
    throw new Error('Speech-to-text response did not include a transcript.');
  }

  return transcript;
}
