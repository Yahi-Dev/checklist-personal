import type { Attachment } from '../../domain/task/attachment';
import type { Category } from '../../domain/category/category';
import type {
  CategoryRow,
  CategoryUpsert,
  FocusSessionRow,
  FocusSessionUpsert,
  Json,
  TagRow,
  TagUpsert,
  TaskRow,
  TaskUpsert,
} from './database.types';
import type { CategoryId, TagId, TaskId, UserId } from '../../domain/shared/branded';
import type { FocusSession } from '../../domain/focus/focus-session';
import type { RecurrenceRule } from '../../domain/recurrence/recurrence-rule';
import type { Subtask } from '../../domain/task/subtask';
import type { Tag } from '../../domain/tag/tag';
import type { Task, TaskLocation } from '../../domain/task/task';

import { brandId } from '../../domain/shared/branded';

/**
 * Traduccion entre el modelo de dominio (camelCase) y las filas de Postgres (snake_case).
 *
 * Esta capa existe para que renombrar una columna no obligue a tocar el dominio, y
 * para que el dominio no herede las peculiaridades del almacenamiento: `jsonb` llega
 * como `unknown` y hay que estrecharlo, y Postgres devuelve `timestamptz` con formato
 * `+00:00` donde JavaScript usa `Z`.
 */

// ---------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------

export const taskToRow = (task: Task): TaskUpsert => ({
  id: task.id,
  user_id: task.userId,
  title: task.title,
  notes: task.notes,
  status: task.status,
  priority: task.priority,
  is_important: task.isImportant,
  due_at: task.dueAt,
  is_all_day: task.isAllDay,
  reminder_at: task.reminderAt,
  completed_at: task.completedAt,
  category_id: task.categoryId,
  tag_ids: [...task.tagIds],
  subtasks: task.subtasks as unknown as Json,
  attachments: task.attachments as unknown as Json,
  recurrence: task.recurrence as unknown as Json | null,
  series_id: task.seriesId,
  snooze_count: task.snoozeCount,
  position: task.position,
  estimated_pomodoros: task.estimatedPomodoros,
  completed_pomodoros: task.completedPomodoros,
  location: task.location as unknown as Json | null,
  created_at: task.createdAt,
  updated_at: task.updatedAt,
  deleted_at: task.deletedAt,
});

export const rowToTask = (row: TaskRow): Task => ({
  id: brandId<TaskId>(row.id),
  userId: brandId<UserId>(row.user_id),
  title: row.title,
  notes: row.notes,
  status: row.status,
  priority: row.priority,
  isImportant: row.is_important,
  dueAt: normalizeTimestamp(row.due_at),
  isAllDay: row.is_all_day,
  reminderAt: normalizeTimestamp(row.reminder_at),
  completedAt: normalizeTimestamp(row.completed_at),
  categoryId: row.category_id === null ? null : brandId<CategoryId>(row.category_id),
  tagIds: (row.tag_ids ?? []).map((id) => brandId<TagId>(id)),
  subtasks: asArray<Subtask>(row.subtasks),
  attachments: asArray<Attachment>(row.attachments),
  recurrence: asObject<RecurrenceRule>(row.recurrence),
  seriesId: row.series_id === null ? null : brandId<TaskId>(row.series_id),
  snoozeCount: row.snooze_count ?? 0,
  position: row.position ?? 0,
  estimatedPomodoros: row.estimated_pomodoros,
  completedPomodoros: row.completed_pomodoros ?? 0,
  location: asObject<TaskLocation>(row.location),
  createdAt: normalizeTimestamp(row.created_at) ?? row.created_at,
  updatedAt: normalizeTimestamp(row.updated_at) ?? row.updated_at,
  deletedAt: normalizeTimestamp(row.deleted_at),
});

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

export const categoryToRow = (category: Category): CategoryUpsert => ({
  id: category.id,
  user_id: category.userId,
  name: category.name,
  color: category.color,
  icon: category.icon,
  position: category.position,
  created_at: category.createdAt,
  updated_at: category.updatedAt,
  deleted_at: category.deletedAt,
});

export const rowToCategory = (row: CategoryRow): Category => ({
  id: brandId<CategoryId>(row.id),
  userId: brandId<UserId>(row.user_id),
  name: row.name,
  color: row.color,
  icon: row.icon,
  position: row.position ?? 0,
  createdAt: normalizeTimestamp(row.created_at) ?? row.created_at,
  updatedAt: normalizeTimestamp(row.updated_at) ?? row.updated_at,
  deletedAt: normalizeTimestamp(row.deleted_at),
});

// ---------------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------------

export const tagToRow = (tag: Tag): TagUpsert => ({
  id: tag.id,
  user_id: tag.userId,
  name: tag.name,
  slug: tag.slug,
  color: tag.color,
  created_at: tag.createdAt,
  updated_at: tag.updatedAt,
  deleted_at: tag.deletedAt,
});

export const rowToTag = (row: TagRow): Tag => ({
  id: brandId<TagId>(row.id),
  userId: brandId<UserId>(row.user_id),
  name: row.name,
  slug: row.slug,
  color: row.color,
  createdAt: normalizeTimestamp(row.created_at) ?? row.created_at,
  updatedAt: normalizeTimestamp(row.updated_at) ?? row.updated_at,
  deletedAt: normalizeTimestamp(row.deleted_at),
});

// ---------------------------------------------------------------------------
// Sesiones de concentracion
// ---------------------------------------------------------------------------

export const focusSessionToRow = (session: FocusSession): FocusSessionUpsert => ({
  id: session.id,
  user_id: session.userId,
  task_id: session.taskId,
  mode: session.mode,
  started_at: session.startedAt,
  ended_at: session.endedAt,
  planned_seconds: session.plannedSeconds,
  elapsed_seconds: session.elapsedSeconds,
  was_completed: session.wasCompleted,
  created_at: session.createdAt,
  updated_at: session.updatedAt,
});

export const rowToFocusSession = (row: FocusSessionRow): FocusSession => ({
  id: brandId(row.id),
  userId: brandId<UserId>(row.user_id),
  taskId: row.task_id === null ? null : brandId<TaskId>(row.task_id),
  mode: row.mode,
  startedAt: normalizeTimestamp(row.started_at) ?? row.started_at,
  endedAt: normalizeTimestamp(row.ended_at),
  plannedSeconds: row.planned_seconds,
  elapsedSeconds: row.elapsed_seconds,
  wasCompleted: row.was_completed,
  createdAt: normalizeTimestamp(row.created_at) ?? row.created_at,
  updatedAt: normalizeTimestamp(row.updated_at) ?? row.updated_at,
});

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/**
 * Postgres devuelve `2026-08-02 18:30:00+00`, JavaScript produce
 * `2026-08-02T18:30:00.000Z`. Son el mismo instante pero strings distintos, y el
 * dominio compara marcas de tiempo como texto en varios sitios. Se normaliza al
 * entrar para que esa comparacion sea siempre valida.
 */
const normalizeTimestamp = (value: string | null): string | null => {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
};

const asArray = <T>(value: Json): T[] => (Array.isArray(value) ? (value as T[]) : []);

const asObject = <T>(value: Json | null): T | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
