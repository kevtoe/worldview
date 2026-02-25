/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_API_KEY: string
  readonly VITE_CESIUM_ION_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
