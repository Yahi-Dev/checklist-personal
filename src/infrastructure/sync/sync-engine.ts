import type { AppDatabase } from '../persistence/database';
import type { AppSupabaseClient } from '../supabase/client';
import type { CategoryRow, FocusSessionRow, TagRow, TaskRow } from '../supabase/database.types';
import type { IndexHints, OutboxEntry, SyncableEntity } from '../persistence/records';
import type { Result } from '../../domain/shared/result';
import type { SyncService, SyncState } from '../../application/ports/services';

import { appConfig } from '../../shared/config/app-config';
import { err, ok } from '../../domain/shared/result';
import { Outbox } from '../persistence/outbox';
import { SYNC_META_KEYS, withHints } from '../persistence/records';
import { TABLE_FOR_ENTITY } from '../supabase/database.types';
import { toDomainError } from '../../domain/shared/domain-error';
import {
  categoryToRow,
  focusSessionToRow,
  rowToCategory,
  rowToFocusSession,
  rowToTag,
  rowToTask,
  tagToRow,
  taskToRow,
} from '../supabase/mappers';

/**
 * Vista minima de una tabla de Dexie para el motor de sincronizacion.
 *
 * Las cuatro tablas guardan tipos distintos y Dexie no expone un supertipo comun para
 * `Table<T, string>`. En vez de recurrir a `any`, se declara aqui lo UNICO que el
 * motor necesita de una tabla: leer una fila por id, mirar sus campos de sincronizacion
 * y escribirla. Cualquier otra operacion queda fuera de alcance por construccion.
 */
interface SyncTable {
  get(id: string): PromiseLike<(IndexHints & { updatedAt: string }) | undefined>;
  put(value: unknown): PromiseLike<unknown>;
}

/**
 * El motor de sincronizacion.
 *
 * MODELO
 * ------
 * Offline-first con cola de salida y "gana el ultimo en escribir" por fila.
 *
 * La copia local es la fuente de verdad para LEER: la interfaz nunca espera a la red.
 * Cada escritura va a IndexedDB y deja su anotacion en la cola; el motor sube la cola
 * y baja lo que cambio en el servidor desde la ultima vez.
 *
 * POR QUE "GANA EL ULTIMO" Y NO ALGO MAS LISTO
 * --------------------------------------------
 * Los CRDT y el merge por campos resuelven el caso de varias personas editando el
 * mismo documento a la vez. Aqui hay UNA persona con dos dispositivos, y el conflicto
 * real -editar la misma tarea en el telefono y en la computadora en el mismo minuto,
 * sin conexion en medio- es rarisimo. "Gana el `updatedAt` mas reciente" se explica en
 * una frase, se depura leyendo una columna y no puede producir estados imposibles.
 * Un CRDT aqui seria varios miles de lineas para un caso que casi nunca ocurre.
 *
 * La granularidad de fila es la que hace esto seguro: como una Tarea completa (con sus
 * subtareas) vive en una sola fila, "gana el ultimo" nunca puede mezclar el titulo de
 * una version con las subtareas de otra.
 */
export class SyncEngine implements SyncService {
  private state: SyncState = {
    status: 'idle',
    lastSyncedAt: null,
    pendingOperations: 0,
    lastError: null,
  };

  private readonly listeners = new Set<(state: SyncState) => void>();
  private readonly outbox: Outbox;
  private realtimeChannel: ReturnType<AppSupabaseClient['channel']> | null = null;
  private inFlight: Promise<Result<SyncState>> | null = null;

  constructor(
    private readonly database: AppDatabase,
    private readonly supabase: AppSupabaseClient,
    private readonly getUserId: () => string | null,
  ) {
    this.outbox = new Outbox(database);
  }

  getState(): SyncState {
    return this.state;
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /**
   * Sube lo pendiente y baja lo nuevo.
   *
   * Si ya hay una sincronizacion en curso devuelve ESA misma promesa en vez de arrancar
   * otra. Sin esa proteccion, volver a la pestaña con la cola llena dispara varias
   * pasadas simultaneas que se pisan al confirmar entradas de la cola.
   */
  async sync(): Promise<Result<SyncState>> {
    if (this.inFlight !== null) return this.inFlight;

    this.inFlight = this.runSync();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async runSync(): Promise<Result<SyncState>> {
    const userId = this.getUserId();

    if (userId === null) {
      this.publish({ status: 'idle', lastError: null });
      return ok(this.state);
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.publish({ status: 'offline', pendingOperations: await this.outbox.count() });
      return ok(this.state);
    }

    this.publish({ status: 'syncing', lastError: null });

    try {
      await this.push();
      await this.pull(userId);

      const now = new Date().toISOString();
      await this.database.setMeta(SYNC_META_KEYS.lastSyncedAt, now);

      this.publish({
        status: 'idle',
        lastSyncedAt: now,
        pendingOperations: await this.outbox.count(),
        lastError: null,
      });

      return ok(this.state);
    } catch (cause) {
      const error = toDomainError(cause, 'No se pudo sincronizar.');
      this.publish({
        status: 'error',
        lastError: error.message,
        pendingOperations: await this.outbox.count(),
      });
      return err(error);
    }
  }

  // -------------------------------------------------------------------------
  // Subida
  // -------------------------------------------------------------------------

  /**
   * Envia la cola al servidor agrupada por tabla.
   *
   * Se reproduce en ORDEN de encolado, y las categorias y etiquetas van antes que las
   * tareas: una tarea puede referenciar una categoria creada sin conexion en el mismo
   * lote, y si llegara primero la tarea, la clave foranea la rechazaria.
   */
  private async push(): Promise<void> {
    const entries = await this.outbox.pending(appConfig.sync.pageSize);
    if (entries.length === 0) return;

    const order: SyncableEntity[] = ['category', 'tag', 'task', 'focusSession'];

    for (const entity of order) {
      const group = entries.filter((entry) => entry.entity === entity);
      if (group.length === 0) continue;

      await this.pushGroup(entity, group);
    }
  }

  private async pushGroup(entity: SyncableEntity, group: readonly OutboxEntry[]): Promise<void> {
    const table = TABLE_FOR_ENTITY[entity];
    const rows = group.map((entry) => this.toRow(entity, entry.payload));
    const sequences = group
      .map((entry) => entry.seq)
      .filter((seq): seq is number => seq !== undefined);

    const { error } = await this.supabase.from(table).upsert(rows as never, {
      onConflict: 'id',
      // El servidor no tiene que devolvernos lo que acabamos de mandar: ahorra ancho
      // de banda, que en datos moviles se nota.
      ignoreDuplicates: false,
    });

    if (error !== null) {
      await this.outbox.recordFailure(sequences, error.message);
      throw new Error(`Fallo al subir ${entity}: ${error.message}`);
    }

    await this.outbox.acknowledge(sequences);
    await this.markClean(
      entity,
      group.map((entry) => entry.entityId),
    );
  }

  private toRow(entity: SyncableEntity, payload: unknown): unknown {
    switch (entity) {
      case 'task':
        return taskToRow(payload as Parameters<typeof taskToRow>[0]);
      case 'category':
        return categoryToRow(payload as Parameters<typeof categoryToRow>[0]);
      case 'tag':
        return tagToRow(payload as Parameters<typeof tagToRow>[0]);
      case 'focusSession':
        return focusSessionToRow(payload as Parameters<typeof focusSessionToRow>[0]);
      default:
        throw new Error(`Entidad desconocida en la cola: ${String(entity)}`);
    }
  }

  /**
   * Baja la marca `_dirty` de lo que ya viajo al servidor.
   *
   * Sin transaccion envolvente a proposito: si el proceso se corta a mitad, unas filas
   * quedan marcadas y otras no, y el unico efecto es que la proxima subida reenvie
   * alguna fila ya sincronizada. Ese reenvio es idempotente -es un upsert por id- asi
   * que el coste de la inconsistencia es cero y no hace falta pagar el bloqueo.
   */
  private async markClean(entity: SyncableEntity, ids: readonly string[]): Promise<void> {
    const table = this.tableFor(entity);

    for (const id of ids) {
      const record = await table.get(id);
      if (record === undefined) continue;
      await table.put({ ...record, _dirty: 0 });
    }
  }

  // -------------------------------------------------------------------------
  // Bajada
  // -------------------------------------------------------------------------

  /**
   * Trae del servidor todo lo modificado desde la ultima bajada.
   *
   * La marca de agua es `server_updated_at`, NUNCA `updated_at`. La diferencia es lo
   * que hace correcta la bajada: `updated_at` lo escribe el cliente, asi que un
   * telefono con el reloj atrasado escribiria filas "en el pasado" que quedarian por
   * detras de la marca guardada y no se bajarian jamas. `server_updated_at` lo pone un
   * trigger con la hora del servidor y por eso crece siempre de forma monotona.
   *
   * Aun asi se retrocede un segundo (`pullOverlapMs`): la marca se compara con un corte
   * estricto, y una fila escrita en el mismo instante exacto que la marca guardada
   * caeria fuera de esta bajada y de todas las siguientes.
   */
  private async pull(userId: string): Promise<void> {
    const lastPulledAt = await this.database.getMeta<string>(SYNC_META_KEYS.lastPulledAt);
    const since =
      lastPulledAt === null
        ? new Date(0).toISOString()
        : new Date(Date.parse(lastPulledAt) - appConfig.sync.pullOverlapMs).toISOString();

    let watermark = lastPulledAt ?? new Date(0).toISOString();

    watermark = maxIso(watermark, await this.pullCategories(userId, since));
    watermark = maxIso(watermark, await this.pullTags(userId, since));
    watermark = maxIso(watermark, await this.pullTasks(userId, since));
    watermark = maxIso(watermark, await this.pullFocusSessions(userId, since));

    await this.database.setMeta(SYNC_META_KEYS.lastPulledAt, watermark);
  }

  private async pullTasks(userId: string, since: string): Promise<string> {
    let watermark = since;
    let offset = 0;

    for (;;) {
      const { data, error } = await this.supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .gt('server_updated_at', since)
        .order('server_updated_at', { ascending: true })
        .range(offset, offset + appConfig.sync.pageSize - 1);

      if (error !== null) throw new Error(`Fallo al bajar tareas: ${error.message}`);
      if (data === null || data.length === 0) break;

      for (const row of data as TaskRow[]) {
        const remote = rowToTask(row);
        await this.applyRemote(this.database.tasks, remote.id, remote, remote.updatedAt);
        watermark = maxIso(watermark, row.server_updated_at);
      }

      if (data.length < appConfig.sync.pageSize) break;
      offset += appConfig.sync.pageSize;
    }

    return watermark;
  }

  private async pullCategories(userId: string, since: string): Promise<string> {
    const { data, error } = await this.supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .gt('server_updated_at', since)
      .order('server_updated_at', { ascending: true });

    if (error !== null) throw new Error(`Fallo al bajar categorias: ${error.message}`);

    let watermark = since;

    for (const row of (data ?? []) as CategoryRow[]) {
      const remote = rowToCategory(row);
      await this.applyRemote(this.database.categories, remote.id, remote, remote.updatedAt);
      watermark = maxIso(watermark, row.server_updated_at);
    }

    return watermark;
  }

  private async pullTags(userId: string, since: string): Promise<string> {
    const { data, error } = await this.supabase
      .from('tags')
      .select('*')
      .eq('user_id', userId)
      .gt('server_updated_at', since)
      .order('server_updated_at', { ascending: true });

    if (error !== null) throw new Error(`Fallo al bajar etiquetas: ${error.message}`);

    let watermark = since;

    for (const row of (data ?? []) as TagRow[]) {
      const remote = rowToTag(row);
      await this.applyRemote(this.database.tags, remote.id, remote, remote.updatedAt);
      watermark = maxIso(watermark, row.server_updated_at);
    }

    return watermark;
  }

  private async pullFocusSessions(userId: string, since: string): Promise<string> {
    const { data, error } = await this.supabase
      .from('focus_sessions')
      .select('*')
      .eq('user_id', userId)
      .gt('server_updated_at', since)
      .order('server_updated_at', { ascending: true });

    if (error !== null) throw new Error(`Fallo al bajar sesiones: ${error.message}`);

    let watermark = since;

    for (const row of (data ?? []) as FocusSessionRow[]) {
      const remote = rowToFocusSession(row);
      await this.applyRemote(this.database.focusSessions, remote.id, remote, remote.updatedAt);
      watermark = maxIso(watermark, row.server_updated_at);
    }

    return watermark;
  }

  /**
   * Escribe una fila remota en la copia local resolviendo el conflicto.
   *
   * Solo hay UN caso en el que se ignora al servidor: cuando la copia local tiene
   * cambios sin subir (`_dirty`) y es mas reciente. Esa version esta en la cola y
   * ganara en la proxima subida; pisarla ahora seria perder una edicion que el usuario
   * ya dio por guardada.
   */
  private async applyRemote<T extends object>(
    table: SyncTable,
    id: string,
    remote: T,
    remoteUpdatedAt: string,
  ): Promise<void> {
    const local = await table.get(id);

    if (local !== undefined) {
      const localIsDirty = local._dirty === 1;
      const localIsNewer = Date.parse(local.updatedAt) > Date.parse(remoteUpdatedAt);

      if (localIsDirty && localIsNewer) {
        if (appConfig.sync.debug) {
          console.info('[sync] se conserva la version local mas reciente', { id });
        }
        return;
      }
    }

    await table.put(withHints(remote, false));
  }

  private tableFor(entity: SyncableEntity): SyncTable {
    switch (entity) {
      case 'task':
        return this.database.tasks;
      case 'category':
        return this.database.categories;
      case 'tag':
        return this.database.tags;
      case 'focusSession':
        return this.database.focusSessions;
      default:
        throw new Error(`Entidad desconocida: ${String(entity)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Resincronizacion completa
  // -------------------------------------------------------------------------

  /**
   * Tira la copia local y la reconstruye desde el servidor.
   *
   * Primero vacia la cola a proposito: es la salida de emergencia para cuando la copia
   * local quedo corrupta o con entradas envenenadas, y conservar esa cola solo volveria
   * a inyectar los datos malos.
   */
  async fullResync(): Promise<Result<SyncState>> {
    const userId = this.getUserId();
    if (userId === null) return ok(this.state);

    this.publish({ status: 'syncing' });

    try {
      await this.outbox.clear();
      await Promise.all([
        this.database.tasks.clear(),
        this.database.categories.clear(),
        this.database.tags.clear(),
        this.database.focusSessions.clear(),
      ]);
      await this.database.setMeta(SYNC_META_KEYS.lastPulledAt, new Date(0).toISOString());

      await this.pull(userId);

      const now = new Date().toISOString();
      await this.database.setMeta(SYNC_META_KEYS.lastSyncedAt, now);

      this.publish({ status: 'idle', lastSyncedAt: now, pendingOperations: 0, lastError: null });
      return ok(this.state);
    } catch (cause) {
      const error = toDomainError(cause, 'No se pudo rehacer la sincronizacion.');
      this.publish({ status: 'error', lastError: error.message });
      return err(error);
    }
  }

  // -------------------------------------------------------------------------
  // Tiempo real
  // -------------------------------------------------------------------------

  /**
   * Escucha los cambios del servidor por WebSocket.
   *
   * Es lo que hace que marcar una tarea en el iPhone se vea en la computadora sin
   * recargar. Realtime es un ATAJO, no la garantia: si el socket se cae o llega un
   * evento perdido, la sincronizacion periodica lo recoge igual. Por eso los eventos se
   * aplican por el mismo camino (`applyRemote`) que la bajada normal.
   */
  startRealtime(): void {
    const userId = this.getUserId();
    if (userId === null || this.realtimeChannel !== null) return;

    this.realtimeChannel = this.supabase
      .channel(`checklist:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` },
        (payload) => {
          void this.applyRealtimeTask(payload.new as TaskRow | null);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'categories', filter: `user_id=eq.${userId}` },
        (payload) => {
          void this.applyRealtimeCategory(payload.new as CategoryRow | null);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tags', filter: `user_id=eq.${userId}` },
        (payload) => {
          void this.applyRealtimeTag(payload.new as TagRow | null);
        },
      )
      .subscribe();
  }

  stopRealtime(): void {
    if (this.realtimeChannel === null) return;
    void this.supabase.removeChannel(this.realtimeChannel);
    this.realtimeChannel = null;
  }

  private async applyRealtimeTask(row: TaskRow | null): Promise<void> {
    if (row?.id === undefined) return;
    const task = rowToTask(row);
    await this.applyRemote(this.database.tasks, task.id, task, task.updatedAt);
  }

  private async applyRealtimeCategory(row: CategoryRow | null): Promise<void> {
    if (row?.id === undefined) return;
    const category = rowToCategory(row);
    await this.applyRemote(this.database.categories, category.id, category, category.updatedAt);
  }

  private async applyRealtimeTag(row: TagRow | null): Promise<void> {
    if (row?.id === undefined) return;
    const tag = rowToTag(row);
    await this.applyRemote(this.database.tags, tag.id, tag, tag.updatedAt);
  }

  // -------------------------------------------------------------------------

  private publish(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}

const maxIso = (a: string, b: string): string => (Date.parse(a) >= Date.parse(b) ? a : b);
