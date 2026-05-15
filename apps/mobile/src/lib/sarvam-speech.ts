import { SARVAM_API_SUBSCRIPTION_KEY } from '@/constants/config';

const SARVAM_SPEECH_TO_TEXT_URL = 'https://api.sarvam.ai/speech-to-text';

type SarvamSpeechToTextResponse = {
  request_id: string;
  transcript: string;
  language_code?: string;
  language_probability?: number;
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

const parseSarvamError = async (response: Response): Promise<string> => {
  const fallback = `Speech-to-text failed with status ${response.status.toString()}.`;

  try {
    const body = (await response.json()) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    if (typeof body.message === 'string' && body.message.length > 0) {
      return body.message;
    }
    if (typeof body.error?.message === 'string' && body.error.message.length > 0) {
      return body.error.message;
    }
  } catch {
    return fallback;
  }

  return fallback;
};

export async function transliterateSpeech(uri: string): Promise<string> {
  if (SARVAM_API_SUBSCRIPTION_KEY.length === 0) {
    throw new Error('Missing EXPO_PUBLIC_SARVAM_API_SUBSCRIPTION_KEY.');
  }

  const formData = new FormData();
  formData.append('file', {
    uri,
    name: getAudioName(uri),
    type: getAudioType(uri),
  } as unknown as Blob);
  formData.append('model', 'saaras:v3');
  formData.append('mode', 'translit');

  const response = await fetch(SARVAM_SPEECH_TO_TEXT_URL, {
    method: 'POST',
    headers: {
      'api-subscription-key': SARVAM_API_SUBSCRIPTION_KEY,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await parseSarvamError(response));
  }

  const body = (await response.json()) as Partial<SarvamSpeechToTextResponse>;

  if (typeof body.transcript !== 'string') {
    throw new Error('Speech-to-text response did not include a transcript.');
  }

  return body.transcript;
}
