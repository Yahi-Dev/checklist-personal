import Dexie, { type Table } from 'dexie';

import type {
  CategoryRecord,
  FocusSessionRecord,
  OutboxEntry,
  ScheduleBlockRecord,
  SubjectNoteRecord,
  SubjectRecord,
  SyncMetaRecord,
  TagRecord,
  TaskRecord,
} from './records';

/**
 * La base local. Es la FUENTE DE VERDAD para leer.
 *
 * La interfaz nunca consulta a Supabase directamente: lee de aqui y el motor de
 * sincronizacion se encarga de que esto se parezca al servidor. Asi la app arranca
 * igual de rapida y completa sin conexion que con ella, y no hay estados de carga
 * repartidos por cada pantalla.
 *
 * Los indices compuestos estan elegidos a partir de las consultas reales de la app,
 * no "por si acaso": cada indice cuesta espacio y tiempo en cada escritura.
 */
export class AppDatabase extends Dexie {
  declare tasks: Table<TaskRecord, string>;
  declare categories: Table<CategoryRecord, string>;
  declare tags: Table<TagRecord, string>;
  declare focusSessions: Table<FocusSessionRecord, string>;
  declare subjects: Table<SubjectRecord, string>;
  declare scheduleBlocks: Table<ScheduleBlockRecord, string>;
  declare subjectNotes: Table<SubjectNoteRecord, string>;
  declare outbox: Table<OutboxEntry, number>;
  declare meta: Table<SyncMetaRecord, string>;

  constructor(name = 'checklist-personal') {
    super(name);

    this.version(1).stores({
      // [_deleted+status+dueAt] cubre la consulta de la vista Hoy, que es la que mas
      // corre: "pendientes, no borradas, ordenadas por vencimiento".
      tasks:
        'id, status, dueAt, categoryId, updatedAt, seriesId, _deleted, _dirty, ' +
        '[_deleted+status], [_deleted+status+dueAt], [_deleted+categoryId], *tagIds',

      categories: 'id, position, updatedAt, _deleted, _dirty',

      tags: 'id, slug, updatedAt, _deleted, _dirty',

      focusSessions: 'id, startedAt, endedAt, taskId, mode, _dirty',

      // ++seq mantiene el orden de encolado, que es el orden en que hay que reproducir.
      outbox: '++seq, entity, entityId, [entity+entityId], createdAt',

      meta: 'key',
    });

    /**
     * v2: `[attempts+seq]` en la cola de salida.
     *
     * La cola se lee en orden de encolado saltando lo que agoto sus reintentos, y sin
     * indice eso obligaba a traer las N primeras entradas ENTERAS -con la foto completa
     * de cada tarea dentro- para descartarlas en memoria. Dos consecuencias, y la segunda
     * es la grave:
     *
     *   1. El contador de la cola es una consulta viva que se reevalua en CADA escritura,
     *      asi que ese barrido corria constantemente mientras se escribe.
     *   2. Con el limite por pagina, un bloque de entradas atascadas a la cabeza se comia
     *      la pagina entera y dejaba fuera a las buenas que venian detras: bastaban unas
     *      pocas filas rechazadas para que nada volviera a subir nunca.
     *
     * El indice compuesto -y no uno simple sobre `attempts`- es lo que permite pedir
     * "las no atascadas EN ORDEN de encolado" en una sola pasada del indice.
     *
     * Solo se añade un indice: Dexie reindexa las filas existentes sin tocar los datos.
     */
    this.version(2).stores({
      outbox: '++seq, entity, entityId, [entity+entityId], createdAt, attempts, [attempts+seq]',
    });

    /**
     * v3: el horario academico.
     *
     * Solo se declaran las dos tablas NUEVAS. Dexie hereda el resto de la version
     * anterior, igual que hizo la v2 con la cola de salida; tocar el `version(1)` de
     * arriba romperia la migracion de las bases ya instaladas en los dispositivos.
     *
     * Los indices compuestos salen de las dos consultas reales de la pantalla:
     * "las asignaturas de este cuatrimestre" y "los tramos de este dia", ambas
     * descartando lo borrado. Sin el `_deleted` dentro, cada consulta tendria que
     * traerse tambien las bajas para filtrarlas en memoria.
     */
    this.version(3).stores({
      subjects: 'id, code, termCode, updatedAt, _deleted, _dirty, [_deleted+termCode]',

      scheduleBlocks:
        'id, subjectId, weekday, startsAt, updatedAt, _deleted, _dirty, ' +
        '[_deleted+subjectId], [_deleted+weekday]',
    });

    /**
     * v4: la materia como hilo conductor.
     *
     * `tasks` se REDECLARA ENTERA, y eso no es un descuido. Dexie no añade indices a un
     * almacen: sustituye su juego por el que se declare en la version nueva. Poner aqui
     * solo `[_deleted+subjectId]` habria borrado los cinco indices que ya tenia, entre
     * ellos el que sostiene la vista Hoy, y el sintoma habria sido una app lenta sin que
     * nada fallara. De ahi que esten todos repetidos.
     */
    this.version(4).stores({
      tasks:
        'id, status, dueAt, categoryId, subjectId, updatedAt, seriesId, _deleted, _dirty, ' +
        '[_deleted+status], [_deleted+status+dueAt], [_deleted+categoryId], ' +
        '[_deleted+subjectId], *tagIds',

      subjectNotes: 'id, subjectId, updatedAt, _deleted, _dirty, [_deleted+subjectId]',
    });
  }

  /** Vacia todo. Solo lo usa el cierre de sesion y la resincronizacion completa. */
  async wipe(): Promise<void> {
    await this.transaction(
      'rw',
      [
        this.tasks,
        this.categories,
        this.tags,
        this.focusSessions,
        this.subjects,
        this.scheduleBlocks,
        this.subjectNotes,
        this.outbox,
        this.meta,
      ],
      async () => {
        await Promise.all([
          this.tasks.clear(),
          this.categories.clear(),
          this.tags.clear(),
          this.focusSessions.clear(),
          this.subjects.clear(),
          this.scheduleBlocks.clear(),
          this.subjectNotes.clear(),
          this.outbox.clear(),
          this.meta.clear(),
        ]);
      },
    );
  }

  async getMeta<T>(key: string): Promise<T | null> {
    const record = await this.meta.get(key);
    return record === undefined ? null : (record.value as T);
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    await this.meta.put({ key, value, updatedAt: new Date().toISOString() });
  }
}

/**
 * Instancia unica.
 *
 * Dexie mantiene la conexion a IndexedDB abierta; crear una segunda instancia con el
 * mismo nombre provoca bloqueos de version al actualizar el esquema.
 */
export const db = new AppDatabase();
