/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEE_BPS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
