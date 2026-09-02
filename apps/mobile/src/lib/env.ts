const DEFAULT_CLOUD_SERVER_URL = 'https://api.heysnap.xyz';

const cloudServerUrl =
  process.env.EXPO_PUBLIC_CLOUD_SERVER_URL?.trim() || DEFAULT_CLOUD_SERVER_URL;

export const env = {
  cloudServerUrl: cloudServerUrl.replace(/\/+$/, ''),
} as const;
