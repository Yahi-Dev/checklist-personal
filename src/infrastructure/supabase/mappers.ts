import type { Attachment } from '../../domain/task/attachment';
import type { Category } from '../../domain/category/category';
import type {
  CategoryRow,
  ClassAttendanceRow,
  ClassAttendanceUpsert,
  CategoryUpsert,
  FocusSessionRow,
  FocusSessionUpsert,
  Json,
  ScheduleBlockRow,
  ScheduleBlockUpsert,
  SubjectNoteRow,
  SubjectNoteUpsert,
  SubjectRow,
  SubjectUpsert,
  TagRow,
  TagUpsert,
  TaskRow,
  TaskUpsert,
} from './database.types';
import type {
  CategoryId,
  ClassAttendanceId,
  ScheduleBlockId,
  SubjectId,
  SubjectNoteId,
  TagId,
  TaskId,
  UserId,
} from '../../domain/shared/branded';
import type { FocusSession } from '../../domain/focus/focus-session';
import type { RecurrenceRule, Weekday } from '../../domain/recurrence/recurrence-rule';
import type { ScheduleBlock } from '../../domain/schedule/schedule-block';
import type { Subject } from '../../domain/schedule/subject';
import type { ClassAttendance } from '../../domain/schedule/class-attendance';
import type { SubjectNote } from '../../domain/schedule/subject-note';
import type { Subtask } from '../../domain/task/subtask';
import type { Tag } from '../../domain/tag/tag';
import type { Task, TaskLocation } from '../../domain/task/task';

import { brandId } from '../../domain/shared/branded';
import {
  DEFAULT_ATTENTION,
  isAttentionLevel,
} from '../../domain/schedule/value-objects/attention-level';
import { isAttendanceStatus } from '../../domain/schedule/class-attendance';
import { isSubjectNoteKind } from '../../domain/schedule/subject-note';

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
  subject_id: task.subjectId,
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
  /* `?? null` y no `row.subject_id` a secas: durante la ventana en que el cliente ya
     conoce la columna y el servidor todavia no, la fila llega SIN el campo y el valor es
     `undefined`, que no es lo mismo que `null` para el resto del dominio. */
  subjectId: row.subject_id == null ? null : brandId<SubjectId>(row.subject_id),
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
// Horario academico
// ---------------------------------------------------------------------------

export const subjectToRow = (subject: Subject): SubjectUpsert => ({
  id: subject.id,
  user_id: subject.userId,
  code: subject.code,
  name: subject.name,
  section: subject.section,
  credits: subject.credits,
  teacher_code: subject.teacherCode,
  teacher_name: subject.teacherName,
  color: subject.color,
  attention: subject.attention,
  max_absences: subject.maxAbsences,
  term_code: subject.termCode,
  starts_on: subject.startsOn,
  ends_on: subject.endsOn,
  position: subject.position,
  created_at: subject.createdAt,
  updated_at: subject.updatedAt,
  deleted_at: subject.deletedAt,
});

export const rowToSubject = (row: SubjectRow): Subject => ({
  id: brandId<SubjectId>(row.id),
  userId: brandId<UserId>(row.user_id),
  code: row.code,
  name: row.name,
  section: row.section,
  credits: row.credits,
  teacherCode: row.teacher_code,
  teacherName: row.teacher_name,
  color: row.color,
  /* Mismo motivo que en la tarea: si el servidor aun no tiene la columna, aqui llega
     `undefined` y dejaria una asignatura con un nivel de atencion imposible. */
  attention: isAttentionLevel(row.attention) ? row.attention : DEFAULT_ATTENTION,
  maxAbsences: row.max_absences ?? null,
  termCode: row.term_code,
  /* `starts_on` es `date`, no `timestamptz`: ya viene como `AAAA-MM-DD` y pasarlo por
     `normalizeTimestamp` lo convertiria en un instante UTC y le restaria un dia a
     cualquiera que este al oeste de Greenwich. */
  startsOn: row.starts_on,
  endsOn: row.ends_on,
  position: row.position,
  createdAt: normalizeTimestamp(row.created_at) ?? row.created_at,
  updatedAt: normalizeTimestamp(row.updated_at) ?? row.updated_at,
  deletedAt: normalizeTimestamp(row.deleted_at),
});

export const scheduleBlockToRow = (block: ScheduleBlock): ScheduleBlockUpsert => ({
  id: block.id,
  user_id: block.userId,
  subject_id: block.subjectId,
  weekday: block.weekday,
  starts_at: block.startsAt,
  ends_at: block.endsAt,
  modality: block.modality,
  location_label: block.locationLabel,
  is_remote: block.isRemote,
  starts_on: block.startsOn,
  ends_on: block.endsOn,
  created_at: block.createdAt,
  updated_at: block.updatedAt,
  deleted_at: block.deletedAt,
});

export const rowToScheduleBlock = (row: ScheduleBlockRow): ScheduleBlock => ({
  id: brandId<ScheduleBlockId>(row.id),
  userId: brandId<UserId>(row.user_id),
  subjectId: brandId<SubjectId>(row.subject_id),
  weekday: asWeekday(row.weekday),
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  modality: row.modality,
  locationLabel: row.location_label,
  isRemote: row.is_remote,
  startsOn: row.starts_on,
  endsOn: row.ends_on,
  createdAt: normalizeTimestamp(row.created_at) ?? row.created_at,
  updatedAt: normalizeTimestamp(row.updated_at) ?? row.updated_at,
  deletedAt: normalizeTimestamp(row.deleted_at),
});

export const subjectNoteToRow = (note: SubjectNote): SubjectNoteUpsert => ({
  id: note.id,
  user_id: note.userId,
  subject_id: note.subjectId,
  kind: note.kind,
  body: note.body,
  is_pinned: note.isPinned,
  position: note.position,
  created_at: note.createdAt,
  updated_at: note.updatedAt,
  deleted_at: note.deletedAt,
});

export const rowToSubjectNote = (row: SubjectNoteRow): SubjectNote => ({
  id: brandId<SubjectNoteId>(row.id),
  userId: brandId<UserId>(row.user_id),
  subjectId: brandId<SubjectId>(row.subject_id),
  kind: isSubjectNoteKind(row.kind) ? row.kind : 'note',
  body: row.body,
  isPinned: row.is_pinned,
  position: row.position,
  createdAt: normalizeTimestamp(row.created_at) ?? row.created_at,
  updatedAt: normalizeTimestamp(row.updated_at) ?? row.updated_at,
  deletedAt: normalizeTimestamp(row.deleted_at),
});

export const classAttendanceToRow = (record: ClassAttendance): ClassAttendanceUpsert => ({
  id: record.id,
  user_id: record.userId,
  block_id: record.blockId,
  subject_id: record.subjectId,
  session_date: record.sessionDate,
  status: record.status,
  note: record.note,
  created_at: record.createdAt,
  updated_at: record.updatedAt,
  deleted_at: record.deletedAt,
});

export const rowToClassAttendance = (row: ClassAttendanceRow): ClassAttendance => ({
  id: brandId<ClassAttendanceId>(row.id),
  userId: brandId<UserId>(row.user_id),
  blockId: brandId<ScheduleBlockId>(row.block_id),
  subjectId: brandId<SubjectId>(row.subject_id),
  /* `session_date` es `date`, no `timestamptz`: ya viene como AAAA-MM-DD y pasarlo por
     `normalizeTimestamp` lo convertiria en un instante UTC, restandole un dia a
     cualquiera que este al oeste de Greenwich. Marcar el martes y ver el lunes seria el
     sintoma, y en un control de faltas eso es un error caro. */
  sessionDate: row.session_date,
  status: isAttendanceStatus(row.status) ? row.status : 'absent',
  note: row.note,
  createdAt: normalizeTimestamp(row.created_at) ?? row.created_at,
  updatedAt: normalizeTimestamp(row.updated_at) ?? row.updated_at,
  deletedAt: normalizeTimestamp(row.deleted_at),
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

/**
 * La columna lleva un `check (weekday between 0 and 6)`, pero eso lo garantiza el
 * servidor, no el compilador. Se acota igualmente al entrar: una fila corrupta debe
 * caer en un dia valido, no dejar un `Weekday` imposible circulando por el dominio.
 */
const asWeekday = (value: number): Weekday =>
  Math.min(6, Math.max(0, Math.trunc(value))) as Weekday;

const asArray = <T>(value: Json): T[] => (Array.isArray(value) ? (value as T[]) : []);

const asObject = <T>(value: Json | null): T | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
