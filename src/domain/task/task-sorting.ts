import type { Task } from './task';
import { priorityWeight } from './value-objects/priority';

/**
 * Criterios de ordenacion.
 *
 * `smart` es el que usa la vista de Hoy: intenta responder "que hago ahora" en vez
 * de limitarse a ordenar por un campo.
 */
export const SORT_MODES = [
  'smart',
  'due-asc',
  'due-desc',
  'priority',
  'created-desc',
  'created-asc',
  'alphabetical',
  'manual',
] as const;

export type SortMode = (typeof SORT_MODES)[number];

export const SORT_MODE_LABEL: Readonly<Record<SortMode, string>> = {
  smart: 'Inteligente',
  'due-asc': 'Vencimiento (mas proximo)',
  'due-desc': 'Vencimiento (mas lejano)',
  priority: 'Prioridad',
  'created-desc': 'Creacion (mas reciente)',
  'created-asc': 'Creacion (mas antigua)',
  alphabetical: 'Alfabetico',
  manual: 'Orden manual',
};

/** Las tareas sin fecha van al final, no al principio. */
const dueTimestamp = (task: Task): number =>
  task.dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(task.dueAt);

/**
 * Orden inteligente para la vista de Hoy:
 *   1. Lo atrasado primero, y cuanto mas atrasado, mas arriba.
 *   2. Despues lo destacado.
 *   3. Despues por prioridad.
 *   4. Despues por hora de vencimiento.
 *   5. Las tareas sin fecha al final, en su orden manual.
 *
 * El desempate final por id evita que la lista baile entre renders cuando dos tareas
 * empatan en todo lo demas.
 */
const smartComparator =
  (now: number) =>
  (a: Task, b: Task): number => {
    const aOverdue = a.dueAt !== null && Date.parse(a.dueAt) < now;
    const bOverdue = b.dueAt !== null && Date.parse(b.dueAt) < now;

    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    if (aOverdue && bOverdue) return dueTimestamp(a) - dueTimestamp(b);

    if (a.isImportant !== b.isImportant) return a.isImportant ? -1 : 1;

    const priorityDelta = priorityWeight(b.priority) - priorityWeight(a.priority);
    if (priorityDelta !== 0) return priorityDelta;

    const dueDelta = dueTimestamp(a) - dueTimestamp(b);
    if (dueDelta !== 0 && Number.isFinite(dueDelta)) return dueDelta;

    const positionDelta = a.position - b.position;
    if (positionDelta !== 0) return positionDelta;

    return a.id.localeCompare(b.id);
  };

const COMPARATORS: Readonly<Record<SortMode, (now: number) => (a: Task, b: Task) => number>> = {
  smart: smartComparator,

  'due-asc': () => (a, b) => dueTimestamp(a) - dueTimestamp(b) || a.id.localeCompare(b.id),

  'due-desc': () => (a, b) => {
    const aDue = a.dueAt === null ? Number.NEGATIVE_INFINITY : Date.parse(a.dueAt);
    const bDue = b.dueAt === null ? Number.NEGATIVE_INFINITY : Date.parse(b.dueAt);
    return bDue - aDue || a.id.localeCompare(b.id);
  },

  priority: () => (a, b) =>
    priorityWeight(b.priority) - priorityWeight(a.priority) ||
    dueTimestamp(a) - dueTimestamp(b) ||
    a.id.localeCompare(b.id),

  'created-desc': () => (a, b) =>
    Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id),

  'created-asc': () => (a, b) =>
    Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),

  alphabetical: () => (a, b) =>
    a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id),

  manual: () => (a, b) => a.position - b.position || a.id.localeCompare(b.id),
};

/** Devuelve una copia ordenada; nunca muta el array recibido. */
export const sortTasks = (
  tasks: readonly Task[],
  mode: SortMode = 'smart',
  now: Date = new Date(),
): Task[] => [...tasks].sort(COMPARATORS[mode](now.getTime()));

/**
 * Agrupa por dia local de vencimiento, en formato `YYYY-MM-DD`.
 * Las tareas sin fecha caen en la clave `sin-fecha`.
 */
export const groupTasksByDueDate = (tasks: readonly Task[]): Map<string, Task[]> => {
  const groups = new Map<string, Task[]>();

  for (const task of tasks) {
    let key = 'sin-fecha';

    if (task.dueAt !== null) {
      const due = new Date(task.dueAt);
      key = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(
        due.getDate(),
      ).padStart(2, '0')}`;
    }

    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [task]);
    } else {
      bucket.push(task);
    }
  }

  return groups;
};
