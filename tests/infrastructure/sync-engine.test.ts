import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSupabaseClient } from '../../src/infrastructure/supabase/client';
import type { TaskId, UserId } from '../../src/domain/shared/branded';

import { AppDatabase } from '../../src/infrastructure/persistence/database';
import { brandId } from '../../src/domain/shared/branded';
import { completeTask, createTask } from '../../src/domain/task/task';
import { DexieTaskRepository } from '../../src/infrastructure/persistence/dexie-task-repository';
import { Outbox } from '../../src/infrastructure/persistence/outbox';
import { pullCursorKey } from '../../src/infrastructure/persistence/records';
import { SyncEngine } from '../../src/infrastructure/sync/sync-engine';
import { taskToRow } from '../../src/infrastructure/supabase/mappers';
import { isErr, unwrap } from '../../src/domain/shared/result';

/**
 * Pruebas del motor de sincronizacion contra un servidor FALSO PERO REALISTA.
 *
 * Lo que se imita del servidor no es su forma sino su comportamiento en el fallo, que es
 * donde estaban todos los defectos: Postgres rechaza la SENTENCIA entera cuando una sola
 * fila viola una restriccion, distingue un rechazo de fila de una caida de red mediante el
 * codigo SQLSTATE, y no dice cual fue la fila culpable.
 *
 * Cada prueba de aqui corresponde a un fallo que llego hasta el usuario: un dispositivo que
 * mostraba tareas que no existian en ningun otro sitio, fechas que se ponian y se quitaban
 * solas, y cambios que la app daba por guardados y no habian salido nunca del aparato.
 */

const USER = brandId<UserId>('11111111-1111-4111-8111-111111111111');
const OTHER_USER = brandId<UserId>('22222222-2222-4222-8222-222222222222');
const NOW = '2026-08-04T12:00:00.000Z';

let counter = 0;
const makeTask = (title = 'Tarea') => {
  counter += 1;
  return unwrap(
    createTask({
      id: brandId<TaskId>(`00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`),
      userId: USER,
      title: `${title} ${String(counter)}`,
      now: NOW,
    }),
  );
};

/**
 * Servidor de mentira. `reject` decide, fila a fila, cual seria rechazada.
 *
 * `upserts` guarda cada lote que llego para poder afirmar no solo QUE se subio sino en
 * cuantas peticiones: es lo que demuestra que la biseccion aisla la fila mala en vez de ir
 * de una en una o de rendirse con el lote entero.
 */
const makeSupabase = (options: {
  /** Recibe tambien la TABLA: hay fallos que son de la peticion entera, no de la fila. */
  reject?: (
    row: Record<string, unknown>,
    table: string,
  ) => { code: string; message: string } | null;
  /** Falla la BAJADA de una tabla concreta, para imitar un esquema incompleto. */
  selectError?: (table: string) => { code: string; message: string } | null;
  networkError?: boolean;
  rows?: Record<string, Record<string, unknown>[]>;
  /** Se ejecuta con el lote ya enviado y antes de devolver la respuesta: imita la latencia. */
  whileInFlight?: () => Promise<void>;
}) => {
  const upserts: { table: string; rows: Record<string, unknown>[] }[] = [];

  const client = {
    from: (table: string) => ({
      upsert: async (rows: Record<string, unknown>[]) => {
        upserts.push({ table, rows });
        await options.whileInFlight?.();

        if (options.networkError === true) {
          // Un fallo de red llega sin codigo SQLSTATE. Esa ausencia es el unico dato que
          // distingue "no se pudo hablar con el servidor" de "esta fila es invalida".
          return { error: { code: '', message: 'TypeError: Failed to fetch' } };
        }

        const bad = rows
          .map((row) => options.reject?.(row, table) ?? null)
          .find((it) => it !== null);
        return { error: bad ?? null };
      },
      select: () => {
        const answer = () => ({
          data: options.rows?.[table] ?? [],
          error: options.selectError?.(table) ?? null,
        });

        const query = {
          eq: () => query,
          gt: () => query,
          order: () => query,
          range: () => Promise.resolve(answer()),
          then: (resolve: (value: ReturnType<typeof answer>) => unknown) => resolve(answer()),
        };
        return query;
      },
    }),
    /* Cadena que se devuelve a si misma. La version anterior soportaba exactamente dos
       `.on()` encadenados y el codigo real ya hace seis: en cuanto una prueba llamara a
       `startRealtime()`, reventaria con "on is not a function" por un limite del doble,
       no por un fallo del motor. */
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: () => Promise.resolve('ok'),
  };

  return { client: client as unknown as AppSupabaseClient, upserts };
};

describe('SyncEngine', () => {
  let database: AppDatabase;
  let tasks: DexieTaskRepository;
  let outbox: Outbox;

  beforeEach(async () => {
    counter = 0;
    database = new AppDatabase(`sync-${String(Date.now())}-${String(Math.random())}`);
    outbox = new Outbox(database);
    tasks = new DexieTaskRepository(database, outbox);
    await database.open();
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(async () => {
    await database.delete();
    vi.unstubAllGlobals();
  });

  const engineFor = (client: AppSupabaseClient) => new SyncEngine(database, client, () => USER);

  describe('una fila rechazada no puede parar todo lo demas', () => {
    it('sube las tareas aunque una categoria sea rechazada', async () => {
      // Este es EL fallo que llevo a todo lo demas. Las categorias se suben antes que las
      // tareas, y el bucle no atrapaba nada: una categoria heredada de otra sesion -que
      // RLS rechaza siempre- impedia que las tareas se intentaran siquiera. El dispositivo
      // enseñaba tareas que no existian en ningun otro sitio, y nada lo decia.
      await outbox.enqueue('category', 'cat-ajena', 'upsert', { id: 'cat-ajena' }, NOW);
      await tasks.save(makeTask());
      await tasks.save(makeTask());

      const { client, upserts } = makeSupabase({
        reject: (row) =>
          row.id === 'cat-ajena'
            ? { code: '42501', message: 'new row violates row-level security policy' }
            : null,
      });

      await engineFor(client).sync();

      const subidas = upserts.filter((it) => it.table === 'tasks').flatMap((it) => it.rows);
      expect(subidas).toHaveLength(2);

      // La categoria sigue esperando; las tareas ya no.
      const pendientes = await outbox.pending();
      expect(pendientes.map((entry) => entry.entity)).toEqual(['category']);
    });

    it('aisla la fila culpable y confirma sus compañeras de lote', async () => {
      const buenas = [makeTask(), makeTask(), makeTask()];
      for (const task of buenas) await tasks.save(task);

      const mala = makeTask('Rota');
      await tasks.save(mala);

      const { client } = makeSupabase({
        reject: (row) =>
          row.id === mala.id ? { code: '23514', message: 'violates check constraint' } : null,
      });

      await engineFor(client).sync();

      const pendientes = await outbox.pending();
      expect(pendientes).toHaveLength(1);
      expect(pendientes[0]?.entityId).toBe(mala.id);

      // Y solo la culpable carga con el intento fallido y con el motivo.
      expect(pendientes[0]?.attempts).toBe(1);
      expect(pendientes[0]?.lastError).toContain('check constraint');
    });

    it('encuentra la fila mala en muchas menos peticiones que filas', async () => {
      for (let i = 0; i < 32; i += 1) await tasks.save(makeTask());
      const mala = makeTask('Rota');
      await tasks.save(mala);

      const { client, upserts } = makeSupabase({
        reject: (row) => (row.id === mala.id ? { code: '23514', message: 'nope' } : null),
      });

      await engineFor(client).sync();

      // Biseccion: ~2·log2(33) peticiones, no 33. El numero exacto importa menos que la
      // magnitud; lo que se afirma es que NO se degrada a una peticion por fila.
      const intentos = upserts.filter((it) => it.table === 'tasks').length;
      expect(intentos).toBeGreaterThan(1);
      expect(intentos).toBeLessThan(15);

      // Lo que de verdad se afirma: las 32 buenas subieron pese a viajar con la mala.
      expect((await outbox.pending()).map((entry) => entry.entityId)).toEqual([mala.id]);
    });
  });

  describe('un fallo de red no es culpa de ninguna fila', () => {
    it('no suma intentos fallidos cuando se cae la conexion', async () => {
      await tasks.save(makeTask());
      await tasks.save(makeTask());

      const { client, upserts } = makeSupabase({ networkError: true });
      await engineFor(client).sync();

      // Sin esto, unas cuantas sincronizaciones con mala señal bastaban para descartar
      // definitivamente cambios que no tenian absolutamente nada de malo.
      const pendientes = await outbox.pending();
      expect(pendientes).toHaveLength(2);
      expect(pendientes.every((entry) => entry.attempts === 0)).toBe(true);

      // Y tampoco se bisecta: una sola peticion, no una por fila.
      expect(upserts.filter((it) => it.table === 'tasks')).toHaveLength(1);
    });
  });

  describe('lo atascado no puede tapar lo que viene detras', () => {
    it('sigue subiendo lo nuevo aunque haya entradas agotadas por delante', async () => {
      const atascada = makeTask('Atascada');
      await tasks.save(atascada);

      const [entrada] = await outbox.pending();
      for (let i = 0; i < 10; i += 1) {
        await outbox.recordFailures(new Map([[entrada!.seq!, 'rechazada']]));
      }

      const nueva = makeTask('Nueva');
      await tasks.save(nueva);

      const { client, upserts } = makeSupabase({});
      await engineFor(client).sync();

      const subidas = upserts.filter((it) => it.table === 'tasks').flatMap((it) => it.rows);
      expect(subidas.map((row) => row.id)).toEqual([nueva.id]);
    });

    it('cuenta aparte lo pendiente y lo atascado', async () => {
      await tasks.save(makeTask());
      const [entrada] = await outbox.pending();
      for (let i = 0; i < 10; i += 1) {
        await outbox.recordFailures(new Map([[entrada!.seq!, 'rechazada']]));
      }
      await tasks.save(makeTask());

      const { client } = makeSupabase({ networkError: true });
      const engine = engineFor(client);
      await engine.sync();

      // El indicador decia "2 por subir" indefinidamente sin bajar nunca de dos. Ahora
      // una de las dos se enseña como lo que es: algo que no se arregla esperando.
      expect(engine.getState().pendingOperations).toBe(1);
      expect(engine.getState().blockedOperations).toBe(1);
      expect(engine.getState().blockedReason).toBe('rechazada');
    });

    it('el boton de reintentar devuelve lo atascado a la cola', async () => {
      await tasks.save(makeTask());
      const [entrada] = await outbox.pending();
      for (let i = 0; i < 10; i += 1) {
        await outbox.recordFailures(new Map([[entrada!.seq!, 'rechazada']]));
      }

      const { client, upserts } = makeSupabase({});
      const engine = engineFor(client);
      await engine.retryBlocked();

      expect(upserts.filter((it) => it.table === 'tasks').flatMap((it) => it.rows)).toHaveLength(1);
      expect(engine.getState().blockedOperations).toBe(0);
    });
  });

  describe('la marca de agua de la bajada', () => {
    it('es de cada tabla y de cada cuenta', async () => {
      // Vivia en una clave fija del dispositivo, asi que sobrevivia al cambio de usuario:
      // la cuenta nueva heredaba "ya baje hasta el martes" y no descargaba nada anterior.
      const { client } = makeSupabase({});
      await engineFor(client).sync();

      const propia = await database.getMeta<string>(pullCursorKey('task', USER));
      const ajena = await database.getMeta<string>(pullCursorKey('task', OTHER_USER));

      expect(propia).not.toBeNull();
      expect(ajena).toBeNull();

      // Y una tabla no arrastra a las otras.
      expect(await database.getMeta<string>(pullCursorKey('category', USER))).not.toBe(
        pullCursorKey('task', USER),
      );
    });
  });

  describe('categorias duplicadas por nombre', () => {
    /**
     * El 409 que salio en produccion, reproducido.
     *
     * Un dispositivo recien instalado sembraba sus cinco categorias por defecto antes de
     * bajar nada. La cuenta ya las tenia, creadas en otro aparato, con los mismos nombres y
     * OTROS identificadores. El indice unico por (usuario, nombre) rechaza las locales para
     * siempre, y las tareas que apuntan a ellas fallan ademas por clave foranea: 409 en las
     * dos tablas a la vez, en bucle.
     */
    const guardarCategoria = async (id: string, name: string, dirty: 0 | 1): Promise<void> => {
      await database.categories.put({
        id: brandId('cat-' + id),
        userId: USER,
        name,
        color: '#6366f1',
        icon: 'house',
        position: 0,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
        _dirty: dirty,
        _deleted: 0,
      } as never);
    };

    it('funde la local con la del servidor y manda sus tareas a la que queda', async () => {
      await guardarCategoria('servidor', 'Trabajo', 0); // vino de la nube
      await guardarCategoria('local', 'Trabajo', 1); // sembrada aqui, nunca subio
      await outbox.enqueue('category', 'cat-local', 'upsert', { id: 'cat-local' }, NOW);

      const task = makeTask();
      await tasks.save({ ...task, categoryId: brandId('cat-local') });

      const { client } = makeSupabase({});
      await engineFor(client).sync();

      // La duplicada desaparece del todo: nunca existio en el servidor, no hay nada que
      // propagar, y dejarla solo lograria reintentar para siempre algo que ya no esta.
      expect(await database.categories.get(brandId('cat-local'))).toBeUndefined();
      expect(await database.categories.get(brandId('cat-servidor'))).toBeDefined();

      // Y la tarea acaba apuntando a la que si existe en el servidor, que es lo que ademas
      // desatasca su clave foranea.
      const movida = await database.tasks.get(task.id);
      expect(movida?.categoryId).toBe('cat-servidor');

      // No queda rastro en la cola de la categoria fundida.
      const pendientes = await outbox.pending();
      expect(pendientes.some((entry) => entry.entityId === 'cat-local')).toBe(false);
    });

    it('no toca nada si las dos son locales: no habria forma de saber cual sobra', async () => {
      await guardarCategoria('una', 'Trabajo', 1);
      await guardarCategoria('otra', 'Trabajo', 1);

      const { client } = makeSupabase({});
      await engineFor(client).sync();

      expect(await database.categories.get(brandId('cat-una'))).toBeDefined();
      expect(await database.categories.get(brandId('cat-otra'))).toBeDefined();
    });

    it('no funde categorias con nombres distintos', async () => {
      await guardarCategoria('servidor', 'Trabajo', 0);
      await guardarCategoria('local', 'Personal', 1);

      const { client } = makeSupabase({});
      await engineFor(client).sync();

      expect(await database.categories.get(brandId('cat-local'))).toBeDefined();
    });
  });

  describe('cuando gana la version del servidor', () => {
    it('retira tambien la anotacion local, para que no revierta el cambio despues', async () => {
      /**
       * El sintoma era de los que nadie se cree: la fecha aparecia bien y unos minutos
       * despues se quitaba sola, en todos los dispositivos a la vez.
       *
       * El motivo: al aceptar la fila del servidor se bajaba `_dirty` a 0 pero la entrada
       * de la cola seguia ahi con la FOTO VIEJA, y esa foto se subia en la pasada siguiente
       * y deshacia en el servidor lo que se acababa de aceptar.
       */
      const task = makeTask();
      await tasks.save(task);
      expect(await outbox.pending()).toHaveLength(1);

      const masNuevo = { ...taskToRow(task), title: 'Titulo del servidor' };
      masNuevo.updated_at = '2026-08-04T18:00:00.000Z';
      (masNuevo as Record<string, unknown>).server_updated_at = '2026-08-04T18:00:00.000Z';

      const { client } = makeSupabase({ rows: { tasks: [masNuevo as Record<string, unknown>] } });
      await engineFor(client).sync();

      const guardada = await database.tasks.get(task.id);
      expect(guardada?.title).toBe('Titulo del servidor');
      expect(guardada?._dirty).toBe(0);

      // Y sobre todo: ya no queda nada en la cola que pueda deshacerlo.
      expect(await outbox.pending()).toHaveLength(0);
    });
  });

  describe('lo que se marca como subido', () => {
    it('no da por subida una tarea editada mientras viajaba', async () => {
      const task = makeTask();
      await tasks.save(task);

      // Se edita la tarea en el hueco entre enviar el lote y recibir la respuesta, que en
      // datos moviles son segundos. Antes se marcaba limpia igualmente, y la bajada de ese
      // mismo ciclo le pasaba por encima la version antigua: la edicion se deshacia sola,
      // delante del usuario y unos segundos despues de haberla hecho.
      let yaEditada = false;

      const { client } = makeSupabase({
        whileInFlight: async () => {
          if (yaEditada) return;
          yaEditada = true;

          const completada = unwrap(
            completeTask(task, {
              now: '2026-08-04T12:00:05.000Z',
              nextTaskId: () => brandId<TaskId>('00000000-0000-4000-8000-000000000999'),
              nextSubtaskId: () => brandId('00000000-0000-4000-9000-000000000999'),
            }),
          ).completed;

          await tasks.save(completada);
        },
      });

      await engineFor(client).sync();

      const guardada = await database.tasks.get(task.id);
      expect(guardada?._dirty).toBe(1);
    });
  });

  describe('el servidor va por detras del cliente', () => {
    /**
     * El caso que motiva todo este bloque: la PWA se despliega sola en cada push y el SQL
     * de Supabase se pega a mano, asi que SIEMPRE hay una ventana en la que el cliente
     * conoce partes del esquema que el servidor aun no.
     *
     * Una tabla que falta solo afecta a la funcion que la estrena. Una COLUMNA que falta
     * afecta a una tabla llena y en uso: PostgREST rechaza la peticion ENTERA, asi que
     * una columna nueva en `tasks` puede dejar de subir TODAS las tareas.
     */
    const columnaQueFalta = (tabla: string) => ({
      code: 'PGRST204',
      message: `Could not find the 'campo_nuevo' column of '${tabla}' in the schema cache`,
    });

    it('una columna que falta no gasta intentos ni saca las filas de la cola', async () => {
      // Sin esto, cada pasada quemaria un intento de los diez que tiene cada entrada, y
      // en cinco minutos las tareas quedarian marcadas como atascadas para siempre por un
      // SQL sin pegar.
      await tasks.save(makeTask());

      const { client } = makeSupabase({
        reject: (_row, table) => (table === 'tasks' ? columnaQueFalta('tasks') : null),
      });

      await engineFor(client).sync();
      await engineFor(client).sync();

      const pendientes = await outbox.pending();
      expect(pendientes).toHaveLength(1);
      expect(pendientes[0]?.attempts).toBe(0);
      // Sigue contando como pendiente: nada quedo fuera por haber agotado intentos.
      expect(await outbox.pendingCount()).toBe(1);
    });

    it('y no impide que suban las demas tablas', async () => {
      // La categoria y la tarea van en grupos distintos del mismo empujon. Antes, que el
      // servidor rechazara uno bastaba para dar la pasada por fallida.
      await outbox.enqueue('category', 'cat-1', 'upsert', { id: 'cat-1' }, NOW);
      await tasks.save(makeTask());

      const { client, upserts } = makeSupabase({
        reject: (_row, table) => (table === 'tasks' ? columnaQueFalta('tasks') : null),
      });

      await engineFor(client).sync();

      expect(upserts.some((entry) => entry.table === 'categories')).toBe(true);
    });

    it('deja el estado en verde y explica que falta', async () => {
      // Pintarlo en rojo hacia creer que tampoco se guardaban las tareas, que es justo lo
      // contrario de lo que pasaba.
      await tasks.save(makeTask());

      const { client } = makeSupabase({
        reject: (_row, table) => (table === 'tasks' ? columnaQueFalta('tasks') : null),
      });

      const estado = unwrap(await engineFor(client).sync());

      expect(estado.status).toBe('idle');
      expect(estado.blockedOperations).toBe(0);
      expect(estado.lastError).toMatch(/columna/u);
      expect(estado.lastError).toMatch(/tasks/u);
      expect(estado.lastError).toMatch(/PEGAR-EN-SUPABASE/u);
    });

    it('una tabla que falta en la bajada no corta las siguientes', async () => {
      // Las categorias se bajan ANTES que las tareas. Antes, la primera tabla ausente
      // dejaba a medias la cadena y el dispositivo dejaba de recibir todo lo demas.
      const remota = { ...taskToRow(makeTask('Del servidor')) } as Record<string, unknown>;
      remota.server_updated_at = '2026-08-04T18:00:00.000Z';

      const { client } = makeSupabase({
        rows: { tasks: [remota] },
        selectError: (table) =>
          table === 'categories'
            ? { code: 'PGRST205', message: "Could not find the table 'public.categories'" }
            : null,
      });

      const estado = unwrap(await engineFor(client).sync());

      expect(await database.tasks.count()).toBe(1);
      expect(estado.status).toBe('idle');
      expect(estado.lastError).toMatch(/categories/u);
    });

    it('un fallo de verdad SI pinta el estado en rojo', async () => {
      // La tolerancia no puede tragarselo todo: un error que no sea "falta esquema" tiene
      // que seguir avisando.
      await tasks.save(makeTask());

      const { client } = makeSupabase({ networkError: true });
      // El MISMO motor: `engineFor` fabrica uno nuevo cada vez y el estado vive en la
      // instancia, no en la clase.
      const engine = engineFor(client);
      const resultado = await engine.sync();

      expect(isErr(resultado)).toBe(true);
      expect(engine.getState().status).toBe('error');
    });
  });

  describe('horario academico', () => {
    it('sube las asignaturas ANTES que sus clases', async () => {
      // No es una preferencia: en el servidor `schedule_blocks.subject_id` referencia a
      // `subjects.id`. Al reves, el insert del tramo devuelve 23503, `isRowRejection` lo
      // clasifica como rechazo de fila, y tras la biseccion y diez intentos esa entrada
      // queda envenenada en la cola para siempre.
      await outbox.enqueue('scheduleBlock', 'blk-1', 'upsert', { id: 'blk-1' }, NOW);
      await outbox.enqueue('subject', 'sub-1', 'upsert', { id: 'sub-1' }, NOW);

      const { client, upserts } = makeSupabase({});

      await engineFor(client).sync();

      const tablas = upserts.map((entry) => entry.table);
      expect(tablas.indexOf('subjects')).toBeLessThan(tablas.indexOf('schedule_blocks'));
    });

    it('lleva su propio cursor de bajada por tabla', async () => {
      // Una marca compartida perderia filas: si la asignatura mas nueva es de las 15:00 y
      // el tramo mas nuevo de las 14:00, la marca comun quedaria en las 15:00 y un tramo
      // escrito a las 14:30 no entraria en ninguna bajada posterior.
      const { client } = makeSupabase({
        rows: {
          subjects: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              user_id: USER,
              code: 'TI3210',
              name: 'Logica Matematica',
              section: '01',
              credits: 3,
              teacher_code: null,
              teacher_name: null,
              color: '#6366f1',
              term_code: '2027-1',
              starts_on: '2026-09-07',
              ends_on: '2026-12-19',
              position: 0,
              created_at: NOW,
              updated_at: NOW,
              server_updated_at: '2026-08-04T15:00:00.000Z',
              deleted_at: null,
            },
          ],
          schedule_blocks: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              user_id: USER,
              subject_id: '33333333-3333-4333-8333-333333333333',
              weekday: 1,
              starts_at: '20:00',
              ends_at: '22:00',
              modality: 'presencial',
              location_label: 'FR1-411',
              is_remote: false,
              starts_on: '2026-09-07',
              ends_on: '2026-12-19',
              created_at: NOW,
              updated_at: NOW,
              server_updated_at: '2026-08-04T14:00:00.000Z',
              deleted_at: null,
            },
          ],
        },
      });

      await engineFor(client).sync();

      expect(await database.subjects.count()).toBe(1);
      expect(await database.scheduleBlocks.count()).toBe(1);

      // Cada tabla avanza su marca hasta SU propia fila mas nueva, no hasta la del vecino.
      expect(await database.getMeta(pullCursorKey('subject', USER))).toBe(
        '2026-08-04T15:00:00.000Z',
      );
      expect(await database.getMeta(pullCursorKey('scheduleBlock', USER))).toBe(
        '2026-08-04T14:00:00.000Z',
      );
    });

    it('deja limpias las filas que el servidor acepto', async () => {
      // Sin el caso nuevo en `tableFor`, el `_dirty` no bajaria nunca y la misma
      // asignatura se reenviaria en cada pasada, para siempre.
      await outbox.enqueue('subject', 'sub-1', 'upsert', { id: 'sub-1' }, NOW);
      await database.subjects.put({
        id: 'sub-1',
        updatedAt: NOW,
        _deleted: 0,
        _dirty: 1,
      } as never);

      const { client } = makeSupabase({});
      await engineFor(client).sync();

      const guardada = await database.subjects.get('sub-1');
      expect(guardada?._dirty).toBe(0);
    });
  });
});
