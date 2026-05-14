const DEFAULT_WEB_PREVIEW_URL = 'http://localhost:3000';

export const WEB_PREVIEW_URL: string =
  process.env.EXPO_PUBLIC_WEB_PREVIEW_URL?.trim() || DEFAULT_WEB_PREVIEW_URL;
