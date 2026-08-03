import type { Category } from '../category/category';
import type { Priority } from '../task/value-objects/priority';
import type { Tag } from '../tag/tag';
import type { Task } from '../task/task';
import type { TaskId } from '../shared/branded';

import { isPending } from '../task/task';
import { priorityWeight } from '../task/value-objects/priority';
import { startOfLocalDay } from '../shared/clock';

/**
 * El resumen que se le manda al asistente.
 *
 * Es una PROYECCION, no la tarea entera. La diferencia importa por tres motivos:
 *
 *   1. Cada campo que viaja se paga en tokens en cada mensaje de la conversacion.
 *      Mandar el agregado completo (adjuntos, posiciones fraccionarias, marcas de
 *      sincronizacion) es pagar por ruido que no ayuda a decidir que hacer primero.
 *   2. Lo que no se manda no se puede filtrar. Los adjuntos y las rutas de Storage se
 *      quedan fuera a proposito: para priorizar no hacen falta.
 *   3. El modelo decide mejor con datos ya interpretados. `atrasada` es mas util que
 *      una fecha ISO que obliga a comparar contra el reloj mentalmente.
 *
 * Construirlo aqui, en el dominio, y no en el servidor, tiene una consecuencia
 * practica: se puede probar sin red y sin clave de API.
 */

/** En que punto del calendario cae la tarea respecto a ahora mismo. */
export type BriefHorizon = 'atrasada' | 'hoy' | 'pronto' | 'sin-fecha';

export interface BriefTask {
  readonly id: TaskId;
  readonly titulo: string;
  readonly horizonte: BriefHorizon;
  readonly prioridad: Priority;
  readonly destacada: boolean;
  /** Vencimiento en hora local legible, o `null` si no tiene. */
  readonly vence: string | null;
  /** Negativo = ya paso. Solo cuando hay fecha. */
  readonly minutosParaVencer: number | null;
  /** Estimacion del usuario en minutos (pomodoros x 25), no del modelo. */
  readonly minutosEstimados: number | null;
  readonly subtareas: { readonly hechas: number; readonly total: number } | null;
  /** Cuantas veces se pospuso. Una tarea muy pospuesta suele esconder un problema. */
  readonly vecesPospuesta: number;
  readonly categoria: string | null;
  readonly etiquetas: readonly string[];
  readonly notas: string | null;
}

export interface PlanningBrief {
  /** Momento actual en hora local legible. El modelo no tiene reloj propio. */
  readonly ahora: string;
  readonly zonaHoraria: string;
  readonly tareas: readonly BriefTask[];
  readonly completadasHoy: number;
  /**
   * Cuantas quedaron fuera por el limite. Se informa SIEMPRE: un recorte silencioso
   * haria que el modelo hablara con total seguridad de un dia que no vio entero.
   */
  readonly omitidas: number;
}

/** Tope de tareas en el resumen. Por encima, el modelo pierde foco y el coste sube. */
export const MAX_BRIEF_TASKS = 40;

/** Cuantos dias hacia delante entran como "pronto". */
const SOON_DAYS = 3;

/** Las notas van recortadas: son contexto, no el cuerpo del mensaje. */
const MAX_NOTES_CHARS = 240;

const MINUTES_PER_POMODORO = 25;

export interface BuildBriefInput {
  readonly tasks: readonly Task[];
  readonly now: Date;
  readonly categories?: readonly Category[];
  readonly tags?: readonly Tag[];
  readonly locale?: string;
  readonly timeZone?: string;
  readonly maxTasks?: number;
}

export const buildPlanningBrief = (input: BuildBriefInput): PlanningBrief => {
  const { tasks, now } = input;
  const locale = input.locale ?? 'es-DO';
  const timeZone = input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const maxTasks = input.maxTasks ?? MAX_BRIEF_TASKS;

  const categoryNames = new Map(input.categories?.map((c) => [c.id, c.name]) ?? []);
  const tagNames = new Map(input.tags?.map((t) => [t.id, t.name]) ?? []);

  const nowMs = now.getTime();
  const todayStart = startOfLocalDay(now).getTime();
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;
  const soonEnd = todayEnd + SOON_DAYS * 24 * 60 * 60 * 1000;

  const candidates: BriefTask[] = [];
  let completedToday = 0;

  for (const task of tasks) {
    if (task.deletedAt !== null) continue;

    if (task.status === 'completed') {
      if (task.completedAt !== null) {
        const at = Date.parse(task.completedAt);
        if (at >= todayStart && at < todayEnd) completedToday += 1;
      }
      continue;
    }

    if (!isPending(task)) continue;

    const dueMs = task.dueAt === null ? null : Date.parse(task.dueAt);

    // Lo que vence pasado el horizonte no entra: preguntar "que hago ahora" no se
    // responde mejor viendo la tarea del mes que viene, y cada fila cuesta tokens.
    if (dueMs !== null && dueMs >= soonEnd) continue;

    candidates.push({
      id: task.id,
      titulo: task.title,
      horizonte: horizonOf(dueMs, nowMs, todayEnd),
      prioridad: task.priority,
      destacada: task.isImportant,
      vence: dueMs === null ? null : formatMoment(dueMs, task.isAllDay, locale, timeZone),
      minutosParaVencer: dueMs === null ? null : Math.round((dueMs - nowMs) / 60_000),
      minutosEstimados:
        task.estimatedPomodoros === null ? null : task.estimatedPomodoros * MINUTES_PER_POMODORO,
      subtareas:
        task.subtasks.length === 0
          ? null
          : {
              hechas: task.subtasks.filter((subtask) => subtask.isDone).length,
              total: task.subtasks.length,
            },
      vecesPospuesta: task.snoozeCount,
      categoria: task.categoryId === null ? null : (categoryNames.get(task.categoryId) ?? null),
      etiquetas: task.tagIds.map((id) => tagNames.get(id)).filter((name) => name !== undefined),
      notas: truncate(task.notes, MAX_NOTES_CHARS),
    });
  }

  // El orden es el que el modelo leera primero. Se pone delante lo mas urgente para
  // que un recorte por el limite se lleve lo menos relevante, nunca lo atrasado.
  candidates.sort(byUrgency);

  return {
    ahora: formatMoment(nowMs, false, locale, timeZone),
    zonaHoraria: timeZone,
    tareas: candidates.slice(0, maxTasks),
    completadasHoy: completedToday,
    omitidas: Math.max(0, candidates.length - maxTasks),
  };
};

// ---------------------------------------------------------------------------
// Auxiliares privados
// ---------------------------------------------------------------------------

const HORIZON_RANK: Readonly<Record<BriefHorizon, number>> = {
  atrasada: 0,
  hoy: 1,
  pronto: 2,
  'sin-fecha': 3,
};

const byUrgency = (a: BriefTask, b: BriefTask): number => {
  const horizon = HORIZON_RANK[a.horizonte] - HORIZON_RANK[b.horizonte];
  if (horizon !== 0) return horizon;

  if (a.destacada !== b.destacada) return a.destacada ? -1 : 1;

  const priority = priorityWeight(b.prioridad) - priorityWeight(a.prioridad);
  if (priority !== 0) return priority;

  // Dentro del mismo grupo, lo que vence antes primero. Las que no tienen fecha van
  // al final del grupo, no al principio por comparar contra cero.
  const aDue = a.minutosParaVencer ?? Number.POSITIVE_INFINITY;
  const bDue = b.minutosParaVencer ?? Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;

  return a.titulo.localeCompare(b.titulo, 'es');
};

const horizonOf = (dueMs: number | null, nowMs: number, todayEnd: number): BriefHorizon => {
  if (dueMs === null) return 'sin-fecha';
  if (dueMs < nowMs) return 'atrasada';
  if (dueMs < todayEnd) return 'hoy';
  return 'pronto';
};

const formatMoment = (
  epochMs: number,
  isAllDay: boolean,
  locale: string,
  timeZone: string,
): string =>
  new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
    ...(isAllDay ? {} : { hour: '2-digit', minute: '2-digit' }),
  }).format(new Date(epochMs));

const truncate = (text: string | null, max: number): string | null => {
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
};
