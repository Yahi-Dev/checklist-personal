import type { Result } from '../../shared/result';
import { DomainErrors } from '../../shared/domain-error';
import { err, ok } from '../../shared/result';

export const PRIORITIES = ['low', 'medium', 'high'] as const;

export type Priority = (typeof PRIORITIES)[number];

export const DEFAULT_PRIORITY: Priority = 'medium';

/** Peso numerico para ordenar. Mayor peso = mas arriba en la lista. */
const PRIORITY_WEIGHT: Readonly<Record<Priority, number>> = {
  high: 3,
  medium: 2,
  low: 1,
};

export const priorityWeight = (priority: Priority): number => PRIORITY_WEIGHT[priority];

export const isPriority = (value: unknown): value is Priority =>
  typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);

export const parsePriority = (value: unknown): Result<Priority> =>
  isPriority(value)
    ? ok(value)
    : err(
        DomainErrors.validation('Prioridad no valida.', {
          field: 'priority',
          details: { received: value, allowed: PRIORITIES },
        }),
      );

export const PRIORITY_LABEL: Readonly<Record<Priority, string>> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

/** Comparador descendente: alta primero. */
export const byPriorityDesc = (a: Priority, b: Priority): number =>
  priorityWeight(b) - priorityWeight(a);
