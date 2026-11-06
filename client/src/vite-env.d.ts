/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_SOCKET_URL: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_MAPBOX_ACCESS_TOKEN: string;
  readonly VITE_MAP_PROVIDER: string;
  readonly VITE_DEMO_ACCOUNTS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
