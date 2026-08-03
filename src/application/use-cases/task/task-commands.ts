import type { CategoryId, TagId, TaskId } from '../../../domain/shared/branded';
import type { IsoDateTime } from '../../../domain/task/value-objects/iso-date-time';
import type { Priority } from '../../../domain/task/value-objects/priority';
import type { RecurrenceRule } from '../../../domain/recurrence/recurrence-rule';
import type { Result } from '../../../domain/shared/result';
import type { Task, TaskLocation } from '../../../domain/task/task';
import type { UseCase, UseCaseContext } from '../use-case';

import { DomainErrors } from '../../../domain/shared/domain-error';
import { createSubtask } from '../../../domain/task/subtask';
import { err, isErr, ok } from '../../../domain/shared/result';
import {
  positionAfterLast,
  positionBetween,
  rebalance,
} from '../../../domain/shared/sortable-position';
import {
  archiveTask,
  attachSubtask,
  completeTask,
  createTask,
  restoreTask,
  snoozeTask,
  softDeleteTask,
  uncompleteTask,
  updateTask,
} from '../../../domain/task/task';

/**
 * Casos de uso de escritura sobre tareas.
 *
 * Cada uno sigue siempre la misma coreografia:
 *   1. Comprobar que hay sesion.
 *   2. Traer el estado actual del repositorio.
 *   3. Delegar la DECISION en una funcion pura del dominio.
 *   4. Persistir el resultado.
 *   5. Reconciliar los efectos externos (avisos del sistema).
 *
 * Las reglas de negocio nunca se escriben aqui: este es el director de orquesta, no
 * el que toca. Si en este archivo aparece un `if` sobre reglas de negocio, ese `if`
 * esta en la capa equivocada.
 */

const noSession = () =>
  err(DomainErrors.unauthenticated('Necesitas iniciar sesion para hacer esto.'));

const notFound = (id: string) =>
  err(DomainErrors.notFound('No encontramos esa tarea.', { details: { id } }));

// ---------------------------------------------------------------------------

export interface CreateTaskCommand {
  readonly title: string;
  readonly notes?: string | null;
  readonly priority?: Priority;
  readonly isImportant?: boolean;
  readonly dueAt?: IsoDateTime | null;
  readonly isAllDay?: boolean;
  readonly reminderAt?: IsoDateTime | null;
  readonly categoryId?: CategoryId | null;
  readonly tagIds?: readonly TagId[];
  readonly recurrence?: RecurrenceRule | null;
  readonly estimatedPomodoros?: number | null;
  readonly location?: TaskLocation | null;
  /** Subtareas iniciales, por si se crea desde una plantilla. */
  readonly subtaskTitles?: readonly string[];
}

export class CreateTaskUseCase implements UseCase<CreateTaskCommand, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: CreateTaskCommand): Promise<Result<Task>> {
    const user = this.context.currentUser();
    if (user === null) return noSession();

    const now = this.context.clock.now().toISOString();

    const existing = await this.context.tasks.findAll({ statuses: ['pending'] });
    const position = isErr(existing)
      ? positionAfterLast([])
      : positionAfterLast(existing.value.map((task) => task.position));

    const created = createTask({
      id: this.context.ids.next<TaskId>(),
      userId: user.id,
      title: command.title,
      now,
      notes: command.notes ?? null,
      priority: command.priority ?? 'medium',
      isImportant: command.isImportant ?? false,
      dueAt: command.dueAt ?? null,
      isAllDay: command.isAllDay ?? false,
      reminderAt: command.reminderAt ?? null,
      categoryId: command.categoryId ?? null,
      tagIds: command.tagIds ?? [],
      recurrence: command.recurrence ?? null,
      estimatedPomodoros: command.estimatedPomodoros ?? null,
      location: command.location ?? null,
      position,
    });

    if (isErr(created)) return created;

    let task = created.value;

    for (const [index, title] of (command.subtaskTitles ?? []).entries()) {
      const subtask = createSubtask({
        id: this.context.ids.next(),
        taskId: task.id,
        title,
        position: (index + 1) * 1024,
        now,
      });

      if (isErr(subtask)) return subtask;

      const attached = attachSubtask(task, subtask.value, now);
      if (isErr(attached)) return attached;
      task = attached.value;
    }

    const saved = await this.context.tasks.save(task);
    if (isErr(saved)) return saved;

    await this.context.reminders.syncTask(saved.value);
    return saved;
  }
}

// ---------------------------------------------------------------------------

export interface UpdateTaskCommand {
  readonly taskId: TaskId;
  readonly title?: string;
  readonly notes?: string | null;
  readonly priority?: Priority;
  readonly isImportant?: boolean;
  readonly dueAt?: IsoDateTime | null;
  readonly isAllDay?: boolean;
  readonly reminderAt?: IsoDateTime | null;
  readonly categoryId?: CategoryId | null;
  readonly tagIds?: readonly TagId[];
  readonly recurrence?: RecurrenceRule | null;
  readonly estimatedPomodoros?: number | null;
  readonly location?: TaskLocation | null;
}

export class UpdateTaskUseCase implements UseCase<UpdateTaskCommand, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: UpdateTaskCommand): Promise<Result<Task>> {
    const found = await this.context.tasks.findById(command.taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(command.taskId);

    const { taskId: _taskId, ...patch } = command;
    const now = this.context.clock.now().toISOString();

    const updated = updateTask(found.value, patch, now);
    if (isErr(updated)) return updated;

    const saved = await this.context.tasks.save(updated.value);
    if (isErr(saved)) return saved;

    await this.context.reminders.syncTask(saved.value);
    return saved;
  }
}

// ---------------------------------------------------------------------------

export interface CompleteTaskResult {
  readonly completed: Task;
  /** La siguiente instancia de la serie, cuando la tarea era recurrente. */
  readonly next: Task | null;
}

/**
 * Completa una tarea. Si es recurrente, guarda tambien la siguiente ocurrencia.
 *
 * Ambas escrituras van en la misma llamada a `saveMany` para que no pueda quedar el
 * estado intermedio de "la completaste pero la siguiente no existe", que en una app
 * de habitos equivale a perder la serie.
 */
export class CompleteTaskUseCase implements UseCase<{ taskId: TaskId }, CompleteTaskResult> {
  constructor(private readonly context: UseCaseContext) {}

  async execute({ taskId }: { taskId: TaskId }): Promise<Result<CompleteTaskResult>> {
    const found = await this.context.tasks.findById(taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(taskId);

    const outcome = completeTask(found.value, {
      now: this.context.clock.now().toISOString(),
      nextTaskId: () => this.context.ids.next<TaskId>(),
      nextSubtaskId: () => this.context.ids.next(),
    });

    if (isErr(outcome)) return outcome;

    const { completed, next } = outcome.value;
    const toPersist = next === null ? [completed] : [completed, next];

    const saved = await this.context.tasks.saveMany(toPersist);
    if (isErr(saved)) return saved;

    await this.context.reminders.cancelForTask(completed);
    if (next !== null) await this.context.reminders.syncTask(next);

    return ok({ completed, next });
  }
}

// ---------------------------------------------------------------------------

/**
 * Deshacer el completado.
 *
 * Cuando la tarea era recurrente, borra ademas la ocurrencia que se genero al
 * completarla. Sin eso, marcar y desmarcar tres veces deja tres copias futuras
 * flotando, que es el bug clasico de las apps de habitos.
 */
export class UncompleteTaskUseCase implements UseCase<{ taskId: TaskId }, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute({ taskId }: { taskId: TaskId }): Promise<Result<Task>> {
    const found = await this.context.tasks.findById(taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(taskId);

    const task = found.value;
    const now = this.context.clock.now().toISOString();

    const restored = uncompleteTask(task, now);
    if (isErr(restored)) return restored;

    const toPersist: Task[] = [restored.value];

    if (task.seriesId !== null) {
      const spawned = await this.findSpawnedOccurrence(task);
      if (spawned !== null) toPersist.push(softDeleteTask(spawned, now));
    }

    const saved = await this.context.tasks.saveMany(toPersist);
    if (isErr(saved)) return saved;

    await this.context.reminders.syncTask(restored.value);
    return ok(restored.value);
  }

  /** La instancia pendiente de la misma serie creada justo despues de esta. */
  private async findSpawnedOccurrence(task: Task): Promise<Task | null> {
    const seriesId = task.seriesId;
    if (seriesId === null) return null;

    const siblings = await this.context.tasks.findBySeries(seriesId);
    if (isErr(siblings)) return null;

    const completedAt = task.completedAt === null ? 0 : Date.parse(task.completedAt);

    return (
      siblings.value
        .filter(
          (sibling) =>
            sibling.id !== task.id &&
            sibling.status === 'pending' &&
            sibling.deletedAt === null &&
            Date.parse(sibling.createdAt) >= completedAt,
        )
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0] ?? null
    );
  }
}

// ---------------------------------------------------------------------------

export type SnoozePreset = '10m' | '1h' | '3h' | 'tonight' | 'tomorrow' | 'weekend' | 'next-week';

export interface SnoozeTaskCommand {
  readonly taskId: TaskId;
  /** Un atajo, o una fecha exacta si el usuario la eligio a mano. */
  readonly preset?: SnoozePreset;
  readonly until?: IsoDateTime;
}

export class SnoozeTaskUseCase implements UseCase<SnoozeTaskCommand, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: SnoozeTaskCommand): Promise<Result<Task>> {
    const found = await this.context.tasks.findById(command.taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(command.taskId);

    const now = this.context.clock.now();
    const until =
      command.until ?? (command.preset === undefined ? null : resolvePreset(command.preset, now));

    if (until === null) {
      return err(
        DomainErrors.validation('Indica hasta cuando quieres posponerla.', { field: 'until' }),
      );
    }

    const snoozed = snoozeTask(found.value, until, now.toISOString());
    if (isErr(snoozed)) return snoozed;

    const saved = await this.context.tasks.save(snoozed.value);
    if (isErr(saved)) return saved;

    await this.context.reminders.syncTask(saved.value);
    return saved;
  }
}

/** Traduce un atajo de posponer a un instante concreto en hora local. */
export const resolvePreset = (preset: SnoozePreset, now: Date): IsoDateTime => {
  const date = new Date(now);

  switch (preset) {
    case '10m':
      date.setMinutes(date.getMinutes() + 10);
      break;

    case '1h':
      date.setHours(date.getHours() + 1);
      break;

    case '3h':
      date.setHours(date.getHours() + 3);
      break;

    case 'tonight':
      date.setHours(20, 0, 0, 0);
      // Si ya pasaron las 20:00, "esta noche" solo puede ser la de mañana.
      if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1);
      break;

    case 'tomorrow':
      date.setDate(date.getDate() + 1);
      date.setHours(9, 0, 0, 0);
      break;

    case 'weekend': {
      // El proximo sabado a las 10:00.
      const daysUntilSaturday = (6 - date.getDay() + 7) % 7 || 7;
      date.setDate(date.getDate() + daysUntilSaturday);
      date.setHours(10, 0, 0, 0);
      break;
    }

    case 'next-week': {
      // El proximo lunes a las 9:00.
      const daysUntilMonday = (1 - date.getDay() + 7) % 7 || 7;
      date.setDate(date.getDate() + daysUntilMonday);
      date.setHours(9, 0, 0, 0);
      break;
    }

    default:
      date.setDate(date.getDate() + 1);
      date.setHours(9, 0, 0, 0);
  }

  return date.toISOString();
};

export const SNOOZE_PRESET_LABEL: Readonly<Record<SnoozePreset, string>> = {
  '10m': 'En 10 minutos',
  '1h': 'En 1 hora',
  '3h': 'En 3 horas',
  tonight: 'Esta noche',
  tomorrow: 'Mañana',
  weekend: 'El fin de semana',
  'next-week': 'La semana que viene',
};

// ---------------------------------------------------------------------------

/**
 * Borrado logico.
 *
 * Nunca se hace un DELETE fisico desde la interfaz: la fila con `deleted_at` es la
 * unica forma de que el otro dispositivo se entere de que la tarea desaparecio. Si se
 * borrara de verdad, la siguiente sincronizacion la resucitaria desde el telefono.
 */
export class DeleteTaskUseCase implements UseCase<{ taskId: TaskId }, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute({ taskId }: { taskId: TaskId }): Promise<Result<Task>> {
    const found = await this.context.tasks.findById(taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(taskId);

    const deleted = softDeleteTask(found.value, this.context.clock.now().toISOString());

    const saved = await this.context.tasks.save(deleted);
    if (isErr(saved)) return saved;

    await this.context.reminders.cancelForTask(deleted);
    return saved;
  }
}

export class RestoreTaskUseCase implements UseCase<{ taskId: TaskId }, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute({ taskId }: { taskId: TaskId }): Promise<Result<Task>> {
    const found = await this.context.tasks.findById(taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(taskId);

    const restored = restoreTask(found.value, this.context.clock.now().toISOString());
    if (isErr(restored)) return restored;

    const saved = await this.context.tasks.save(restored.value);
    if (isErr(saved)) return saved;

    await this.context.reminders.syncTask(saved.value);
    return saved;
  }
}

export class ArchiveTaskUseCase implements UseCase<{ taskId: TaskId }, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute({ taskId }: { taskId: TaskId }): Promise<Result<Task>> {
    const found = await this.context.tasks.findById(taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(taskId);

    const archived = archiveTask(found.value, this.context.clock.now().toISOString());
    if (isErr(archived)) return archived;

    const saved = await this.context.tasks.save(archived.value);
    if (isErr(saved)) return saved;

    await this.context.reminders.cancelForTask(archived.value);
    return saved;
  }
}

// ---------------------------------------------------------------------------

export interface ToggleImportantCommand {
  readonly taskId: TaskId;
}

export class ToggleImportantUseCase implements UseCase<ToggleImportantCommand, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute({ taskId }: ToggleImportantCommand): Promise<Result<Task>> {
    const found = await this.context.tasks.findById(taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(taskId);

    const updated = updateTask(
      found.value,
      { isImportant: !found.value.isImportant },
      this.context.clock.now().toISOString(),
    );

    if (isErr(updated)) return updated;
    return this.context.tasks.save(updated.value);
  }
}

// ---------------------------------------------------------------------------

export interface ReorderTaskCommand {
  readonly taskId: TaskId;
  /** Vecina de arriba en la lista ya reordenada, o `null` si va la primera. */
  readonly previousTaskId: TaskId | null;
  /** Vecina de abajo, o `null` si va la ultima. */
  readonly nextTaskId: TaskId | null;
}

/**
 * Reordena por indexacion fraccionaria: se escribe UNA fila, no toda la lista.
 * Solo cuando el hueco entre vecinas ya no se puede partir se rebalancea el bloque.
 */
export class ReorderTaskUseCase implements UseCase<ReorderTaskCommand, Task[]> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: ReorderTaskCommand): Promise<Result<Task[]>> {
    const all = await this.context.tasks.findAll({ statuses: ['pending'] });
    if (isErr(all)) return all;

    const byId = new Map(all.value.map((task) => [task.id, task]));
    const moving = byId.get(command.taskId);
    if (moving === undefined) return notFound(command.taskId);

    const previous =
      command.previousTaskId === null ? undefined : byId.get(command.previousTaskId)?.position;
    const next = command.nextTaskId === null ? undefined : byId.get(command.nextTaskId)?.position;

    const now = this.context.clock.now().toISOString();
    const position = positionBetween(previous, next);

    if (position !== null) {
      const moved: Task = { ...moving, position, updatedAt: now };
      return this.context.tasks.saveMany([moved]);
    }

    // Sin espacio entre vecinas: se reparte de nuevo toda la lista y se guarda entera.
    const ordered = [...all.value].sort((a, b) => a.position - b.position);
    const rebalanced = rebalance(ordered, (task, newPosition) => ({
      ...task,
      position: newPosition,
      updatedAt: now,
    }));

    return this.context.tasks.saveMany(rebalanced);
  }
}
