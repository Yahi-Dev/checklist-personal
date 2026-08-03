import type { CategoryId, TagId } from '../shared/branded';
import type { IsoDateTime } from './value-objects/iso-date-time';
import type { Priority } from './value-objects/priority';
import type { Specification } from '../shared/specification';
import type { Task } from './task';
import type { TaskStatus } from './value-objects/task-status';

import { and, not, or, spec } from '../shared/specification';
import { endOfLocalDay, startOfLocalDay } from '../shared/clock';
import { normalizeForSearch } from './value-objects/task-title';
import { priorityWeight } from './value-objects/priority';

/**
 * El catalogo de reglas de filtrado.
 *
 * Aqui se define una sola vez que significa "atrasada", "de hoy" o "esta semana".
 * La vista de Hoy, la busqueda, las estadisticas y el planificador de recordatorios
 * consumen exactamente las mismas definiciones, asi que no pueden discrepar.
 */

// --- Estado ----------------------------------------------------------------

export const notDeleted = (): Specification<Task> => spec((task) => task.deletedAt === null);

export const hasStatus = (status: TaskStatus): Specification<Task> =>
  spec((task) => task.status === status);

export const isPendingSpec = (): Specification<Task> => and(notDeleted(), hasStatus('pending'));

export const isCompletedSpec = (): Specification<Task> => and(notDeleted(), hasStatus('completed'));

export const isArchivedSpec = (): Specification<Task> => and(notDeleted(), hasStatus('archived'));

// --- Tiempo ----------------------------------------------------------------

/** Vencida: pendiente y con fecha ya pasada. */
export const isOverdueSpec = (now: IsoDateTime): Specification<Task> =>
  and(
    isPendingSpec(),
    spec((task) => task.dueAt !== null && Date.parse(task.dueAt) < Date.parse(now)),
  );

/** Vence dentro del dia local de `reference`, sin importar si ya paso la hora. */
export const isDueOnDaySpec = (reference: Date): Specification<Task> => {
  const from = startOfLocalDay(reference).getTime();
  const to = endOfLocalDay(reference).getTime();

  return spec((task) => {
    if (task.dueAt === null) return false;
    const due = Date.parse(task.dueAt);
    return due >= from && due <= to;
  });
};

/** Vence dentro de un rango arbitrario, extremos incluidos. */
export const isDueBetweenSpec = (from: Date, to: Date): Specification<Task> => {
  const start = from.getTime();
  const end = to.getTime();

  return spec((task) => {
    if (task.dueAt === null) return false;
    const due = Date.parse(task.dueAt);
    return due >= start && due <= end;
  });
};

export const hasNoDueDateSpec = (): Specification<Task> => spec((task) => task.dueAt === null);

/**
 * La regla de la vista "Hoy".
 *
 * Contiene lo que vence hoy MAS lo que ya se vencio y sigue pendiente. Esa segunda
 * parte es la importante: lo atrasado no se puede quedar escondido en una pantalla
 * que hay que ir a buscar, porque entonces deja de existir.
 */
export const isInTodayViewSpec = (now: Date): Specification<Task> =>
  and(isPendingSpec(), or(isDueOnDaySpec(now), isOverdueSpec(now.toISOString())));

/** Los proximos `days` dias, sin contar hoy. */
export const isUpcomingSpec = (now: Date, days = 7): Specification<Task> => {
  const from = new Date(startOfLocalDay(now).getTime() + 86_400_000);
  const to = endOfLocalDay(new Date(startOfLocalDay(now).getTime() + days * 86_400_000));
  return and(isPendingSpec(), isDueBetweenSpec(from, to));
};

/** Se completo dentro del dia local indicado. Base de las rachas y las estadisticas. */
export const wasCompletedOnSpec = (reference: Date): Specification<Task> => {
  const from = startOfLocalDay(reference).getTime();
  const to = endOfLocalDay(reference).getTime();

  return spec((task) => {
    if (task.completedAt === null) return false;
    const completed = Date.parse(task.completedAt);
    return completed >= from && completed <= to;
  });
};

// --- Clasificacion ---------------------------------------------------------

export const hasPrioritySpec = (priority: Priority): Specification<Task> =>
  spec((task) => task.priority === priority);

export const hasMinimumPrioritySpec = (priority: Priority): Specification<Task> =>
  spec((task) => priorityWeight(task.priority) >= priorityWeight(priority));

export const isImportantSpec = (): Specification<Task> => spec((task) => task.isImportant);

export const inCategorySpec = (categoryId: CategoryId | null): Specification<Task> =>
  spec((task) => task.categoryId === categoryId);

export const inAnyCategorySpec = (categoryIds: readonly CategoryId[]): Specification<Task> => {
  const allowed = new Set(categoryIds);
  return spec((task) => task.categoryId !== null && allowed.has(task.categoryId));
};

export const hasTagSpec = (tagId: TagId): Specification<Task> =>
  spec((task) => task.tagIds.includes(tagId));

/** Lleva TODAS las etiquetas indicadas. */
export const hasAllTagsSpec = (tagIds: readonly TagId[]): Specification<Task> =>
  spec((task) => tagIds.every((tagId) => task.tagIds.includes(tagId)));

/** Lleva AL MENOS UNA de las etiquetas indicadas. */
export const hasAnyTagSpec = (tagIds: readonly TagId[]): Specification<Task> =>
  spec((task) => tagIds.some((tagId) => task.tagIds.includes(tagId)));

export const isRecurringSpec = (): Specification<Task> =>
  spec((task) => task.recurrence !== null || task.seriesId !== null);

export const hasSubtasksSpec = (): Specification<Task> => spec((task) => task.subtasks.length > 0);

export const hasAttachmentsSpec = (): Specification<Task> =>
  spec((task) => task.attachments.length > 0);

// --- Busqueda por texto ----------------------------------------------------

/**
 * Coincidencia en titulo, notas y subtareas, insensible a mayusculas y acentos.
 * Todos los terminos tienen que aparecer (AND), que es lo que espera cualquiera al
 * escribir dos palabras en un buscador.
 */
export const matchesQuerySpec = (query: string): Specification<Task> => {
  const terms = normalizeForSearch(query).split(' ').filter(Boolean);
  if (terms.length === 0) return spec(() => true);

  return spec((task) => {
    const haystack = normalizeForSearch(
      [task.title, task.notes ?? '', ...task.subtasks.map((subtask) => subtask.title)].join(' '),
    );
    return terms.every((term) => haystack.includes(term));
  });
};

// --- Composicion desde la UI ----------------------------------------------

export interface TaskFilterCriteria {
  readonly query?: string;
  readonly statuses?: readonly TaskStatus[];
  readonly categoryIds?: readonly CategoryId[];
  readonly tagIds?: readonly TagId[];
  readonly priorities?: readonly Priority[];
  readonly onlyImportant?: boolean;
  readonly onlyOverdue?: boolean;
  readonly onlyRecurring?: boolean;
  readonly dueFrom?: Date;
  readonly dueTo?: Date;
  readonly includeWithoutDueDate?: boolean;
  readonly now?: Date;
}

/**
 * Traduce los filtros de la interfaz a una unica Specification compuesta.
 * Los criterios ausentes simplemente no aportan restriccion.
 */
export const buildTaskFilter = (criteria: TaskFilterCriteria): Specification<Task> => {
  const now = criteria.now ?? new Date();
  const parts: Specification<Task>[] = [notDeleted()];

  if (criteria.statuses !== undefined && criteria.statuses.length > 0) {
    parts.push(or(...criteria.statuses.map(hasStatus)));
  }

  if (criteria.query !== undefined && criteria.query.trim().length > 0) {
    parts.push(matchesQuerySpec(criteria.query));
  }

  if (criteria.categoryIds !== undefined && criteria.categoryIds.length > 0) {
    parts.push(inAnyCategorySpec(criteria.categoryIds));
  }

  if (criteria.tagIds !== undefined && criteria.tagIds.length > 0) {
    parts.push(hasAnyTagSpec(criteria.tagIds));
  }

  if (criteria.priorities !== undefined && criteria.priorities.length > 0) {
    parts.push(or(...criteria.priorities.map(hasPrioritySpec)));
  }

  if (criteria.onlyImportant === true) parts.push(isImportantSpec());
  if (criteria.onlyRecurring === true) parts.push(isRecurringSpec());
  if (criteria.onlyOverdue === true) parts.push(isOverdueSpec(now.toISOString()));

  if (criteria.dueFrom !== undefined || criteria.dueTo !== undefined) {
    const range = isDueBetweenSpec(
      criteria.dueFrom ?? new Date(0),
      criteria.dueTo ?? new Date(8_640_000_000_000_000),
    );
    parts.push(criteria.includeWithoutDueDate === true ? or(range, hasNoDueDateSpec()) : range);
  }

  return and(...parts);
};

export const excludeCompleted = (): Specification<Task> => not(hasStatus('completed'));
