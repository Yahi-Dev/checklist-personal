import type { IsoDateTime } from './value-objects/iso-date-time';
import type { Result } from '../shared/result';
import type { SubtaskId, TaskId } from '../shared/branded';
import { DomainErrors } from '../shared/domain-error';
import { err, ok } from '../shared/result';

/**
 * Una subtarea es una ENTIDAD DENTRO del agregado Tarea, no un agregado propio.
 *
 * Nunca se accede a ella por separado ni se sincroniza sola: siempre entra y sale
 * junto a su tarea padre. Eso mantiene la invariante "el progreso de una tarea es el
 * de sus subtareas" siempre consistente, sin transacciones distribuidas.
 */
export interface Subtask {
  readonly id: SubtaskId;
  readonly taskId: TaskId;
  readonly title: string;
  readonly isDone: boolean;
  readonly position: number;
  readonly completedAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export const SUBTASK_TITLE_MAX_LENGTH = 300;
export const MAX_SUBTASKS_PER_TASK = 100;

export interface CreateSubtaskInput {
  readonly id: SubtaskId;
  readonly taskId: TaskId;
  readonly title: string;
  readonly position: number;
  readonly now: IsoDateTime;
}

export const createSubtask = (input: CreateSubtaskInput): Result<Subtask> => {
  const title = input.title.replace(/\s+/gu, ' ').trim();

  if (title.length === 0) {
    return err(
      DomainErrors.validation('La subtarea necesita un titulo.', { field: 'subtask.title' }),
    );
  }

  if (title.length > SUBTASK_TITLE_MAX_LENGTH) {
    return err(
      DomainErrors.validation(
        `El titulo de la subtarea no puede pasar de ${SUBTASK_TITLE_MAX_LENGTH} caracteres.`,
        { field: 'subtask.title' },
      ),
    );
  }

  return ok({
    id: input.id,
    taskId: input.taskId,
    title,
    isDone: false,
    position: input.position,
    completedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  });
};

export const toggleSubtask = (subtask: Subtask, now: IsoDateTime): Subtask => {
  const isDone = !subtask.isDone;
  return {
    ...subtask,
    isDone,
    completedAt: isDone ? now : null,
    updatedAt: now,
  };
};

export const renameSubtask = (
  subtask: Subtask,
  title: string,
  now: IsoDateTime,
): Result<Subtask> => {
  const normalized = title.replace(/\s+/gu, ' ').trim();

  if (normalized.length === 0) {
    return err(
      DomainErrors.validation('La subtarea necesita un titulo.', { field: 'subtask.title' }),
    );
  }

  if (normalized.length > SUBTASK_TITLE_MAX_LENGTH) {
    return err(
      DomainErrors.validation(
        `El titulo de la subtarea no puede pasar de ${SUBTASK_TITLE_MAX_LENGTH} caracteres.`,
        { field: 'subtask.title' },
      ),
    );
  }

  return ok({ ...subtask, title: normalized, updatedAt: now });
};

/** Progreso 0..1. Una tarea sin subtareas devuelve 0. */
export const subtaskProgress = (subtasks: readonly Subtask[]): number => {
  if (subtasks.length === 0) return 0;
  const done = subtasks.filter((subtask) => subtask.isDone).length;
  return done / subtasks.length;
};

export const allSubtasksDone = (subtasks: readonly Subtask[]): boolean =>
  subtasks.length > 0 && subtasks.every((subtask) => subtask.isDone);
