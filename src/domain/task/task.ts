import type { CategoryId, SubtaskId, TagId, TaskId, UserId } from '../shared/branded';
import type { Attachment } from './attachment';
import type { IsoDateTime } from './value-objects/iso-date-time';
import type { Priority } from './value-objects/priority';
import type { RecurrenceRule } from '../recurrence/recurrence-rule';
import type { Result } from '../shared/result';
import type { Subtask } from './subtask';
import type { TaskStatus } from './value-objects/task-status';

import type { DomainError } from '../shared/domain-error';

import { DomainErrors } from '../shared/domain-error';
import { MAX_ATTACHMENTS_PER_TASK } from './attachment';
import { MAX_SUBTASKS_PER_TASK, allSubtasksDone, subtaskProgress } from './subtask';
import { advanceOccurrenceCount, nextOccurrence } from '../recurrence/recurrence-calculator';
import { byPosition, positionAfterLast } from '../shared/sortable-position';
import { canTransition } from './value-objects/task-status';
import { createTaskTitle } from './value-objects/task-title';
import { differenceInMinutes, addMinutes, toIso } from './value-objects/iso-date-time';
import { err, flatMap, ok } from '../shared/result';

/** Recordatorio por ubicacion. Solo lo puede disparar un cliente con GPS en segundo plano. */
export interface TaskLocation {
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
  /** Radio del geocerco en metros. */
  readonly radiusMeters: number;
  readonly trigger: 'enter' | 'exit';
}

/**
 * Tarea: la raiz del agregado.
 *
 * Modelada como datos inmutables y funciones puras, no como una clase con estado.
 * Esa decision no es estilistica: una tarea tiene que sobrevivir intacta a IndexedDB
 * (`structuredClone`), al puente IPC de Electron, a `JSON.stringify` en la cola de
 * sincronizacion y a la comparacion por referencia de React. Una clase con metodos
 * pierde su prototipo en el primer salto y obliga a rehidratar en cada frontera.
 *
 * Las invariantes se siguen respetando: no hay forma de construir ni de mutar una
 * Task fuera de las funciones de este modulo, y todas devuelven `Result`.
 */
export interface Task {
  readonly id: TaskId;
  readonly userId: UserId;
  readonly title: string;
  readonly notes: string | null;
  readonly status: TaskStatus;
  readonly priority: Priority;
  /** Marca destacada, independiente de la prioridad: "esto es lo de hoy". */
  readonly isImportant: boolean;
  readonly dueAt: IsoDateTime | null;
  /** `true` = vence "ese dia" sin hora concreta; cambia como se muestra y se avisa. */
  readonly isAllDay: boolean;
  readonly reminderAt: IsoDateTime | null;
  readonly completedAt: IsoDateTime | null;
  readonly categoryId: CategoryId | null;
  readonly tagIds: readonly TagId[];
  readonly subtasks: readonly Subtask[];
  readonly attachments: readonly Attachment[];
  readonly recurrence: RecurrenceRule | null;
  /** Id de la PRIMERA tarea de la serie. `null` en tareas sueltas. */
  readonly seriesId: TaskId | null;
  /** Cuantas veces se pospuso. Alimenta el informe de "lo que siempre pateo". */
  readonly snoozeCount: number;
  readonly position: number;
  readonly estimatedPomodoros: number | null;
  readonly completedPomodoros: number;
  readonly location: TaskLocation | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  /** Borrado logico. Necesario para que el borrado se propague al otro dispositivo. */
  readonly deletedAt: IsoDateTime | null;
}

// ---------------------------------------------------------------------------
// Creacion
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  readonly id: TaskId;
  readonly userId: UserId;
  readonly title: string;
  readonly now: IsoDateTime;
  readonly notes?: string | null;
  readonly priority?: Priority;
  readonly isImportant?: boolean;
  readonly dueAt?: IsoDateTime | null;
  readonly isAllDay?: boolean;
  readonly reminderAt?: IsoDateTime | null;
  readonly categoryId?: CategoryId | null;
  readonly tagIds?: readonly TagId[];
  readonly recurrence?: RecurrenceRule | null;
  readonly position?: number;
  readonly estimatedPomodoros?: number | null;
  readonly location?: TaskLocation | null;
}

export const createTask = (input: CreateTaskInput): Result<Task> =>
  flatMap(createTaskTitle(input.title), (title) => {
    const dueAt = input.dueAt ?? null;
    const reminderAt = input.reminderAt ?? null;

    // Un recordatorio despues del vencimiento no avisa de nada: llega tarde por diseño.
    if (dueAt !== null && reminderAt !== null && Date.parse(reminderAt) > Date.parse(dueAt)) {
      return err(
        DomainErrors.validation('El recordatorio no puede ser posterior al vencimiento.', {
          field: 'reminderAt',
        }),
      );
    }

    // Una regla de repeticion sin fecha de partida no tiene desde donde contar.
    if (input.recurrence != null && dueAt === null) {
      return err(
        DomainErrors.validation('Una tarea que se repite necesita una fecha de vencimiento.', {
          field: 'dueAt',
        }),
      );
    }

    const estimated = input.estimatedPomodoros ?? null;
    const estimatedError = validateEstimatedPomodoros(estimated);
    if (estimatedError !== null) return err(estimatedError);

    return ok({
      id: input.id,
      userId: input.userId,
      title,
      notes: normalizeNotes(input.notes),
      status: 'pending',
      priority: input.priority ?? 'medium',
      isImportant: input.isImportant ?? false,
      dueAt,
      isAllDay: input.isAllDay ?? false,
      reminderAt,
      completedAt: null,
      categoryId: input.categoryId ?? null,
      tagIds: [...new Set(input.tagIds ?? [])],
      subtasks: [],
      attachments: [],
      recurrence: input.recurrence ?? null,
      seriesId: null,
      snoozeCount: 0,
      position: input.position ?? positionAfterLast([]),
      estimatedPomodoros: estimated,
      completedPomodoros: 0,
      location: input.location ?? null,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    } satisfies Task);
  });

// ---------------------------------------------------------------------------
// Edicion
// ---------------------------------------------------------------------------

export interface UpdateTaskPatch {
  readonly title?: string;
  readonly notes?: string | null;
  readonly priority?: Priority;
  readonly isImportant?: boolean;
  readonly dueAt?: IsoDateTime | null;
  readonly isAllDay?: boolean;
  readonly reminderAt?: IsoDateTime | null;
  readonly categoryId?: CategoryId | null;
  readonly tagIds?: readonly TagId[];
  readonly recurrence?: RecurrenceRule | null;
  readonly estimatedPomodoros?: number | null;
  readonly location?: TaskLocation | null;
  readonly position?: number;
}

export const updateTask = (task: Task, patch: UpdateTaskPatch, now: IsoDateTime): Result<Task> => {
  const titleResult = patch.title === undefined ? ok(task.title) : createTaskTitle(patch.title);
  if (!titleResult.ok) return titleResult;

  const dueAt = patch.dueAt !== undefined ? patch.dueAt : task.dueAt;
  const reminderAt = patch.reminderAt !== undefined ? patch.reminderAt : task.reminderAt;

  if (dueAt !== null && reminderAt !== null && Date.parse(reminderAt) > Date.parse(dueAt)) {
    return err(
      DomainErrors.validation('El recordatorio no puede ser posterior al vencimiento.', {
        field: 'reminderAt',
      }),
    );
  }

  const recurrence = patch.recurrence !== undefined ? patch.recurrence : task.recurrence;
  if (recurrence !== null && dueAt === null) {
    return err(
      DomainErrors.validation('Una tarea que se repite necesita una fecha de vencimiento.', {
        field: 'dueAt',
      }),
    );
  }

  const estimated =
    patch.estimatedPomodoros !== undefined ? patch.estimatedPomodoros : task.estimatedPomodoros;

  const estimatedError = validateEstimatedPomodoros(estimated);
  if (estimatedError !== null) return err(estimatedError);

  return ok({
    ...task,
    title: titleResult.value,
    notes: patch.notes !== undefined ? normalizeNotes(patch.notes) : task.notes,
    priority: patch.priority ?? task.priority,
    isImportant: patch.isImportant ?? task.isImportant,
    dueAt,
    isAllDay: patch.isAllDay ?? task.isAllDay,
    reminderAt,
    categoryId: patch.categoryId !== undefined ? patch.categoryId : task.categoryId,
    tagIds: patch.tagIds !== undefined ? [...new Set(patch.tagIds)] : task.tagIds,
    recurrence,
    estimatedPomodoros: estimated,
    location: patch.location !== undefined ? patch.location : task.location,
    position: patch.position ?? task.position,
    updatedAt: now,
  });
};

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

export interface CompleteTaskDeps {
  readonly now: IsoDateTime;
  readonly nextTaskId: () => TaskId;
  readonly nextSubtaskId: () => SubtaskId;
}

export interface CompleteTaskOutcome {
  /** La instancia que se acaba de completar. */
  readonly completed: Task;
  /** La siguiente instancia de la serie, si la regla produce otra. */
  readonly next: Task | null;
}

/**
 * Completa una tarea y, si es recurrente, engendra la siguiente instancia.
 *
 * El modelo es "materializar una a la vez": en la base solo existe la ocurrencia
 * vigente. La alternativa (pre-generar un año de instancias) llena la tabla de filas
 * que casi nunca se miran y convierte cualquier edicion de la regla en una migracion.
 */
export const completeTask = (task: Task, deps: CompleteTaskDeps): Result<CompleteTaskOutcome> => {
  if (task.deletedAt !== null) {
    return err(DomainErrors.conflict('Esa tarea esta en la papelera.'));
  }

  if (!canTransition(task.status, 'completed')) {
    return err(
      DomainErrors.conflict('Esa tarea no se puede completar desde su estado actual.', {
        details: { status: task.status },
      }),
    );
  }

  if (task.status === 'completed') {
    return ok({ completed: task, next: null });
  }

  const completed: Task = {
    ...task,
    status: 'completed',
    completedAt: deps.now,
    updatedAt: deps.now,
    // Se corta la regla en la instancia completada: si el usuario deshace y vuelve a
    // completar, no debe generarse una segunda copia de la siguiente ocurrencia.
    recurrence: null,
    seriesId: task.seriesId ?? (task.recurrence !== null ? task.id : null),
  };

  if (task.recurrence === null || task.dueAt === null) {
    return ok({ completed, next: null });
  }

  const anchor = task.dueAt;
  const from = task.recurrence.fromCompletion ? deps.now : anchor;
  const nextDueAt = nextOccurrence(task.recurrence, { anchor, from });

  if (nextDueAt === null) {
    return ok({ completed, next: null });
  }

  const next: Task = {
    ...task,
    id: deps.nextTaskId(),
    status: 'pending',
    completedAt: null,
    dueAt: nextDueAt,
    reminderAt: shiftReminder(task.reminderAt, task.dueAt, nextDueAt),
    subtasks: resetSubtasksForNextOccurrence(task.subtasks, deps),
    // Los adjuntos no se copian: pertenecen a la ocurrencia concreta que los genero.
    attachments: [],
    recurrence: advanceOccurrenceCount(task.recurrence),
    seriesId: task.seriesId ?? task.id,
    snoozeCount: 0,
    completedPomodoros: 0,
    createdAt: deps.now,
    updatedAt: deps.now,
  };

  return ok({ completed, next });
};

/** Deshacer: devuelve la tarea a pendiente. */
export const uncompleteTask = (task: Task, now: IsoDateTime): Result<Task> => {
  if (task.status !== 'completed') {
    return err(DomainErrors.conflict('Esa tarea no esta completada.'));
  }

  return ok({
    ...task,
    status: 'pending',
    completedAt: null,
    updatedAt: now,
  });
};

export const archiveTask = (task: Task, now: IsoDateTime): Result<Task> => {
  if (!canTransition(task.status, 'archived')) {
    return err(DomainErrors.conflict('Esa tarea no se puede archivar.'));
  }

  /**
   * ARCHIVAR LIMPIA LA FECHA DE COMPLETADO, y no es un detalle cosmetico.
   *
   * La regla del modelo es "esta completada si y solo si tiene fecha de completado", y el
   * servidor la impone con una restriccion. Archivar una tarea YA COMPLETADA -que es el
   * camino normal: se termina algo y se quita de en medio- producia `archived` con fecha
   * de completado, o sea una fila que el servidor rechaza siempre.
   *
   * El efecto no se quedaba en esa tarea. La fila rechazada volvia en cada intento, se
   * llevaba consigo el resto del lote y acababa descartada sin que nada lo dijera: bastaba
   * archivar una tarea terminada para que ese dispositivo dejara de subir.
   */
  return ok({ ...task, status: 'archived', completedAt: null, updatedAt: now });
};

export const restoreTask = (task: Task, now: IsoDateTime): Result<Task> =>
  ok({ ...task, status: 'pending', completedAt: null, deletedAt: null, updatedAt: now });

/**
 * Borrado logico. Nunca se borra fisicamente desde el cliente: la fila con
 * `deleted_at` es la unica forma de que el otro dispositivo se entere del borrado.
 * Un DELETE real simplemente reaparece en la siguiente sincronizacion.
 */
export const softDeleteTask = (task: Task, now: IsoDateTime): Task => ({
  ...task,
  deletedAt: now,
  updatedAt: now,
});

// ---------------------------------------------------------------------------
// Posponer
// ---------------------------------------------------------------------------

/**
 * Pospone la tarea a un nuevo instante, arrastrando el recordatorio con la misma
 * antelacion que tenia. Un toque, sin abrir el editor de fechas.
 */
export const snoozeTask = (task: Task, until: IsoDateTime, now: IsoDateTime): Result<Task> => {
  if (Date.parse(until) <= Date.parse(now)) {
    return err(
      DomainErrors.validation('La nueva fecha tiene que estar en el futuro.', { field: 'dueAt' }),
    );
  }

  return ok({
    ...task,
    status: task.status === 'completed' ? 'pending' : task.status,
    completedAt: null,
    dueAt: until,
    reminderAt: shiftReminder(task.reminderAt, task.dueAt, until),
    snoozeCount: task.snoozeCount + 1,
    updatedAt: now,
  });
};

// ---------------------------------------------------------------------------
// Subtareas
// ---------------------------------------------------------------------------

export const attachSubtask = (task: Task, subtask: Subtask, now: IsoDateTime): Result<Task> => {
  if (task.subtasks.length >= MAX_SUBTASKS_PER_TASK) {
    return err(
      DomainErrors.invariant(`Una tarea no puede tener mas de ${MAX_SUBTASKS_PER_TASK} subtareas.`),
    );
  }

  return ok({
    ...task,
    subtasks: [...task.subtasks, subtask].sort(byPosition),
    updatedAt: now,
  });
};

export const replaceSubtasks = (
  task: Task,
  subtasks: readonly Subtask[],
  now: IsoDateTime,
): Task => ({
  ...task,
  subtasks: [...subtasks].sort(byPosition),
  updatedAt: now,
});

export const detachSubtask = (task: Task, subtaskId: SubtaskId, now: IsoDateTime): Task => ({
  ...task,
  subtasks: task.subtasks.filter((subtask) => subtask.id !== subtaskId),
  updatedAt: now,
});

// ---------------------------------------------------------------------------
// Adjuntos
// ---------------------------------------------------------------------------

export const attachAttachment = (
  task: Task,
  attachment: Attachment,
  now: IsoDateTime,
): Result<Task> => {
  if (task.attachments.length >= MAX_ATTACHMENTS_PER_TASK) {
    return err(
      DomainErrors.invariant(
        `Una tarea no puede tener mas de ${MAX_ATTACHMENTS_PER_TASK} adjuntos.`,
      ),
    );
  }

  return ok({ ...task, attachments: [...task.attachments, attachment], updatedAt: now });
};

export const detachAttachment = (task: Task, attachmentId: string, now: IsoDateTime): Task => ({
  ...task,
  attachments: task.attachments.filter((attachment) => attachment.id !== attachmentId),
  updatedAt: now,
});

// ---------------------------------------------------------------------------
// Pomodoro
// ---------------------------------------------------------------------------

export const recordPomodoro = (task: Task, now: IsoDateTime): Task => ({
  ...task,
  completedPomodoros: task.completedPomodoros + 1,
  updatedAt: now,
});

// ---------------------------------------------------------------------------
// Consultas derivadas
// ---------------------------------------------------------------------------

export const isPending = (task: Task): boolean =>
  task.status === 'pending' && task.deletedAt === null;

export const isOverdue = (task: Task, now: IsoDateTime): boolean =>
  isPending(task) && task.dueAt !== null && Date.parse(task.dueAt) < Date.parse(now);

export const isCompleted = (task: Task): boolean => task.status === 'completed';

/** Progreso 0..1: por subtareas si las hay, si no por el propio estado. */
export const taskProgress = (task: Task): number => {
  if (task.subtasks.length > 0) return subtaskProgress(task.subtasks);
  return task.status === 'completed' ? 1 : 0;
};

/** `true` cuando todas las subtareas estan hechas pero la tarea sigue pendiente. */
export const isReadyToComplete = (task: Task): boolean =>
  isPending(task) && allSubtasksDone(task.subtasks);

export const hasReminder = (task: Task): boolean => task.reminderAt !== null && isPending(task);

export const belongsToSeries = (task: Task): boolean =>
  task.seriesId !== null || task.recurrence !== null;

// ---------------------------------------------------------------------------
// Auxiliares privados
// ---------------------------------------------------------------------------

/**
 * Reubica el recordatorio conservando su antelacion respecto al vencimiento.
 * Si avisaba 30 minutos antes, seguira avisando 30 minutos antes de la nueva fecha.
 */
const shiftReminder = (
  reminderAt: IsoDateTime | null,
  previousDueAt: IsoDateTime | null,
  nextDueAt: IsoDateTime,
): IsoDateTime | null => {
  if (reminderAt === null) return null;
  if (previousDueAt === null) return nextDueAt;

  const leadMinutes = differenceInMinutes(previousDueAt, reminderAt);
  return addMinutes(nextDueAt, -leadMinutes);
};

const resetSubtasksForNextOccurrence = (
  subtasks: readonly Subtask[],
  deps: CompleteTaskDeps,
): Subtask[] =>
  subtasks.map((subtask) => ({
    ...subtask,
    id: deps.nextSubtaskId(),
    isDone: false,
    completedAt: null,
    createdAt: deps.now,
    updatedAt: deps.now,
  }));

/**
 * Tope de las notas. Es el MISMO numero que la restriccion del servidor, a proposito.
 *
 * Sin el, pegar un acta de reunion o un correo entero en las notas creaba una tarea que la
 * app aceptaba y el servidor rechazaba para siempre. El limite tiene que vivir aqui, en el
 * dominio, y no solo en el formulario: la importacion de respaldos y cualquier pantalla
 * futura pasan por aqui, no por ese formulario.
 */
export const MAX_NOTES_LENGTH = 20_000;

/**
 * El rango que acepta el servidor, comprobado en un solo sitio.
 *
 * Estaba escrito a mano dentro de `createTask` y no existia en `updateTask`, asi que crear
 * una tarea con 75 pomodoros era imposible pero cambiarsela a 75 despues no: la fila salia
 * valida de la app y el servidor la rechazaba. Extraerlo es lo que impide que los dos
 * caminos vuelvan a discrepar.
 */
const validateEstimatedPomodoros = (estimated: number | null): DomainError | null => {
  if (estimated === null) return null;
  if (Number.isInteger(estimated) && estimated >= 1 && estimated <= 50) return null;

  return DomainErrors.validation('Los pomodoros estimados deben ser un entero entre 1 y 50.', {
    field: 'estimatedPomodoros',
  });
};

const normalizeNotes = (notes: string | null | undefined): string | null => {
  if (notes === null || notes === undefined) return null;
  const trimmed = notes.trim();
  if (trimmed.length === 0) return null;
  // Se recorta en vez de rechazar: quien pega un texto largo quiere guardar la tarea, y
  // perder el sobrante es mucho menos malo que perder la tarea entera.
  return trimmed.slice(0, MAX_NOTES_LENGTH);
};

/** Instante actual como ISO. Atajo para las pruebas; la app usa el puerto `Clock`. */
export const nowIso = (): IsoDateTime => toIso(new Date());
