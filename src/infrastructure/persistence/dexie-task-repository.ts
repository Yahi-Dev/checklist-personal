import type { AppDatabase } from './database';
import type { Outbox } from './outbox';
import type { Result } from '../../domain/shared/result';
import type { Task } from '../../domain/task/task';
import type { TaskId } from '../../domain/shared/branded';
import type { TaskQuery, TaskRepository } from '../../application/ports/repositories';
import type { TaskRecord } from './records';

import { fromPromise, ok } from '../../domain/shared/result';
import { stripHints, withHints } from './records';
import { toDomainError } from '../../domain/shared/domain-error';

/**
 * Repositorio de tareas sobre IndexedDB.
 *
 * Toda escritura deja ademas su anotacion en la cola de salida, dentro de la MISMA
 * transaccion. Esa atomicidad es lo que garantiza que no exista un cambio guardado en
 * local del que nadie recuerde que hay que subirlo.
 */
export class DexieTaskRepository implements TaskRepository {
  constructor(
    private readonly database: AppDatabase,
    private readonly outbox: Outbox,
  ) {}

  async findById(id: TaskId): Promise<Result<Task | null>> {
    return fromPromise(
      this.database.tasks.get(id).then((record) => (record === undefined ? null : toTask(record))),
      (cause) => toDomainError(cause, 'No se pudo leer la tarea.'),
    );
  }

  async findAll(query: TaskQuery = {}): Promise<Result<Task[]>> {
    return fromPromise(this.runQuery(query), (cause) =>
      toDomainError(cause, 'No se pudieron leer las tareas.'),
    );
  }

  async findBySeries(seriesId: TaskId): Promise<Result<Task[]>> {
    return fromPromise(
      this.database.tasks
        .where('seriesId')
        .equals(seriesId)
        .toArray()
        .then((records) => records.map(toTask)),
      (cause) => toDomainError(cause, 'No se pudo leer la serie.'),
    );
  }

  async save(task: Task): Promise<Result<Task>> {
    const written = await fromPromise(
      this.database.transaction('rw', [this.database.tasks, this.database.outbox], async () => {
        await this.database.tasks.put(withHints(task, true));
        await this.outbox.enqueue('task', task.id, 'upsert', task, task.updatedAt);
        return task;
      }),
      (cause) => toDomainError(cause, 'No se pudo guardar la tarea.'),
    );

    return written;
  }

  async saveMany(tasks: readonly Task[]): Promise<Result<Task[]>> {
    if (tasks.length === 0) return ok([]);

    return fromPromise(
      this.database.transaction('rw', [this.database.tasks, this.database.outbox], async () => {
        await this.database.tasks.bulkPut(tasks.map((task) => withHints(task, true)));
        await this.outbox.enqueueMany(
          'task',
          tasks.map((task) => ({ id: task.id, updatedAt: task.updatedAt, payload: task })),
        );
        return [...tasks];
      }),
      (cause) => toDomainError(cause, 'No se pudieron guardar las tareas.'),
    );
  }

  /**
   * Borrado FISICO, sin pasar por la cola.
   * Solo lo llama el motor de sincronizacion al purgar lapidas que el servidor ya
   * confirmo. La app siempre usa el borrado logico con `deletedAt`.
   */
  async hardDelete(id: TaskId): Promise<Result<void>> {
    return fromPromise(this.database.tasks.delete(id), (cause) =>
      toDomainError(cause, 'No se pudo borrar la tarea.'),
    );
  }

  async countByStatus(): Promise<Result<Record<Task['status'], number>>> {
    return fromPromise(
      (async () => {
        const [pending, completed, archived] = await Promise.all([
          this.database.tasks.where('[_deleted+status]').equals([0, 'pending']).count(),
          this.database.tasks.where('[_deleted+status]').equals([0, 'completed']).count(),
          this.database.tasks.where('[_deleted+status]').equals([0, 'archived']).count(),
        ]);

        return { pending, completed, archived };
      })(),
      (cause) => toDomainError(cause, 'No se pudieron contar las tareas.'),
    );
  }

  /**
   * Resuelve la consulta apoyandose en el indice mas selectivo disponible y filtrando
   * en memoria solo lo que sobra. Para el volumen de una app personal (miles de filas,
   * no millones) esto es mas rapido que multiplicar indices compuestos.
   */
  private async runQuery(query: TaskQuery): Promise<Task[]> {
    const includeDeleted = query.includeDeleted ?? false;

    let records: TaskRecord[];

    if (query.updatedSince !== undefined) {
      records = await this.database.tasks.where('updatedAt').above(query.updatedSince).toArray();
    } else if (query.categoryId !== undefined && query.categoryId !== null && !includeDeleted) {
      records = await this.database.tasks
        .where('[_deleted+categoryId]')
        .equals([0, query.categoryId])
        .toArray();
    } else if (query.statuses?.length === 1 && !includeDeleted) {
      records = await this.database.tasks
        .where('[_deleted+status]')
        .equals([0, query.statuses[0] as string])
        .toArray();
    } else if (!includeDeleted) {
      records = await this.database.tasks.where('_deleted').equals(0).toArray();
    } else {
      records = await this.database.tasks.toArray();
    }

    let result = records;

    if (!includeDeleted) {
      result = result.filter((record) => record.deletedAt === null);
    }

    if (query.statuses !== undefined && query.statuses.length > 0) {
      const allowed = new Set<string>(query.statuses);
      result = result.filter((record) => allowed.has(record.status));
    }

    if (query.categoryId !== undefined) {
      result = result.filter((record) => record.categoryId === query.categoryId);
    }

    if (query.limit !== undefined) {
      result = result.slice(0, query.limit);
    }

    return result.map(toTask);
  }
}

const toTask = (record: TaskRecord): Task => stripHints(record);
