/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUD_SERVER_URL: string
  readonly VITE_CHROME_EXTENSION_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
