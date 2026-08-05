import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { Table } from 'dexie';

import type { CategoryId } from '../../domain/shared/branded';
import type { Task } from '../../domain/task/task';

import type { AppDatabase } from '../persistence/database';
import type { AppSupabaseClient } from '../supabase/client';
import type { CategoryRow, FocusSessionRow, TagRow, TaskRow } from '../supabase/database.types';
import type { IndexHints, OutboxEntry, SyncableEntity } from '../persistence/records';
import type { Result } from '../../domain/shared/result';
import type { SyncService, SyncState } from '../../application/ports/services';

import { appConfig } from '../../shared/config/app-config';
import { brandId } from '../../domain/shared/branded';
import { err, ok } from '../../domain/shared/result';
import { Outbox } from '../persistence/outbox';
import {
  pullCursorKey,
  stripHints,
  SYNC_META_KEYS,
  SYNCABLE_ENTITIES,
  withHints,
} from '../persistence/records';
import { TABLE_FOR_ENTITY } from '../supabase/database.types';
import { DomainErrors, toDomainError } from '../../domain/shared/domain-error';
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
  delete(id: string): PromiseLike<void>;
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
    blockedOperations: 0,
    blockedReason: null,
  };

  private readonly listeners = new Set<(state: SyncState) => void>();
  private readonly outbox: Outbox;
  private realtimeChannel: ReturnType<AppSupabaseClient['channel']> | null = null;
  /** El socket estuvo caido: al volver hay que bajar lo que paso mientras tanto. */
  private realtimeWasDropped = false;
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

    const attempt = this.withDeadline(this.runSync());
    this.inFlight = attempt;

    try {
      return await attempt;
    } finally {
      if (this.inFlight === attempt) this.inFlight = null;
    }
  }

  /**
   * Le pone un tope a la pasada para que la puerta no se quede cerrada por dentro.
   *
   * `inFlight` solo se libera cuando la promesa termina, asi que una peticion que no
   * resuelva NUNCA -y las hay: un movil que pasa de wifi a datos deja sockets colgados sin
   * error ni cierre- dejaba el campo ocupado para siempre. A partir de ahi cada disparador
   * -el intervalo, volver a la app, recuperar conexion- recibia esa misma promesa muerta y
   * no pasaba nada. La app dejaba de sincronizar hasta reiniciarla, sin ningun sintoma
   * salvo que los datos se quedaban viejos.
   *
   * Vencido el plazo se abre la puerta aunque la pasada anterior siga por ahi. Puede haber
   * solape, y es un precio aceptable: todas las operaciones son idempotentes -upsert por
   * id, y la cola se confirma por `seq`-, mientras que quedarse mudo no tiene arreglo.
   */
  private withDeadline(work: Promise<Result<SyncState>>): Promise<Result<SyncState>> {
    return new Promise<Result<SyncState>>((resolve) => {
      const timer = setTimeout(() => {
        this.publish({ status: 'error', lastError: 'La sincronizacion tardo demasiado.' });
        resolve(err(DomainErrors.infrastructure('La sincronizacion tardo demasiado.')));
      }, appConfig.sync.timeoutMs);

      void work.then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (cause: unknown) => {
          clearTimeout(timer);
          resolve(err(toDomainError(cause, 'No se pudo sincronizar.')));
        },
      );
    });
  }

  private async runSync(): Promise<Result<SyncState>> {
    const userId = this.getUserId();

    if (userId === null) {
      this.publish({ status: 'idle', lastError: null });
      return ok(this.state);
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.publish({ status: 'offline', ...(await this.queueSummary()) });
      return ok(this.state);
    }

    this.publish({ status: 'syncing', lastError: null });

    /**
     * SUBIDA Y BAJADA SON INDEPENDIENTES.
     *
     * Antes iban encadenadas con await en el mismo try, y eso convertia cualquier fila
     * rechazada en una averia total: una sola tarea que RLS no aceptara tumbaba el push,
     * la excepcion saltaba por encima del pull, y el dispositivo dejaba de RECIBIR
     * ademas de dejar de enviar. El usuario veia una app que no se enteraba de nada
     * hecho en el otro aparato, cuando el problema estaba en una fila suya.
     *
     * Ahora cada sentido se intenta por su cuenta. Si la subida falla, la bajada sigue
     * corriendo: al menos se ve lo que hacen los demas dispositivos mientras se arregla
     * lo de aqui. Y el error se conserva para enseñarlo.
     */
    const failures: string[] = [];

    try {
      await this.reconcileDuplicates();
    } catch (cause) {
      failures.push(toDomainError(cause, 'No se pudo reconciliar.').message);
    }

    try {
      await this.push();
    } catch (cause) {
      failures.push(toDomainError(cause, 'No se pudo subir.').message);
    }

    try {
      await this.pull(userId);
    } catch (cause) {
      failures.push(toDomainError(cause, 'No se pudo bajar.').message);
    }

    /**
     * SEGUNDA RECONCILIACION, DESPUES DE BAJAR.
     *
     * Es la que resuelve el caso de verdad. Una categoria local solo se revela como
     * duplicada cuando llega su gemela del servidor, y eso pasa en la bajada que acaba de
     * terminar: reconciliar unicamente antes de subir dejaba el arreglo para la
     * sincronizacion siguiente, y mientras tanto el dispositivo seguia dando errores.
     *
     * Solo se vuelve a subir si de verdad se fundio algo, para no hacer un viaje de mas en
     * las sincronizaciones normales, que son la inmensa mayoria.
     */
    try {
      if (await this.reconcileDuplicates()) await this.push();
    } catch (cause) {
      failures.push(toDomainError(cause, 'No se pudo reconciliar.').message);
    }

    const queue = await this.queueSummary();

    if (failures.length > 0) {
      const message = failures.join(' · ');
      this.publish({ status: 'error', lastError: message, ...queue });
      return err(DomainErrors.infrastructure(message));
    }

    const now = new Date().toISOString();
    await this.database.setMeta(SYNC_META_KEYS.lastSyncedAt, now);

    this.publish({ status: 'idle', lastSyncedAt: now, lastError: null, ...queue });

    return ok(this.state);
  }

  /**
   * Como esta la cola: lo que sigue en camino y lo que se quedo por el camino.
   *
   * Se calcula en un solo sitio para que el indicador no pueda contradecirse consigo
   * mismo segun por donde haya pasado la sincronizacion.
   */
  private async queueSummary(): Promise<Pick<SyncState, 'pendingOperations' | 'blockedOperations' | 'blockedReason'>> {
    const blocked = await this.outbox.poisoned();
    const [first] = blocked;

    return {
      pendingOperations: await this.outbox.pendingCount(),
      blockedOperations: blocked.length,
      blockedReason: first?.lastError ?? null,
    };
  }

  async retryBlocked(): Promise<Result<SyncState>> {
    await this.outbox.retryPoisoned();
    return this.sync();
  }

  // -------------------------------------------------------------------------
  // Reconciliacion
  // -------------------------------------------------------------------------

  /**
   * Funde las categorias y etiquetas locales que DUPLICAN a las del servidor.
   *
   * EL CASO REAL, QUE NO ES HIPOTETICO.
   *
   * Un dispositivo recien instalado sembraba sus cinco categorias por defecto -"Personal",
   * "Trabajo"...- antes de bajar nada. La cuenta ya tenia esas mismas cinco creadas en otro
   * aparato, con los mismos nombres y OTROS identificadores. El servidor tiene un indice
   * unico por (usuario, nombre en minusculas), asi que las locales no podian subir jamas:
   * no es un fallo transitorio, es un choque permanente.
   *
   * Y no se quedaba ahi. Las tareas creadas en ese dispositivo apuntaban a la categoria
   * local, que no existe en el servidor, asi que ADEMAS fallaban por clave foranea. De ahi
   * la lluvia de 409 en las dos tablas a la vez.
   *
   * Sembrar despues de la primera bajada evita que vuelva a pasar, pero no arregla los
   * duplicados que ya existen en los dispositivos. Esto si.
   *
   * SOLO SE FUNDE UN CASO, Y LA ESTRECHEZ ES DELIBERADA: una categoria que NUNCA llego al
   * servidor contra otra con el mismo nombre que SI vino de el. Ahi no hay ambiguedad
   * posible sobre cual sobra. Si las dos son locales no se toca nada: no habria forma de
   * saber cual conservar, y equivocarse aqui significa borrar algo del usuario.
   *
   * La local se borra del todo en vez de marcarse como borrada: nunca existio en el
   * servidor, asi que no hay nada que propagar y subir una fila borrada solo dejaria basura.
   */
  /** Devuelve `true` si fundio algo, para que quien llama sepa si hay que volver a subir. */
  private async reconcileDuplicates(): Promise<boolean> {
    const categorias = await this.mergeDuplicates('category', this.database.categories, (row) =>
      row.name.trim().toLowerCase(),
    );

    // El servidor deduplica las etiquetas por `slug`, no por nombre: "Urgente" y "urgente"
    // son la misma. Se usa la misma clave que el indice para no fundir de mas ni de menos.
    const etiquetas = await this.mergeDuplicates('tag', this.database.tags, (row) =>
      row.slug.trim().toLowerCase(),
    );

    return categorias || etiquetas;
  }

  private async mergeDuplicates<T extends { id: string } & IndexHints>(
    entity: 'category' | 'tag',
    table: Table<T, string>,
    keyOf: (row: T) => string,
  ): Promise<boolean> {
    const rows = (await table.toArray()).filter((row) => row._deleted !== 1);
    let merged = false;

    const groups = new Map<string, T[]>();
    for (const row of rows) {
      const key = keyOf(row);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    for (const group of groups.values()) {
      if (group.length < 2) continue;

      const keeper = group.find((row) => row._dirty === 0);
      if (keeper === undefined) continue;

      for (const duplicate of group) {
        if (duplicate.id === keeper.id || duplicate._dirty !== 1) continue;

        if (entity === 'category') await this.repointTasks(duplicate.id, keeper.id);

        await this.outbox.forget(entity, duplicate.id);
        await table.delete(duplicate.id);

        merged = true;

        if (appConfig.sync.debug) {
          console.info('[sync] duplicado fundido', { entity, de: duplicate.id, a: keeper.id });
        }
      }
    }

    return merged;
  }

  /**
   * Manda las tareas de la categoria duplicada a la que se conserva.
   *
   * Sin esto, fundir la categoria dejaria las tareas apuntando a un identificador que ya no
   * existe en ninguna parte: perderian su categoria en la pantalla y seguirian sin poder
   * subir, que es exactamente el problema que se venia a resolver.
   */
  private async repointTasks(from: string, to: string): Promise<void> {
    const affected = await this.database.tasks.where('categoryId').equals(from).toArray();
    const now = new Date().toISOString();

    for (const record of affected) {
      const moved = withHints(
        { ...stripHints<Task>(record), categoryId: brandId<CategoryId>(to), updatedAt: now },
        true,
      );
      await this.database.tasks.put(moved);
      await this.outbox.enqueue('task', record.id, 'upsert', stripHints(moved), now);
    }
  }

  // -------------------------------------------------------------------------
  // Subida
  // -------------------------------------------------------------------------

  /**
   * Envia la cola al servidor agrupada por tabla.
   *
   * Las categorias y etiquetas van antes que las tareas: una tarea puede referenciar una
   * categoria creada sin conexion en el mismo lote, y si llegara primero la tarea, la
   * clave foranea la rechazaria.
   *
   * CADA TABLA VA EN SU PROPIO INTENTO, Y ESTO ES LO IMPORTANTE.
   *
   * Antes el bucle no atrapaba nada, asi que la primera tabla que fallara abortaba las
   * siguientes. Como las categorias van las primeras, UNA sola categoria que el servidor
   * rechazara -por ejemplo una heredada de otra sesion, que RLS rechaza siempre- impedia
   * que se intentaran siquiera las tareas. Para siempre, en silencio, y sin que el
   * dispositivo diera ninguna señal: sus tareas se veian bien en local y no existian en
   * ningun otro sitio.
   *
   * Ese fallo en cadena es exactamente lo que hacia que un dispositivo se quedara con una
   * version distinta de la realidad que los demas. Ahora una tabla atascada solo se
   * atasca a si misma.
   */
  private async push(): Promise<void> {
    const entries = await this.outbox.pending(appConfig.sync.pageSize);
    if (entries.length === 0) return;

    const order: SyncableEntity[] = ['category', 'tag', 'task', 'focusSession'];
    const failures: string[] = [];

    for (const entity of order) {
      const group = entries.filter((entry) => entry.entity === entity);
      if (group.length === 0) continue;

      try {
        await this.pushGroup(entity, group);
      } catch (cause) {
        failures.push(toDomainError(cause, `No se pudo subir ${entity}.`).message);
      }
    }

    if (failures.length > 0) throw new Error(failures.join(' · '));
  }

  /**
   * Sube un grupo y confirma SOLO lo que el servidor acepto.
   *
   * Lo rechazado se queda en la cola con su motivo propio; lo aceptado se confirma y se
   * marca limpio aunque en el mismo lote hubiera filas malas.
   */
  private async pushGroup(entity: SyncableEntity, group: readonly OutboxEntry[]): Promise<void> {
    const rejected = new Map<number, string>();
    await this.upsertIsolating(entity, group, rejected);

    const accepted = group.filter((entry) => entry.seq === undefined || !rejected.has(entry.seq));

    await this.outbox.acknowledge(
      accepted.map((entry) => entry.seq).filter((seq): seq is number => seq !== undefined),
    );
    await this.markClean(entity, accepted);

    if (rejected.size === 0) return;

    await this.outbox.recordFailures(rejected);

    const [motivo] = [...rejected.values()];
    throw new Error(
      `${String(rejected.size)} de ${String(group.length)} en ${entity}: ${motivo ?? 'rechazadas'}`,
    );
  }

  /**
   * Sube el lote y, si el servidor lo rechaza, encuentra las filas culpables.
   *
   * Postgres rechaza la SENTENCIA entera, no la fila mala. Un upsert de 500 tareas en el
   * que una sola viole RLS o un `check` no sube ninguna de las otras 499, y como el
   * fallo se apuntaba a las 500 por igual, diez pasadas despues la cola entera quedaba
   * descartada -culpables e inocentes- con un motivo que casi ninguna habia provocado.
   *
   * Se parte el lote en dos y se reintenta cada mitad hasta aislar la fila concreta. Son
   * unas nueve peticiones para una fila mala entre 500, en vez de las 500 que costaria ir
   * de una en una. Es seguro porque un upsert por id es idempotente: reenviar una fila ya
   * aceptada no cambia nada.
   *
   * SOLO se parte cuando el error es DE FILA. Si se cae la red o caduca la sesion no hay
   * ninguna fila culpable, y bisecar entonces multiplicaria las peticiones para acabar
   * castigando a filas perfectamente validas: unas cuantas tardes con mala señal bastaban
   * para descartar la cola entera. Ese caso sale por arriba sin tocar los contadores.
   */
  private async upsertIsolating(
    entity: SyncableEntity,
    group: readonly OutboxEntry[],
    rejected: Map<number, string>,
  ): Promise<void> {
    if (group.length === 0) return;

    const rows = group.map((entry) => this.toRow(entity, entry.payload));

    const { error } = await this.supabase.from(TABLE_FOR_ENTITY[entity]).upsert(rows as never, {
      onConflict: 'id',
      // El servidor no tiene que devolvernos lo que acabamos de mandar: ahorra ancho
      // de banda, que en datos moviles se nota.
      ignoreDuplicates: false,
    });

    if (error === null) return;

    if (!isRowRejection(error.code)) {
      throw new Error(`Fallo al subir ${entity}: ${error.message}`);
    }

    if (group.length === 1) {
      const [entry] = group;
      if (entry?.seq !== undefined) rejected.set(entry.seq, error.message);
      return;
    }

    const middle = Math.floor(group.length / 2);
    await this.upsertIsolating(entity, group.slice(0, middle), rejected);
    await this.upsertIsolating(entity, group.slice(middle), rejected);
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
  private async markClean(entity: SyncableEntity, entries: readonly OutboxEntry[]): Promise<void> {
    const table = this.tableFor(entity);

    for (const entry of entries) {
      const record = await table.get(entry.entityId);
      if (record === undefined) continue;

      /**
       * SOLO SI LA FILA SIGUE SIENDO LA QUE VIAJO.
       *
       * Entre que se envia el lote y llega la respuesta pasan cientos de milisegundos -en
       * datos moviles, segundos-, y en ese hueco el usuario puede editar la misma tarea.
       * Marcarla limpia entonces era declarar subido algo que el servidor no ha visto: la
       * bajada de ese mismo ciclo la trataba como una fila sin cambios locales y le pasaba
       * por encima la version antigua del servidor. La edicion desaparecia delante del
       * usuario, segundos despues de hacerla y sin ningun aviso.
       *
       * La edicion nueva ya tiene su propia anotacion en la cola, asi que dejarla sucia no
       * pierde nada: sube en la pasada siguiente.
       */
      if (Date.parse(record.updatedAt) > Date.parse(entry.updatedAt)) continue;

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
    // Categorias y etiquetas antes que las tareas, por el mismo motivo que al subir: una
    // tarea que llega antes que su categoria se pinta un instante sin ella.
    await this.pullEntity('category', userId, (since) => this.pullCategories(userId, since));
    await this.pullEntity('tag', userId, (since) => this.pullTags(userId, since));
    await this.pullEntity('task', userId, (since) => this.pullTasks(userId, since));
    await this.pullEntity('focusSession', userId, (since) =>
      this.pullFocusSessions(userId, since),
    );
  }

  /**
   * Baja una tabla y avanza SU marca de agua, solo si termino entera.
   *
   * Guardar la marca dentro de este metodo -y no una comun al final- es lo que hace que
   * un fallo a mitad no mienta: si las tareas revientan despues de que las categorias
   * fueran bien, las categorias conservan su avance y las tareas reintentan desde donde
   * estaban. Con una marca unica habia que elegir entre perder el avance de una o dar por
   * bajada una tabla que no lo estaba.
   */
  private async pullEntity(
    entity: SyncableEntity,
    userId: string,
    fetch: (since: string) => Promise<string>,
  ): Promise<void> {
    const key = pullCursorKey(entity, userId);
    const cursor = (await this.database.getMeta<string>(key)) ?? EPOCH;

    const watermark = await fetch(sinceFor(cursor));

    // Nunca hacia atras: `fetch` devuelve el `since` recibido cuando no hubo filas, y ese
    // valor lleva el solape restado. Guardarlo tal cual retrocederia la marca un segundo
    // en cada pasada, y a base de pasadas se acabaria rebajando el catalogo entero.
    await this.database.setMeta(key, maxIso(cursor, watermark));
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
        // El `id` como desempate no es decorativo: varias tareas guardadas de una vez
        // comparten `server_updated_at` al milisegundo, y sin un segundo criterio el orden
        // entre ellas queda a merced del plan de consulta. Dos paginas pedidas con el
        // mismo orden inestable pueden repetir una fila y saltarse otra.
        .order('server_updated_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + appConfig.sync.pageSize - 1);

      if (error !== null) throw new Error(`Fallo al bajar tareas: ${error.message}`);
      if (data === null || data.length === 0) break;

      for (const row of data as TaskRow[]) {
        const remote = rowToTask(row);
        await this.applyRemote(this.database.tasks, 'task', remote.id, remote, remote.updatedAt);
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
      await this.applyRemote(this.database.categories, 'category', remote.id, remote, remote.updatedAt);
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
      await this.applyRemote(this.database.tags, 'tag', remote.id, remote, remote.updatedAt);
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
      await this.applyRemote(this.database.focusSessions, 'focusSession', remote.id, remote, remote.updatedAt);
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
    entity: SyncableEntity,
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

      /**
       * GANA EL SERVIDOR: HAY QUE RETIRAR TAMBIEN LA ANOTACION LOCAL.
       *
       * Bajar `_dirty` a 0 no bastaba. La entrada de la cola seguia ahi con la foto vieja,
       * y en la siguiente subida esa foto viajaba al servidor y REVERTIA el cambio que se
       * acababa de aceptar -para todos los dispositivos, no solo para este-. El sintoma
       * era desconcertante: la fecha aparecia correcta y unos minutos despues se deshacia
       * sola, o una tarea completada volvia a estar pendiente sin que nadie la tocara.
       *
       * Se descarta solo lo que quedo obsoleto. Si el usuario ha vuelto a editar mientras
       * tanto, su anotacion es mas nueva que la del servidor y tiene que subir igual.
       */
      if (localIsDirty) {
        await this.outbox.discardStale(entity, id, remoteUpdatedAt);
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
      /**
       * SE INTENTA SUBIR ANTES DE BORRAR NADA.
       *
       * Faltaba, y convertia el boton de auxilio en el mas destructivo de la app. Quien
       * llega aqui suele ser justo quien tiene cambios que no han conseguido subir; borrar
       * la cola de entrada los perdia definitivamente, y encima sin avisar, porque desde
       * fuera esto se lee como "vuelve a bajarlo todo", no como "tira lo que no subio".
       *
       * Si la subida falla, se sigue igualmente: puede ser precisamente una fila corrupta
       * lo que hay que limpiar. Pero se intenta primero, que es gratis.
       */
      try {
        await this.push();
      } catch {
        /* Lo que no suba se pierde en el borrado: es el precio explicito de esta salida. */
      }

      await this.outbox.clear();
      await Promise.all([
        this.database.tasks.clear(),
        this.database.categories.clear(),
        this.database.tags.clear(),
        this.database.focusSessions.clear(),
      ]);
      for (const entity of SYNCABLE_ENTITIES) {
        await this.database.setMeta(pullCursorKey(entity, userId), EPOCH);
      }

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

    const filter = `user_id=eq.${userId}`;
    const watch = { event: '*', schema: 'public', filter } as const;

    this.realtimeChannel = this.supabase
      .channel(`checklist:${userId}`)
      .on('postgres_changes', { ...watch, table: 'tasks' }, (payload) => {
        void this.applyRealtimeChange(this.database.tasks, 'task', payload, rowToTask);
      })
      .on('postgres_changes', { ...watch, table: 'categories' }, (payload) => {
        void this.applyRealtimeChange(this.database.categories, 'category', payload, rowToCategory);
      })
      .on('postgres_changes', { ...watch, table: 'tags' }, (payload) => {
        void this.applyRealtimeChange(this.database.tags, 'tag', payload, rowToTag);
      })
      .on('postgres_changes', { ...watch, table: 'focus_sessions' }, (payload) => {
        void this.applyRealtimeChange(this.database.focusSessions, 'focusSession', payload, rowToFocusSession);
      })
      .subscribe((status) => {
        this.onRealtimeStatus(status);
      });
  }

  stopRealtime(): void {
    if (this.realtimeChannel === null) return;
    void this.supabase.removeChannel(this.realtimeChannel);
    this.realtimeChannel = null;
    this.realtimeWasDropped = false;
  }

  /**
   * Cierra el hueco que deja el socket cuando se cae.
   *
   * Mientras Realtime esta desconectado los cambios no se encolan en ningun sitio: los
   * eventos de ese rato sencillamente no existen. Sin esto, tapar la portatil media hora
   * y volver a abrirla dejaba el dispositivo con datos viejos hasta que tocara el
   * intervalo, y esa espera es justo la que se percibe como "no me sincroniza".
   *
   * Solo se baja tras una caida REAL, no en la primera conexion: al arrancar la sesion ya
   * hay una bajada en marcha y duplicarla seria pedir lo mismo dos veces.
   */
  private onRealtimeStatus(status: string): void {
    if (status === 'SUBSCRIBED') {
      if (!this.realtimeWasDropped) return;
      this.realtimeWasDropped = false;
      void this.sync();
      return;
    }

    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      this.realtimeWasDropped = true;
    }
  }

  /**
   * Aplica un evento en vivo por el MISMO camino que la bajada normal.
   *
   * Compartir `applyRemote` no es ahorro de lineas: es lo que garantiza que un cambio
   * llegado por el socket y el mismo cambio llegado por una bajada dejen el dispositivo
   * exactamente igual. Si fueran dos caminos, tendrian dos criterios de conflicto y el
   * resultado dependeria de por cual llego antes.
   */
  private async applyRealtimeChange<TRow extends { id: string }, TEntity extends object>(
    table: SyncTable,
    entity: SyncableEntity,
    payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
    toEntity: (row: TRow) => TEntity & { id: string; updatedAt: string },
  ): Promise<void> {
    // Un DELETE de verdad no trae la fila nueva, solo la clave de la vieja. La app borra
    // marcando `deleted_at`, asi que esto solo salta si la fila desaparece de verdad
    // -por ejemplo al borrarse la categoria que la arrastraba-, y entonces quedarsela
    // seria mostrar algo que ya no existe en ningun otro dispositivo.
    if (payload.eventType === 'DELETE') {
      const id = (payload.old as { id?: string }).id;
      if (id !== undefined) await table.delete(id);
      return;
    }

    const row = payload.new as TRow;
    if (typeof row.id !== 'string') return;

    const remote = toEntity(row);
    await this.applyRemote(table, entity, remote.id, remote, remote.updatedAt);
  }

  // -------------------------------------------------------------------------

  private publish(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}

const maxIso = (a: string, b: string): string => (Date.parse(a) >= Date.parse(b) ? a : b);

/**
 * Distingue "esta FILA es invalida" de "no se pudo hablar con el servidor".
 *
 * La diferencia decide si tiene sentido buscar una fila culpable y si vale la pena
 * apuntarle un intento fallido. Sin ella, un tunel sin cobertura contaba lo mismo que una
 * fila que viola una restriccion, y bastaban unas cuantas sincronizaciones con mala señal
 * para descartar definitivamente cambios que no tenian nada de malo.
 *
 * Los codigos son SQLSTATE, que Postgres define y no cambian:
 *   23xxx  violacion de integridad (check, clave foranea, unicidad, not null)
 *   22xxx  dato fuera de rango o mal formado
 *   42501  permisos insuficientes, que es como llega el rechazo de RLS
 *
 * Un error sin codigo -tipicamente un fallo de red que supabase-js envuelve- NO es de
 * fila. Se interpreta a favor del dato: preferimos reintentar de mas antes que descartar
 * un cambio del usuario por un problema de conexion.
 */
const EPOCH = new Date(0).toISOString();

/**
 * Se retrocede un poco sobre la marca guardada antes de preguntar.
 *
 * La comparacion en el servidor es estricta (`>`), asi que una fila escrita en el mismo
 * instante exacto que la marca caeria fuera de esta bajada y de todas las siguientes. El
 * solape la recupera; el coste es volver a recibir alguna fila ya conocida, que al
 * aplicarse por id no cambia nada.
 */
const sinceFor = (cursor: string): string =>
  new Date(Date.parse(cursor) - appConfig.sync.pullOverlapMs).toISOString();

const isRowRejection = (code: string | undefined): boolean => {
  if (code === undefined || code === '') return false;
  return code.startsWith('23') || code.startsWith('22') || code === '42501';
};
