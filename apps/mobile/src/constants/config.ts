export const SARVAM_API_SUBSCRIPTION_KEY: string =
  process.env.EXPO_PUBLIC_SARVAM_API_SUBSCRIPTION_KEY?.trim() ||
  process.env.SARVAM_API_SUBSCRIPTION_KEY?.trim() ||
  '';
