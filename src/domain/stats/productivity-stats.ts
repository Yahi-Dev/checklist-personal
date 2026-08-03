import type { CategoryId } from '../shared/branded';
import type { FocusSession } from '../focus/focus-session';
import type { Task } from '../task/task';
import { startOfLocalDay, toCalendarDate } from '../shared/clock';

/**
 * Calculo de estadisticas: funciones puras sobre listas de tareas y sesiones.
 *
 * Nada de esto vive en SQL a proposito. El conjunto de datos de un usuario personal
 * cabe de sobra en memoria, y tenerlo aqui significa que las mismas cifras salen
 * identicas estando sin conexion. Si algun dia el volumen lo pidiera, estas funciones
 * son la especificacion ejecutable contra la que validar la version en SQL.
 */

export interface DailyCount {
  /** `YYYY-MM-DD` local. */
  readonly date: string;
  readonly completed: number;
  readonly created: number;
}

export interface WeekdayProductivity {
  /** 0 = domingo ... 6 = sabado. */
  readonly weekday: number;
  readonly completed: number;
  /** Media de tareas completadas los dias de la semana observados. */
  readonly average: number;
}

export interface StreakInfo {
  /** Dias consecutivos hasta hoy con al menos una tarea completada. */
  readonly current: number;
  readonly longest: number;
  /** El ultimo dia con actividad, `YYYY-MM-DD`. */
  readonly lastActiveDate: string | null;
}

export interface CategoryBreakdown {
  readonly categoryId: CategoryId | null;
  readonly completed: number;
  readonly pending: number;
  readonly overdue: number;
}

export interface ProductivitySnapshot {
  readonly totalTasks: number;
  readonly completedTotal: number;
  readonly pendingTotal: number;
  readonly overdueTotal: number;
  readonly completedToday: number;
  readonly completedThisWeek: number;
  readonly completionRate: number;
  readonly streak: StreakInfo;
  readonly dailyCounts: readonly DailyCount[];
  readonly weekdayProductivity: readonly WeekdayProductivity[];
  readonly categoryBreakdown: readonly CategoryBreakdown[];
  readonly focusMinutesThisWeek: number;
  readonly focusSessionsThisWeek: number;
  /** Las tareas mas pospuestas: donde se atasca de verdad la semana. */
  readonly mostPostponed: readonly { taskId: string; title: string; snoozeCount: number }[];
}

const dayKey = (iso: string): string => toCalendarDate(new Date(iso));

/** Serie diaria de creadas y completadas para los ultimos `days` dias, hoy incluido. */
export const buildDailyCounts = (
  tasks: readonly Task[],
  reference: Date,
  days = 30,
): DailyCount[] => {
  const completedByDay = new Map<string, number>();
  const createdByDay = new Map<string, number>();

  for (const task of tasks) {
    if (task.completedAt !== null) {
      const key = dayKey(task.completedAt);
      completedByDay.set(key, (completedByDay.get(key) ?? 0) + 1);
    }
    const createdKey = dayKey(task.createdAt);
    createdByDay.set(createdKey, (createdByDay.get(createdKey) ?? 0) + 1);
  }

  const series: DailyCount[] = [];
  const start = startOfLocalDay(reference);

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(start);
    date.setDate(date.getDate() - offset);
    const key = toCalendarDate(date);

    series.push({
      date: key,
      completed: completedByDay.get(key) ?? 0,
      created: createdByDay.get(key) ?? 0,
    });
  }

  return series;
};

/**
 * En que dias de la semana se rinde mas.
 * Se devuelve la media y no el total, porque en una ventana de 30 dias unos dias de
 * la semana aparecen 5 veces y otros 4, y el total premiaria a los primeros sin motivo.
 */
export const buildWeekdayProductivity = (
  dailyCounts: readonly DailyCount[],
): WeekdayProductivity[] => {
  const totals = new Array<number>(7).fill(0);
  const observations = new Array<number>(7).fill(0);

  for (const day of dailyCounts) {
    const weekday = new Date(`${day.date}T12:00:00`).getDay();
    totals[weekday] = (totals[weekday] ?? 0) + day.completed;
    observations[weekday] = (observations[weekday] ?? 0) + 1;
  }

  return totals.map((completed, weekday) => {
    const seen = observations[weekday] ?? 0;
    return {
      weekday,
      completed,
      average: seen === 0 ? 0 : Number((completed / seen).toFixed(2)),
    };
  });
};

/**
 * Racha de dias consecutivos con al menos una tarea completada.
 *
 * Si hoy todavia no se ha completado nada, la racha NO se rompe: se cuenta desde
 * ayer. Romperla a las 00:01 seria castigar por no haber empezado el dia.
 */
export const calculateStreak = (tasks: readonly Task[], reference: Date): StreakInfo => {
  const activeDays = new Set<string>();

  for (const task of tasks) {
    if (task.completedAt !== null) activeDays.add(dayKey(task.completedAt));
  }

  if (activeDays.size === 0) {
    return { current: 0, longest: 0, lastActiveDate: null };
  }

  const sorted = [...activeDays].sort();
  const lastActiveDate = sorted[sorted.length - 1] ?? null;

  const today = toCalendarDate(startOfLocalDay(reference));
  const yesterday = toCalendarDate(new Date(startOfLocalDay(reference).getTime() - 86_400_000));

  let current = 0;
  if (activeDays.has(today) || activeDays.has(yesterday)) {
    const cursor = new Date(startOfLocalDay(reference));
    if (!activeDays.has(today)) cursor.setDate(cursor.getDate() - 1);

    while (activeDays.has(toCalendarDate(cursor))) {
      current += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  let longest = 0;
  let run = 0;
  let previous: Date | null = null;

  for (const day of sorted) {
    const date = new Date(`${day}T12:00:00`);

    if (previous !== null) {
      const gapDays = Math.round((date.getTime() - previous.getTime()) / 86_400_000);
      run = gapDays === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }

    longest = Math.max(longest, run);
    previous = date;
  }

  return { current, longest, lastActiveDate };
};

export const buildCategoryBreakdown = (tasks: readonly Task[], now: Date): CategoryBreakdown[] => {
  const buckets = new Map<
    CategoryId | null,
    { completed: number; pending: number; overdue: number }
  >();
  const nowMs = now.getTime();

  for (const task of tasks) {
    if (task.deletedAt !== null) continue;

    const key = task.categoryId;
    const bucket = buckets.get(key) ?? { completed: 0, pending: 0, overdue: 0 };

    if (task.status === 'completed') {
      bucket.completed += 1;
    } else if (task.status === 'pending') {
      bucket.pending += 1;
      if (task.dueAt !== null && Date.parse(task.dueAt) < nowMs) bucket.overdue += 1;
    }

    buckets.set(key, bucket);
  }

  return [...buckets.entries()].map(([categoryId, counts]) => ({ categoryId, ...counts }));
};

/** Foto completa de productividad para la pantalla de estadisticas. */
export const buildProductivitySnapshot = (
  tasks: readonly Task[],
  focusSessions: readonly FocusSession[],
  reference: Date,
  windowDays = 30,
): ProductivitySnapshot => {
  const alive = tasks.filter((task) => task.deletedAt === null);
  const nowMs = reference.getTime();

  const completedTotal = alive.filter((task) => task.status === 'completed').length;
  const pendingTotal = alive.filter((task) => task.status === 'pending').length;
  const overdueTotal = alive.filter(
    (task) => task.status === 'pending' && task.dueAt !== null && Date.parse(task.dueAt) < nowMs,
  ).length;

  const dailyCounts = buildDailyCounts(alive, reference, windowDays);
  const todayKey = toCalendarDate(startOfLocalDay(reference));
  const completedToday = dailyCounts.find((day) => day.date === todayKey)?.completed ?? 0;

  const weekStart = startOfLocalDay(reference).getTime() - 6 * 86_400_000;
  const completedThisWeek = alive.filter(
    (task) => task.completedAt !== null && Date.parse(task.completedAt) >= weekStart,
  ).length;

  const weeklyFocus = focusSessions.filter(
    (session) =>
      session.mode === 'focus' &&
      session.wasCompleted &&
      Date.parse(session.startedAt) >= weekStart,
  );

  const mostPostponed = alive
    .filter((task) => task.snoozeCount > 0 && task.status === 'pending')
    .sort((a, b) => b.snoozeCount - a.snoozeCount)
    .slice(0, 5)
    .map((task) => ({ taskId: task.id, title: task.title, snoozeCount: task.snoozeCount }));

  const denominator = completedTotal + pendingTotal;

  return {
    totalTasks: alive.length,
    completedTotal,
    pendingTotal,
    overdueTotal,
    completedToday,
    completedThisWeek,
    completionRate: denominator === 0 ? 0 : Number((completedTotal / denominator).toFixed(3)),
    streak: calculateStreak(alive, reference),
    dailyCounts,
    weekdayProductivity: buildWeekdayProductivity(dailyCounts),
    categoryBreakdown: buildCategoryBreakdown(alive, reference),
    focusMinutesThisWeek: Math.round(
      weeklyFocus.reduce((total, session) => total + session.elapsedSeconds, 0) / 60,
    ),
    focusSessionsThisWeek: weeklyFocus.length,
    mostPostponed,
  };
};
