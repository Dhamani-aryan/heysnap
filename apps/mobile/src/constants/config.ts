const DEFAULT_WEB_PREVIEW_URL = 'https://app.heysnap.xyz';

export const WEB_PREVIEW_URL: string =
  process.env.EXPO_PUBLIC_WEB_PREVIEW_URL?.trim() || DEFAULT_WEB_PREVIEW_URL;

export const SARVAM_API_SUBSCRIPTION_KEY: string =
  process.env.EXPO_PUBLIC_SARVAM_API_SUBSCRIPTION_KEY?.trim() ||
  process.env.SARVAM_API_SUBSCRIPTION_KEY?.trim() ||
  '';
