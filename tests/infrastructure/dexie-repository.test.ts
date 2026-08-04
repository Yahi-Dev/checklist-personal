import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TaskId, UserId } from '../../src/domain/shared/branded';

import { AppDatabase } from '../../src/infrastructure/persistence/database';
import { brandId } from '../../src/domain/shared/branded';
import { createTask, softDeleteTask } from '../../src/domain/task/task';
import { DexieTaskRepository } from '../../src/infrastructure/persistence/dexie-task-repository';
import { Outbox } from '../../src/infrastructure/persistence/outbox';
import { unwrap } from '../../src/domain/shared/result';

/**
 * Pruebas del repositorio contra IndexedDB DE VERDAD (via fake-indexeddb).
 *
 * Sustituir Dexie por un doble aqui no probaria nada de lo que puede fallar: los
 * indices compuestos mal declarados, el borrado logico que no se filtra y la atomicidad
 * de la transaccion con la cola de salida solo se manifiestan contra una base real.
 */

const USER_ID = brandId<UserId>('00000000-0000-4000-8000-000000000001');
const NOW = '2026-08-02T12:00:00.000Z';

let counter = 0;
const makeTask = (overrides: Partial<Parameters<typeof createTask>[0]> = {}) => {
  counter += 1;
  return unwrap(
    createTask({
      id: brandId<TaskId>(`00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`),
      userId: USER_ID,
      title: `Tarea ${counter}`,
      now: NOW,
      ...overrides,
    }),
  );
};

describe('DexieTaskRepository', () => {
  let database: AppDatabase;
  let repository: DexieTaskRepository;
  let outbox: Outbox;

  beforeEach(async () => {
    // Base con nombre unico por prueba: evita que el estado se filtre entre casos.
    database = new AppDatabase(`test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await database.open();

    outbox = new Outbox(database);
    repository = new DexieTaskRepository(database, outbox);
  });

  afterEach(async () => {
    await database.delete();
  });

  it('guarda y recupera una tarea sin perder ningun campo', async () => {
    const task = makeTask({ notes: 'Con notas', priority: 'high' });
    await repository.save(task);

    const found = unwrap(await repository.findById(task.id));

    expect(found).not.toBeNull();
    expect(found?.title).toBe(task.title);
    expect(found?.notes).toBe('Con notas');
    expect(found?.priority).toBe('high');
    // Los campos auxiliares de indexado no deben llegar al dominio.
    expect(found).not.toHaveProperty('_deleted');
    expect(found).not.toHaveProperty('_dirty');
  });

  it('encola la escritura en la misma operacion que la guarda', async () => {
    // Es la garantia que impide que exista un cambio local sin nadie que lo suba.
    await repository.save(makeTask());

    expect(await outbox.count()).toBe(1);
  });

  it('colapsa las escrituras repetidas de la misma tarea', async () => {
    // Editar seis veces sin conexion tiene que producir UNA subida, no seis.
    const task = makeTask();

    await repository.save(task);
    await repository.save({ ...task, title: 'Cambio 1', updatedAt: '2026-08-02T12:01:00.000Z' });
    await repository.save({ ...task, title: 'Cambio 2', updatedAt: '2026-08-02T12:02:00.000Z' });

    expect(await outbox.count()).toBe(1);

    const pending = await outbox.pending();
    expect((pending[0]?.payload as { title: string }).title).toBe('Cambio 2');
  });

  it('excluye las tareas borradas en logico por defecto', async () => {
    const alive = makeTask();
    const deleted = softDeleteTask(makeTask(), NOW);

    await repository.saveMany([alive, deleted]);

    const visible = unwrap(await repository.findAll());
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(alive.id);

    const all = unwrap(await repository.findAll({ includeDeleted: true }));
    expect(all).toHaveLength(2);
  });

  it('filtra por estado usando el indice compuesto', async () => {
    await repository.saveMany([
      makeTask(),
      makeTask(),
      { ...makeTask(), status: 'completed', completedAt: NOW },
    ]);

    const pending = unwrap(await repository.findAll({ statuses: ['pending'] }));
    expect(pending).toHaveLength(2);

    const completed = unwrap(await repository.findAll({ statuses: ['completed'] }));
    expect(completed).toHaveLength(1);
  });

  it('cuenta por estado sin traerse las filas', async () => {
    await repository.saveMany([
      makeTask(),
      { ...makeTask(), status: 'completed', completedAt: NOW },
      { ...makeTask(), status: 'archived' },
    ]);

    const counts = unwrap(await repository.countByStatus());

    expect(counts.pending).toBe(1);
    expect(counts.completed).toBe(1);
    expect(counts.archived).toBe(1);
  });

  it('encuentra todas las instancias de una serie', async () => {
    const seriesId = brandId<TaskId>('00000000-0000-4000-8000-0000000000ff');

    await repository.saveMany([
      { ...makeTask(), seriesId },
      { ...makeTask(), seriesId },
      makeTask(),
    ]);

    const series = unwrap(await repository.findBySeries(seriesId));
    expect(series).toHaveLength(2);
  });

  it('conserva las subtareas anidadas al ir y volver de la base', async () => {
    // Es la prueba de que guardar el agregado completo en una fila funciona.
    const task = makeTask();
    const withSubtasks = {
      ...task,
      subtasks: [
        {
          id: brandId<TaskId>('00000000-0000-4000-9000-000000000001') as never,
          taskId: task.id,
          title: 'Paso uno',
          isDone: true,
          position: 1024,
          completedAt: NOW,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    };

    await repository.save(withSubtasks);
    const found = unwrap(await repository.findById(task.id));

    expect(found?.subtasks).toHaveLength(1);
    expect(found?.subtasks[0]?.title).toBe('Paso uno');
    expect(found?.subtasks[0]?.isDone).toBe(true);
  });
});

describe('Outbox', () => {
  let database: AppDatabase;
  let outbox: Outbox;

  beforeEach(async () => {
    database = new AppDatabase(`test-outbox-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await database.open();
    outbox = new Outbox(database);
  });

  afterEach(async () => {
    await database.delete();
  });

  it('conserva el orden de encolado', async () => {
    await outbox.enqueue('category', 'c1', 'upsert', { id: 'c1' }, NOW);
    await outbox.enqueue('task', 't1', 'upsert', { id: 't1' }, NOW);

    const pending = await outbox.pending();

    expect(pending.map((entry) => entry.entityId)).toEqual(['c1', 't1']);
  });

  it('quita las entradas confirmadas', async () => {
    await outbox.enqueue('task', 't1', 'upsert', {}, NOW);
    const pending = await outbox.pending();

    await outbox.acknowledge(pending.map((entry) => entry.seq!).filter(Boolean));

    expect(await outbox.count()).toBe(0);
  });

  it('marca como envenenadas las entradas que agotan los reintentos', async () => {
    await outbox.enqueue('task', 't1', 'upsert', {}, NOW);
    const [entry] = await outbox.pending();

    // Diez fallos seguidos: deja de bloquear la cola.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await outbox.recordFailures(new Map([[entry!.seq!, 'error de red']]));
    }

    expect(await outbox.pending()).toHaveLength(0);
    expect(await outbox.poisoned()).toHaveLength(1);

    // Y el boton de reintentar las devuelve a la cola.
    await outbox.retryPoisoned();
    expect(await outbox.pending()).toHaveLength(1);
  });
});
