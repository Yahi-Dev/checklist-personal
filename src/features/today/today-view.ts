import type { Task } from '../../domain/task/task';

import {
  isDueOnDaySpec,
  isOverdueSpec,
  isPendingSpec,
  matchesQuerySpec,
  wasCompletedOnSpec,
} from '../../domain/task/task-specifications';

export interface TodayView {
  /** Lo que se paso: va arriba y aparte. */
  readonly overdue: Task[];
  /** Lo que vence hoy y todavia no. */
  readonly today: Task[];
  /** Lo que se completo hoy, venciera cuando venciera. */
  readonly completedToday: Task[];
}

/**
 * Reparte las tareas en las tres partes de Hoy y, si hay texto en el buscador, deja en
 * cada una solo las que coinciden (titulo, notas y subtareas, sin mayusculas ni acentos).
 *
 * El buscador filtra lo que ya esta en Hoy, no busca en todas: para eso esta Buscar.
 * Filtrar las tres partes a la vez, y no solo lo pendiente, es lo que permite encontrar
 * "eso que ya marque esta mañana" sin cambiar de pantalla.
 */
export const buildTodayView = (tasks: readonly Task[], now: Date, query = ''): TodayView => {
  const overdueSpec = isOverdueSpec(now.toISOString());
  const todaySpec = isDueOnDaySpec(now);
  const pendingSpec = isPendingSpec();
  const completedTodaySpec = wasCompletedOnSpec(now);
  const matches = matchesQuerySpec(query);

  const overdue: Task[] = [];
  const today: Task[] = [];
  const completedToday: Task[] = [];

  for (const task of tasks) {
    if (!matches.isSatisfiedBy(task)) continue;

    if (task.status === 'completed') {
      if (completedTodaySpec.isSatisfiedBy(task)) completedToday.push(task);
      continue;
    }

    if (!pendingSpec.isSatisfiedBy(task)) continue;

    // Lo atrasado gana a lo de hoy: una tarea de esta mañana ya pasada cuenta como
    // atrasada, no como pendiente del dia, y tiene que salir en el bloque de arriba.
    if (overdueSpec.isSatisfiedBy(task)) overdue.push(task);
    else if (todaySpec.isSatisfiedBy(task)) today.push(task);
  }

  return { overdue, today, completedToday };
};
