const cloudServerUrl = import.meta.env.VITE_CLOUD_SERVER_URL

if (!cloudServerUrl) {
  throw new Error(
    'VITE_CLOUD_SERVER_URL is not set. Add it to your .env or run via `pnpm dev`.',
  )
}

export const env = {
  cloudServerUrl: cloudServerUrl.replace(/\/+$/, ''),
} as const
