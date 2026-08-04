import type { Category } from '../../domain/category/category';
import type { FocusSession } from '../../domain/focus/focus-session';
import type { Tag } from '../../domain/tag/tag';
import type { Task } from '../../domain/task/task';

/**
 * Como se guardan las entidades en IndexedDB.
 *
 * Se persiste el objeto de dominio TAL CUAL, sin traducir nombres de campos. Es
 * posible porque el dominio son datos planos e inmutables, y evita mantener un
 * mapeador entero que solo sirviera para renombrar `dueAt` a `due_at` y de vuelta.
 *
 * Lo unico que se añade son campos con prefijo `_`, que existen solo porque IndexedDB
 * no sabe indexar `null` ni booleanos: no forman parte del dominio y se quitan al leer.
 */

export interface IndexHints {
  /** 0 o 1: IndexedDB no puede indexar `deletedAt === null`. */
  readonly _deleted: 0 | 1;
  /** 0 o 1: hay cambios locales todavia sin subir. */
  readonly _dirty: 0 | 1;
}

export type TaskRecord = Task & IndexHints;
export type CategoryRecord = Category & IndexHints;
export type TagRecord = Tag & IndexHints;
export type FocusSessionRecord = FocusSession & IndexHints;

/**
 * Añade los campos de indexado.
 *
 * `T extends object` y no `{ deletedAt?: string | null }` porque las sesiones de
 * concentracion no tienen borrado logico: una sesion pasada es historico, no algo que
 * se borre. Exigir el campo obligaria a inventarle uno que nunca se usa.
 */
export const withHints = <T extends object>(entity: T, dirty: boolean): T & IndexHints => {
  const deletedAt = (entity as { deletedAt?: string | null }).deletedAt;

  return {
    ...entity,
    _deleted: deletedAt == null ? 0 : 1,
    _dirty: dirty ? 1 : 0,
  };
};

/** Quita los campos auxiliares antes de devolver la entidad al dominio. */
export const stripHints = <T extends object>(record: T & Partial<IndexHints>): T => {
  const { _deleted: _d, _dirty: _y, ...entity } = record as T & IndexHints;
  return entity as T;
};

/** Tipos de entidad que viajan por la cola de sincronizacion. */
export const SYNCABLE_ENTITIES = ['task', 'category', 'tag', 'focusSession'] as const;

export type SyncableEntity = (typeof SYNCABLE_ENTITIES)[number];

/**
 * Una operacion local pendiente de subir (patron Outbox).
 *
 * Sin esta cola, una escritura hecha sin conexion se perderia en cuanto se cerrara la
 * app: la copia local la tendria, pero nada recordaria que hay que enviarla. La cola
 * es lo que convierte "guardado en este dispositivo" en "guardado de verdad".
 */
export interface OutboxEntry {
  /** Autoincremental: preserva el ORDEN en que ocurrieron las operaciones. */
  seq?: number;
  entity: SyncableEntity;
  entityId: string;
  operation: 'upsert' | 'delete';
  /** Foto completa de la entidad en el momento de encolar. */
  payload: unknown;
  updatedAt: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

/** Estado del motor de sincronizacion, persistido entre arranques. */
export interface SyncMetaRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export const SYNC_META_KEYS = {
  /** @deprecated Marca unica heredada. Se lee una sola vez para migrar a las de abajo. */
  lastPulledAt: 'sync.lastPulledAt',
  lastSyncedAt: 'sync.lastSyncedAt',
  deviceId: 'sync.deviceId',
  schemaVersion: 'sync.schemaVersion',
} as const;

/**
 * Hasta donde se ha bajado CADA tabla.
 *
 * Antes habia UNA marca para las cuatro, calculada como el maximo de todas, y eso perdia
 * filas de verdad: si la categoria mas nueva era de las 15:00 y la tarea mas nueva de las
 * 14:00, la marca quedaba en las 15:00, y una tarea escrita a las 14:30 desde otro
 * dispositivo ya nunca entraba en el rango de ninguna bajada posterior.
 *
 * Tampoco resistia un fallo a medias: si `tasks` reventaba despues de que `categories`
 * hubiera ido bien, o se guardaba una marca que las tareas no habian alcanzado, o se
 * perdia el avance de las categorias. Con una marca por tabla, cada una avanza solo
 * cuando su propia bajada termino entera.
 */
const PULL_CURSOR_TABLE: Record<SyncableEntity, string> = {
  task: 'tasks',
  category: 'categories',
  tag: 'tags',
  focusSession: 'focusSessions',
};

/**
 * LA MARCA VA POR TABLA **Y POR CUENTA**.
 *
 * Lo de la cuenta arregla un fallo silencioso y grave. La marca vivia en una clave fija
 * del dispositivo, asi que sobrevivia al cambio de usuario: si en este aparato hubo antes
 * otra sesion que ya habia bajado hasta las 18:00 del martes, la cuenta nueva heredaba esa
 * marca y solo pedia "lo cambiado despues del martes a las 18:00". Todo lo anterior -que
 * para esa cuenta es sencillamente TODO- no se bajaba nunca. El dispositivo se quedaba con
 * una version parcial de la realidad y no habia forma de que se recuperara solo.
 *
 * Al llevar el `userId` dentro, una cuenta sin marca propia empieza desde el principio y
 * se baja su historico entero. Esa es tambien la razon de que no se herede la marca unica
 * antigua: al actualizar, cada dispositivo hace una bajada completa, y eso es exactamente
 * lo que hace falta para que los que ya divergieron vuelvan a coincidir. Se paga una vez.
 */
export const pullCursorKey = (entity: SyncableEntity, userId: string): string =>
  `sync.pull.${PULL_CURSOR_TABLE[entity]}.${userId}`;
