const cloudServerUrl = import.meta.env.VITE_CLOUD_SERVER_URL

if (!cloudServerUrl) {
  throw new Error(
    'VITE_CLOUD_SERVER_URL is not set. Add it to your .env or run via `pnpm dev`.',
  )
}

const chromeExtensionId = import.meta.env.VITE_CHROME_EXTENSION_ID

if (!chromeExtensionId) {
  throw new Error(
    'VITE_CHROME_EXTENSION_ID is not set. Add it to your .env or run via `pnpm dev`.',
  )
}

export const env = {
  cloudServerUrl: cloudServerUrl.replace(/\/+$/, ''),
  chromeExtensionId,
} as const
