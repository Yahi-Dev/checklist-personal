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

    const subtasks =
      position !== null
        ? task.subtasks.map((subtask) =>
            subtask.id === command.subtaskId ? { ...subtask, position, updatedAt: now } : subtask,
          )
        : rebalance(
            [...task.subtasks].sort((a, b) => a.position - b.position),
            (subtask, newPosition) => ({ ...subtask, position: newPosition, updatedAt: now }),
          );

    return this.context.tasks.save(replaceSubtasks(task, subtasks, now));
  }
}
