import type { AuthService, SyncService } from '../../application/ports/services';
import type { CurrentUser } from '../../application/ports/repositories';
import type { UseCaseContext } from '../../application/use-cases/use-case';

import type { AppDatabase } from '../persistence/database';
import { db } from '../persistence/database';
import { BrowserPlatformService, ElectronPlatformService } from '../platform/platform-service';
import { desktopBridge } from '../../shared/desktop-bridge';
import {
  DexieCategoryRepository,
  DexieFocusSessionRepository,
  DexieTagRepository,
} from '../persistence/dexie-repositories';
import { DexieTaskRepository } from '../persistence/dexie-task-repository';
import { EdgeAdvisorService, UnavailableAdvisorService } from '../assistant/edge-advisor-service';
import { ElectronNotificationService } from '../notifications/electron-notification-service';
import { getSupabaseClient, isSupabaseConfigured } from '../supabase/client';
import { LocalAuthService, NullSyncService } from '../auth/local-auth-service';
import { Outbox } from '../persistence/outbox';
import { ReminderScheduler } from '../../application/services/reminder-scheduler';
import { SupabaseAuthService } from '../supabase/supabase-auth-service';
import { SupabaseFileStorage, UnavailableFileStorage } from '../supabase/supabase-file-storage';
import { SyncEngine } from '../sync/sync-engine';
import { SystemClock } from '../../domain/shared/clock';
import { UuidGenerator } from '../../domain/shared/id-generator';
import { WebNotificationService } from '../notifications/web-notification-service';

/**
 * Raiz de composicion (Composition Root).
 *
 * Este es el UNICO sitio de toda la app donde se decide que implementacion concreta
 * usa cada puerto. Es la contrapartida practica de la inversion de dependencias: el
 * dominio y los casos de uso no importan Dexie ni Supabase en ningun archivo, y por eso
 * se pueden ejecutar enteros en un test con dobles en memoria.
 *
 * Se construye a mano, sin contenedor de inyeccion con decoradores ni reflexion. Para
 * un grafo de este tamaño, un archivo explicito que se lee de arriba abajo es mas facil
 * de seguir que la magia de un framework, y no añade dependencias.
 */

export interface AppContainer {
  readonly database: AppDatabase;
  readonly auth: AuthService;
  readonly sync: SyncService;
  readonly context: UseCaseContext;
  /** Fija el usuario activo. Lo llama el proveedor de autenticacion al cambiar la sesion. */
  setCurrentUser(user: CurrentUser | null): void;
  getCurrentUser(): CurrentUser | null;
  /** `false` cuando falta configurar Supabase: la app corre solo en local. */
  readonly isCloudEnabled: boolean;
}

let container: AppContainer | null = null;

export const createContainer = (database: AppDatabase = db): AppContainer => {
  let currentUser: CurrentUser | null = null;

  const clock = new SystemClock();
  const ids = new UuidGenerator();
  const outbox = new Outbox(database);

  const tasks = new DexieTaskRepository(database, outbox);
  const categories = new DexieCategoryRepository(database, outbox);
  const tags = new DexieTagRepository(database, outbox);
  const focusSessions = new DexieFocusSessionRepository(database, outbox);

  const bridge = desktopBridge();
  const platform =
    bridge === null ? new BrowserPlatformService() : new ElectronPlatformService(bridge);
  const notifications =
    bridge === null ? new WebNotificationService() : new ElectronNotificationService(bridge);

  const reminders = new ReminderScheduler(notifications, tasks, clock);

  const cloudEnabled = isSupabaseConfigured();

  const supabase = cloudEnabled ? getSupabaseClient() : null;

  const auth: AuthService =
    supabase === null ? new LocalAuthService() : new SupabaseAuthService(supabase);

  const files =
    supabase === null ? new UnavailableFileStorage() : new SupabaseFileStorage(supabase);

  const advisor =
    supabase === null ? new UnavailableAdvisorService() : new EdgeAdvisorService(supabase);

  const sync: SyncService =
    supabase === null
      ? new NullSyncService()
      : new SyncEngine(database, supabase, () => currentUser?.id ?? null);

  const context: UseCaseContext = {
    tasks,
    categories,
    tags,
    focusSessions,
    clock,
    ids,
    notifications,
    reminders,
    files,
    platform,
    advisor,
    currentUser: () => currentUser,
  };

  return {
    database,
    auth,
    sync,
    context,
    isCloudEnabled: cloudEnabled,
    setCurrentUser: (user) => {
      currentUser = user;
    },
    getCurrentUser: () => currentUser,
  };
};

/**
 * El contenedor de la aplicacion, creado una sola vez.
 * Se expone como funcion y no como constante para que su construccion sea perezosa:
 * asi los tests pueden montar el suyo antes de que este se inicialice.
 */
export const getContainer = (): AppContainer => {
  container ??= createContainer();
  return container;
};

/** Solo para pruebas: sustituye el contenedor global. */
export const setContainerForTesting = (replacement: AppContainer | null): void => {
  container = replacement;
};
