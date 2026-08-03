import type { Result } from '../../../domain/shared/result';
import type { SubtaskId, TaskId } from '../../../domain/shared/branded';
import type { Task } from '../../../domain/task/task';
import type { UseCase, UseCaseContext } from '../use-case';

import { DomainErrors } from '../../../domain/shared/domain-error';
import { attachSubtask, detachSubtask, replaceSubtasks } from '../../../domain/task/task';
import { createSubtask, renameSubtask, toggleSubtask } from '../../../domain/task/subtask';
import { err, isErr } from '../../../domain/shared/result';
import {
  positionAfterLast,
  positionBetween,
  rebalance,
} from '../../../domain/shared/sortable-position';

const notFound = (id: string) =>
  err(DomainErrors.notFound('No encontramos esa tarea.', { details: { id } }));

export interface AddSubtaskCommand {
  readonly taskId: TaskId;
  readonly title: string;
}

export class AddSubtaskUseCase implements UseCase<AddSubtaskCommand, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: AddSubtaskCommand): Promise<Result<Task>> {
    const found = await this.context.tasks.findById(command.taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(command.taskId);

    const task = found.value;
    const now = this.context.clock.now().toISOString();

    const subtask = createSubtask({
      id: this.context.ids.next<SubtaskId>(),
      taskId: task.id,
      title: command.title,
      position: positionAfterLast(task.subtasks.map((item) => item.position)),
      now,
    });

    if (isErr(subtask)) return subtask;

    const updated = attachSubtask(task, subtask.value, now);
    if (isErr(updated)) return updated;

    return this.context.tasks.save(updated.value);
  }
}

export interface ToggleSubtaskCommand {
  readonly taskId: TaskId;
  readonly subtaskId: SubtaskId;
}

export class ToggleSubtaskUseCase implements UseCase<ToggleSubtaskCommand, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: ToggleSubtaskCommand): Promise<Result<Task>> {
    const found = await this.context.tasks.findById(command.taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(command.taskId);

    const task = found.value;
    const now = this.context.clock.now().toISOString();

    const subtasks = task.subtasks.map((subtask) =>
      subtask.id === command.subtaskId ? toggleSubtask(subtask, now) : subtask,
    );

    return this.context.tasks.save(replaceSubtasks(task, subtasks, now));
  }
}

export interface RenameSubtaskCommand {
  readonly taskId: TaskId;
  readonly subtaskId: SubtaskId;
  readonly title: string;
}

export class RenameSubtaskUseCase implements UseCase<RenameSubtaskCommand, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: RenameSubtaskCommand): Promise<Result<Task>> {
    const found = await this.context.tasks.findById(command.taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(command.taskId);

    const task = found.value;
    const now = this.context.clock.now().toISOString();
    const target = task.subtasks.find((subtask) => subtask.id === command.subtaskId);

    if (target === undefined) {
      return err(DomainErrors.notFound('No encontramos esa subtarea.'));
    }

    const renamed = renameSubtask(target, command.title, now);
    if (isErr(renamed)) return renamed;

    const subtasks = task.subtasks.map((subtask) =>
      subtask.id === command.subtaskId ? renamed.value : subtask,
    );

    return this.context.tasks.save(replaceSubtasks(task, subtasks, now));
  }
}

export class RemoveSubtaskUseCase implements UseCase<ToggleSubtaskCommand, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: ToggleSubtaskCommand): Promise<Result<Task>> {
    const found = await this.context.tasks.findById(command.taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(command.taskId);

    const now = this.context.clock.now().toISOString();
    return this.context.tasks.save(detachSubtask(found.value, command.subtaskId, now));
  }
}

export interface ReorderSubtaskCommand {
  readonly taskId: TaskId;
  readonly subtaskId: SubtaskId;
  readonly previousSubtaskId: SubtaskId | null;
  readonly nextSubtaskId: SubtaskId | null;
}

export class ReorderSubtaskUseCase implements UseCase<ReorderSubtaskCommand, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: ReorderSubtaskCommand): Promise<Result<Task>> {
    const found = await this.context.tasks.findById(command.taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(command.taskId);

    const task = found.value;
    const now = this.context.clock.now().toISOString();
    const byId = new Map(task.subtasks.map((subtask) => [subtask.id, subtask]));

    const previous =
      command.previousSubtaskId === null
        ? undefined
        : byId.get(command.previousSubtaskId)?.position;
    const next =
      command.nextSubtaskId === null ? undefined : byId.get(command.nextSubtaskId)?.position;

    const position = positionBetween(previous, next);

    // Camino normal: cabe un hueco entre las vecinas y solo se toca la subtarea movida.
    if (position !== null) {
      const subtasks = task.subtasks.map((subtask) =>
        subtask.id === command.subtaskId ? { ...subtask, position, updatedAt: now } : subtask,
      );
      return this.context.tasks.save(replaceSubtasks(task, subtasks, now));
    }

    /**
     * Sin hueco entre las vecinas hay que repartir posiciones nuevas, y el orden que se
     * reparte tiene que ser el orden DESEADO, no el actual.
     *
     * Antes se rebalanceaba `task.subtasks` ordenado por su posicion de ese momento, o
     * sea el orden de ANTES de mover: la subtarea se quedaba donde estaba y la accion no
     * hacia nada, sin ningun error. Pasaba desapercibido porque no habia forma de
     * reordenar desde la interfaz; en cuanto la hay, mover repetidamente entre las
     * mismas dos vecinas acaba agotando el hueco y cayendo justo aqui.
     */
    const ordered = [...task.subtasks].sort((a, b) => a.position - b.position);
    const moving = ordered.find((subtask) => subtask.id === command.subtaskId);

    if (moving === undefined) {
      return err(DomainErrors.notFound('Esa subtarea no existe en la tarea.'));
    }

    const rest = ordered.filter((subtask) => subtask.id !== command.subtaskId);
    const target =
      command.previousSubtaskId === null
        ? 0
        : rest.findIndex((subtask) => subtask.id === command.previousSubtaskId) + 1;

    // `findIndex` devuelve -1 si la vecina no existe; ahi el +1 da 0 y va al principio,
    // que es un destino sensato para una referencia que ya no esta.
    rest.splice(Math.max(0, target), 0, moving);

    const subtasks = rebalance(rest, (subtask, newPosition) => ({
      ...subtask,
      position: newPosition,
      updatedAt: now,
    }));

    return this.context.tasks.save(replaceSubtasks(task, subtasks, now));
  }
}
