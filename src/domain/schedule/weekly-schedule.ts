import type { CalendarDate } from '../shared/clock';
import type { ScheduleBlock } from './schedule-block';
import type { Subject } from './subject';
import type { Weekday } from '../recurrence/recurrence-rule';
import { compareTermCodesDesc, isTermActive } from './subject';
import { timeToMinutes } from './value-objects/time-of-day';

/**
 * De dos listas planas -asignaturas y tramos- a la semana que se pinta en pantalla.
 *
 * Esta es la unica pieza que sabe COMO se lee un horario, y por eso vive en el dominio
 * y no en el componente: los huecos entre clases, que dia toca primero y cual es la
 * clase en curso son decisiones con reglas, y las reglas hay que poder probarlas sin
 * montar React.
 *
 * La semana empieza en LUNES aunque `Weekday` use el 0 para el domingo. El 0 viene de
 * `Date.prototype.getDay()` y no se toca porque es la fuente de la que sale el dia de
 * hoy; el orden de lectura es otra cosa, y en un horario universitario el domingo va al
 * final o directamente no esta.
 */
export const WEEK_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export interface ScheduledClass {
  readonly block: ScheduleBlock;
  readonly subject: Subject;
  readonly startMinutes: number;
  readonly endMinutes: number;
  /** Minutos libres hasta el siguiente tramo del mismo dia. `null` si es el ultimo. */
  readonly gapAfterMinutes: number | null;
}

export interface ScheduleDay {
  readonly weekday: Weekday;
  readonly classes: readonly ScheduledClass[];
  /** Minutos de clase del dia. No incluye los huecos. */
  readonly totalMinutes: number;
}

export interface WeeklyScheduleOptions {
  /** Cuatrimestre a mostrar. Sin el se muestran todos los que haya. */
  readonly termCode?: string;
}

/**
 * Devuelve SOLO los dias que tienen clase, en orden de lectura.
 *
 * Devolver siempre los siete obligaria a cada pantalla a filtrar los vacios, y bastaria
 * que una se olvidara para enseñar cinco tarjetas de "sin clases" a alguien que estudia
 * dos dias por semana.
 */
export const buildWeeklySchedule = (
  subjects: readonly Subject[],
  blocks: readonly ScheduleBlock[],
  options: WeeklyScheduleOptions = {},
): readonly ScheduleDay[] => {
  const bySubjectId = new Map<string, Subject>();
  for (const subject of subjects) {
    if (subject.deletedAt !== null) continue;
    if (options.termCode !== undefined && subject.termCode !== options.termCode) continue;
    bySubjectId.set(subject.id, subject);
  }

  const grouped = new Map<Weekday, { block: ScheduleBlock; subject: Subject }[]>();

  for (const block of blocks) {
    if (block.deletedAt !== null) continue;

    /* Un tramo cuya asignatura ya no esta -borrada, o de otro cuatrimestre- se
       descarta en silencio. Es lo que ocurre entre el borrado logico de la asignatura
       y el de sus tramos, que no es atomico entre dispositivos. */
    const subject = bySubjectId.get(block.subjectId);
    if (subject === undefined) continue;

    const day = grouped.get(block.weekday) ?? [];
    day.push({ block, subject });
    grouped.set(block.weekday, day);
  }

  const days: ScheduleDay[] = [];

  for (const weekday of WEEK_ORDER) {
    const entries = grouped.get(weekday);
    if (entries === undefined || entries.length === 0) continue;

    const sorted = [...entries].sort(
      (a, b) =>
        a.block.startsAt.localeCompare(b.block.startsAt) ||
        a.block.endsAt.localeCompare(b.block.endsAt) ||
        a.subject.code.localeCompare(b.subject.code, 'es'),
    );

    const classes = sorted.map((entry, index): ScheduledClass => {
      const startMinutes = timeToMinutes(entry.block.startsAt);
      const endMinutes = timeToMinutes(entry.block.endsAt);
      const next = sorted[index + 1];
      const gap = next === undefined ? null : timeToMinutes(next.block.startsAt) - endMinutes;

      return {
        block: entry.block,
        subject: entry.subject,
        startMinutes,
        endMinutes,
        // Un hueco de cero o negativo no es tiempo libre: son clases pegadas o solapadas.
        gapAfterMinutes: gap !== null && gap > 0 ? gap : null,
      };
    });

    days.push({
      weekday,
      classes,
      totalMinutes: classes.reduce(
        (total, item) => total + (item.endMinutes - item.startMinutes),
        0,
      ),
    });
  }

  return days;
};

/** La clase que esta ocurriendo a esa hora del dia, si la hay. */
export const currentClassAt = (day: ScheduleDay, minutes: number): ScheduledClass | null =>
  day.classes.find((item) => minutes >= item.startMinutes && minutes < item.endMinutes) ?? null;

/** La primera clase que aun no ha empezado a esa hora del dia. */
export const nextClassAt = (day: ScheduleDay, minutes: number): ScheduledClass | null =>
  day.classes.find((item) => item.startMinutes > minutes) ?? null;

/** Cuatrimestres presentes, del mas nuevo al mas viejo. */
export const termCodesOf = (subjects: readonly Subject[]): readonly string[] => {
  const codes = new Set<string>();
  for (const subject of subjects) {
    if (subject.deletedAt === null) codes.add(subject.termCode);
  }

  return [...codes].sort(compareTermCodesDesc);
};

/**
 * El cuatrimestre que toca enseñar al abrir la pantalla.
 *
 * Se prefiere el que contiene el dia de hoy; si ninguno lo contiene -entre
 * cuatrimestres, que es justo cuando el usuario va a importar el siguiente- se cae al
 * mas nuevo en vez de dejar la pantalla vacia sin explicacion.
 */
export const activeTermCode = (
  subjects: readonly Subject[],
  today: CalendarDate,
): string | null => {
  const live = subjects.filter((subject) => subject.deletedAt === null);

  const current = live.find((subject) => isTermActive(subject, today));
  if (current !== undefined) return current.termCode;

  return termCodesOf(live)[0] ?? null;
};
