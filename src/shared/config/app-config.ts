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

/**
 * La URL publica de la aplicacion: el origen MAS la ruta base.
 *
 * Existe porque `location.origin` a secas es una respuesta incorrecta en este proyecto,
 * y de las que fallan en silencio. En GitHub Pages la app no vive en la raiz del dominio
 * sino en `/checklist-personal/`, asi que un correo de confirmacion construido con solo
 * el origen manda al usuario a `https://yahi-dev.github.io/`, que no es esta app.
 *
 * `BASE_URL` lo inyecta Vite a partir de la opcion `base`, o sea que sale del mismo sitio
 * que sirve los archivos y no puede desincronizarse de el.
 *
 * Devuelve cadena vacia en Electron, donde la app se sirve por `file://`: ahi no hay
 * ninguna URL a la que un correo pueda volver. Quien la use tiene que tratar ese caso,
 * no inventarse una.
 */
const publicAppUrl = ((): string => {
  const override = readString(env.VITE_PUBLIC_APP_URL);
  if (override.length > 0) return `${override.replace(/\/+$/u, '')}/`;

  const origin = globalThis.location?.origin ?? '';
  if (!origin.startsWith('http')) return '';

  return new URL(readString(env.BASE_URL, '/'), origin).href;
})();

export const appConfig = {
  version: __APP_VERSION__,

  /** Donde vive esta copia de la app, tal y como la ve el navegador. */
  publicUrl: publicAppUrl,

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
    /**
     * Tope de una pasada entera. Generoso a proposito: con datos moviles malos, subir
     * varias paginas puede tardar de verdad, y cortar una sincronizacion sana solo la
     * obligaria a empezar de cero. Lo que evita es que una peticion colgada bloquee para
     * siempre el resto -que es un fallo mudo y sin arreglo salvo reiniciar-.
     */
    timeoutMs: 90_000,
  },

  ui: {
    locale: 'es-DO',
    defaultTimeZone: 'America/Santo_Domingo',
  },
} as const;

export type AppConfig = typeof appConfig;
