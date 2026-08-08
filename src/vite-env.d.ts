/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_FEE_WALLET?: string;
  readonly VITE_FEE_BPS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
