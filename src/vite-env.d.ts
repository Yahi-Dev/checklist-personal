/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Version de package.json, inyectada por Vite en tiempo de compilacion. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_DEBUG_SYNC?: string;
  readonly VITE_SYNC_INTERVAL_MINUTES?: string;
  readonly VITE_PUBLIC_BASE?: string;
  /** 'electron' en la build de escritorio; ausente en la web. */
  readonly VITE_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
