/**
 * Configuracion leida del entorno.
 *
 * Un unico punto de acceso a `import.meta.env` en toda la app. Asi el conjunto de
 * variables que existen queda documentado en un sitio, y una variable mal escrita se
 * detecta aqui en el arranque en vez de manifestarse como `undefined` a mitad de una
 * llamada de red.
 */

const readString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;

const readBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  return value.toLowerCase() === 'true' || value === '1';
};

const readNumber = (value: unknown, fallback: number): number => {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const env = import.meta.env;

const supabaseUrl = readString(env.VITE_SUPABASE_URL);
const supabaseAnonKey = readString(env.VITE_SUPABASE_ANON_KEY);

export const appConfig = {
  version: __APP_VERSION__,

  supabase: {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    /**
     * Sin credenciales la app sigue siendo utilizable: funciona en modo solo local
     * contra IndexedDB. Es lo que permite probarla antes de crear la cuenta, y evita
     * una pantalla en blanco si el `.env` esta a medias.
     */
    isConfigured: supabaseUrl.length > 0 && supabaseAnonKey.length > 0,
    /** Bucket de Storage para los adjuntos. Se crea en la migracion 0004. */
    attachmentsBucket: 'task-attachments',
  },

  push: {
    vapidPublicKey: readString(env.VITE_VAPID_PUBLIC_KEY),
    get isConfigured(): boolean {
      return readString(env.VITE_VAPID_PUBLIC_KEY).length > 0;
    },
  },

  sync: {
    debug: readBoolean(env.VITE_DEBUG_SYNC, false),
    intervalMinutes: readNumber(env.VITE_SYNC_INTERVAL_MINUTES, 5),
    /**
     * Al bajar cambios se retrocede un segundo sobre la ultima marca vista. Sin ese
     * solape, dos filas escritas en el mismo milisegundo que la marca guardada se
     * perderian para siempre en la siguiente bajada.
     */
    pullOverlapMs: 1000,
    pageSize: 500,
  },

  ui: {
    locale: 'es-DO',
    defaultTimeZone: 'America/Santo_Domingo',
  },
} as const;

export type AppConfig = typeof appConfig;
