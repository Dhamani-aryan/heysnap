const DEFAULT_WEB_PREVIEW_URL = 'https://app.heysnap.xyz';

export const WEB_PREVIEW_URL: string =
  process.env.EXPO_PUBLIC_WEB_PREVIEW_URL?.trim() || DEFAULT_WEB_PREVIEW_URL;
