import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';
import { appConfig } from '../../shared/config/app-config';

/**
 * El cliente de Supabase.
 *
 * Es una unica instancia global porque el cliente mantiene la sesion, el temporizador
 * de refresco del token y las conexiones de Realtime. Crear una segunda instancia
 * abriria un segundo WebSocket y un segundo temporizador compitiendo por escribir el
 * mismo token en localStorage.
 */

export type AppSupabaseClient = SupabaseClient<Database>;

let client: AppSupabaseClient | null = null;

export const getSupabaseClient = (): AppSupabaseClient => {
  if (client !== null) return client;

  if (!appConfig.supabase.isConfigured) {
    throw new Error(
      'Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Copia .env.example a .env y rellenalos.',
    );
  }

  client = createClient<Database>(appConfig.supabase.url, appConfig.supabase.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // El flujo PKCE es el correcto para clientes publicos: el `code_verifier` nunca
      // sale del dispositivo, asi que interceptar la URL de vuelta no basta para robar
      // la sesion. Importa especialmente con enlaces magicos abiertos desde el correo.
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'checklist-personal.auth',
    },
    realtime: {
      params: {
        // Un usuario, un dispositivo: no hace falta mas caudal y asi no se malgasta
        // bateria en el telefono procesando eventos.
        eventsPerSecond: 5,
      },
    },
    global: {
      headers: {
        'x-application-name': 'checklist-personal',
      },
    },
  });

  return client;
};

/** `true` si hay credenciales configuradas. La app arranca igual sin ellas, en modo local. */
export const isSupabaseConfigured = (): boolean => appConfig.supabase.isConfigured;

/** Cierra Realtime y suelta la instancia. Se usa al cerrar sesion. */
export const resetSupabaseClient = async (): Promise<void> => {
  if (client === null) return;
  await client.removeAllChannels();
  client = null;
};
