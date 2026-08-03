import type { Result } from '../../shared/result';
import { DomainErrors } from '../../shared/domain-error';
import { err, ok } from '../../shared/result';

export const TASK_STATUSES = ['pending', 'completed', 'archived'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const isTaskStatus = (value: unknown): value is TaskStatus =>
  typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);

export const parseTaskStatus = (value: unknown): Result<TaskStatus> =>
  isTaskStatus(value)
    ? ok(value)
    : err(
        DomainErrors.validation('Estado de tarea no valido.', {
          field: 'status',
          details: { received: value, allowed: TASK_STATUSES },
        }),
      );

/**
 * Transiciones permitidas. Una maquina de estados explicita evita que se cuelen
 * cambios sin sentido, como "revivir" una tarea archivada desde la lista de hoy.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['completed', 'archived'],
  completed: ['pending', 'archived'],
  archived: ['pending'],
};

export const canTransition = (from: TaskStatus, to: TaskStatus): boolean =>
  from === to || (ALLOWED_TRANSITIONS[from] ?? []).includes(to);

export const TASK_STATUS_LABEL: Readonly<Record<TaskStatus, string>> = {
  pending: 'Pendiente',
  completed: 'Completada',
  archived: 'Archivada',
};
