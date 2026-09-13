import { z } from 'zod';

/**
 * Esquema del archivo de respaldo.
 *
 * Este es el unico punto de la capa de aplicacion que usa una libreria externa (zod),
 * y es a proposito: un JSON que el usuario puede haber editado a mano, movido entre
 * versiones de la app o truncado a medias es entrada HOSTIL. Validarlo campo a campo
 * con `if` seria mas codigo, menos legible y con mas huecos.
 *
 * `BACKUP_VERSION` sube cada vez que el formato cambia de forma incompatible; la
 * funcion de migracion decide como leer los archivos viejos.
 */
export const BACKUP_VERSION = 1;

export const BACKUP_FORMAT_ID = 'checklist-personal-backup';

const isoDateTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Fecha ISO no valida',
});

const nullableIso = isoDateTime.nullable();

const recurrenceSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(365),
  weekdays: z.array(z.number().int().min(0).max(6)),
  dayOfMonth: z.number().int().min(1).max(31).nullable(),
  monthlyMode: z.enum(['day-of-month', 'day-of-week']),
  weekOfMonth: z.number().int(),
  ends: z.union([
    z.object({ kind: z.literal('never') }),
    z.object({ kind: z.literal('on'), date: isoDateTime }),
    z.object({ kind: z.literal('after'), occurrences: z.number().int().min(1) }),
  ]),
  fromCompletion: z.boolean(),
  occurrenceCount: z.number().int().min(0),
});

const subtaskSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  title: z.string(),
  isDone: z.boolean(),
  position: z.number(),
  completedAt: nullableIso,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

const attachmentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  userId: z.string(),
  kind: z.enum(['link', 'image', 'file']),
  name: z.string(),
  url: z.string(),
  storagePath: z.string().nullable(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  createdAt: isoDateTime,
});

const locationSchema = z.object({
  label: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  radiusMeters: z.number(),
  trigger: z.enum(['enter', 'exit']),
});

export const taskBackupSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  notes: z.string().nullable(),
  status: z.enum(['pending', 'completed', 'archived']),
  priority: z.enum(['low', 'medium', 'high']),
  isImportant: z.boolean(),
  dueAt: nullableIso,
  isAllDay: z.boolean(),
  reminderAt: nullableIso,
  completedAt: nullableIso,
  categoryId: z.string().nullable(),
  /* `.nullish()` y no `.nullable()`: un respaldo hecho antes de que existiera la
     relacion con el horario no trae el campo, y exigirlo lo dejaria invalido. */
  subjectId: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  tagIds: z.array(z.string()),
  subtasks: z.array(subtaskSchema),
  attachments: z.array(attachmentSchema),
  recurrence: recurrenceSchema.nullable(),
  seriesId: z.string().nullable(),
  snoozeCount: z.number().int().min(0),
  position: z.number(),
  estimatedPomodoros: z.number().nullable(),
  completedPomodoros: z.number().int().min(0),
  location: locationSchema.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: nullableIso,
});

export const categoryBackupSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  position: z.number(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: nullableIso,
});

export const tagBackupSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  slug: z.string(),
  color: z.string(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: nullableIso,
});

export const focusSessionBackupSchema = z.object({
  id: z.string(),
  userId: z.string(),
  taskId: z.string().nullable(),
  mode: z.enum(['focus', 'short-break', 'long-break']),
  startedAt: isoDateTime,
  endedAt: nullableIso,
  plannedSeconds: z.number().int(),
  elapsedSeconds: z.number().int(),
  wasCompleted: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, { message: 'Fecha AAAA-MM-DD no valida' })
  .nullable();

export const subjectBackupSchema = z.object({
  id: z.string(),
  userId: z.string(),
  code: z.string(),
  name: z.string(),
  section: z.string(),
  credits: z.number().int().nullable(),
  teacherCode: z.string().nullable(),
  teacherName: z.string().nullable(),
  color: z.string(),
  attention: z
    .enum(['critical', 'watch', 'normal', 'relaxed'])
    .nullish()
    .transform((value) => value ?? 'normal'),
  termCode: z.string(),
  startsOn: calendarDate,
  endsOn: calendarDate,
  position: z.number(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: nullableIso,
});

export const scheduleBlockBackupSchema = z.object({
  id: z.string(),
  userId: z.string(),
  subjectId: z.string(),
  weekday: z.number().int().min(0).max(6),
  startsAt: z.string().regex(/^\d{2}:\d{2}$/u, { message: 'Hora HH:mm no valida' }),
  endsAt: z.string().regex(/^\d{2}:\d{2}$/u, { message: 'Hora HH:mm no valida' }),
  modality: z.enum(['presencial', 'semipresencial', 'virtual']),
  locationLabel: z.string(),
  isRemote: z.boolean(),
  startsOn: calendarDate,
  endsOn: calendarDate,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: nullableIso,
});

export const subjectNoteBackupSchema = z.object({
  id: z.string(),
  userId: z.string(),
  subjectId: z.string(),
  kind: z.enum(['exam', 'assignment', 'notice', 'note']),
  body: z.string(),
  isPinned: z.boolean(),
  position: z.number(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: nullableIso,
});

export const backupFileSchema = z.object({
  format: z.literal(BACKUP_FORMAT_ID),
  version: z.number().int().min(1).max(BACKUP_VERSION),
  exportedAt: isoDateTime,
  appVersion: z.string().optional(),
  data: z.object({
    tasks: z.array(taskBackupSchema),
    categories: z.array(categoryBackupSchema),
    tags: z.array(tagBackupSchema),
    focusSessions: z.array(focusSessionBackupSchema).default([]),
    /* `.default([])` no es decorativo: sin el, un respaldo hecho ANTES de que existiera
       el horario dejaria de validar y el usuario no podria restaurar sus propias
       tareas por culpa de una funcion que no usaba. */
    subjects: z.array(subjectBackupSchema).default([]),
    scheduleBlocks: z.array(scheduleBlockBackupSchema).default([]),
    subjectNotes: z.array(subjectNoteBackupSchema).default([]),
  }),
});

export type BackupFile = z.infer<typeof backupFileSchema>;
