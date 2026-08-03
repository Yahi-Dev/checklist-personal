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
  lastPulledAt: 'sync.lastPulledAt',
  lastSyncedAt: 'sync.lastSyncedAt',
  deviceId: 'sync.deviceId',
  schemaVersion: 'sync.schemaVersion',
} as const;
