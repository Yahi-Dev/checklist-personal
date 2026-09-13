import type { ScheduleDay, ScheduledClass } from './weekly-schedule';
import type { Weekday } from '../recurrence/recurrence-rule';
import { MINUTES_PER_DAY } from './value-objects/time-of-day';

/**
 * Que clase toca ahora o cual es la siguiente.
 *
 * Parece trivial y tiene tres casos que se cruzan: puede que estes DENTRO de una clase,
 * puede que la siguiente sea hoy mas tarde, y puede que ya no quede ninguna hoy y haya
 * que saltar al proximo dia con clases -que no es "mañana", porque el fin de semana
 * existe y porque hay dias sin ninguna-.
 *
 * Vive en el dominio y no en el componente por eso: son reglas con casos, y los casos hay
 * que poder probarlos sin montar React ni esperar a que sea jueves.
 */

export interface UpcomingClass {
  readonly item: ScheduledClass;
  readonly weekday: Weekday;
  /** Cuantos dias adelante cae: 0 hoy, 1 mañana, 6 como mucho. */
  readonly daysAhead: number;
  /** Minutos que faltan para que empiece. Negativo si ya empezo. */
  readonly minutesUntilStart: number;
  /** Minutos que faltan para que termine. */
  readonly minutesUntilEnd: number;
  /** `true` si esta ocurriendo ahora mismo. */
  readonly isNow: boolean;
}

/**
 * La clase en curso o la siguiente, mirando como mucho una semana adelante.
 *
 * Una clase EN CURSO gana siempre a la siguiente. Enseñar "Calculo en 3 horas" mientras
 * estas sentado en Logica seria tecnicamente cierto y completamente inutil.
 */
export const findUpcomingClass = (
  days: readonly ScheduleDay[],
  weekday: Weekday,
  minutes: number,
): UpcomingClass | null => {
  const byWeekday = new Map(days.map((day) => [day.weekday, day]));

  for (let daysAhead = 0; daysAhead <= 6; daysAhead += 1) {
    const target = ((weekday + daysAhead) % 7) as Weekday;
    const day = byWeekday.get(target);
    if (day === undefined) continue;

    /* Hoy solo cuentan las que aun no han terminado; en los dias siguientes, todas. El
       corte es por el FINAL y no por el comienzo, que es lo que hace que una clase en la
       que estas ahora mismo siga siendo "la proxima". */
    const candidate =
      daysAhead === 0 ? day.classes.find((item) => item.endMinutes > minutes) : day.classes[0];

    if (candidate === undefined) continue;

    const offset = daysAhead * MINUTES_PER_DAY;

    return {
      item: candidate,
      weekday: target,
      daysAhead,
      minutesUntilStart: offset + candidate.startMinutes - minutes,
      minutesUntilEnd: offset + candidate.endMinutes - minutes,
      isNow: daysAhead === 0 && candidate.startMinutes <= minutes,
    };
  }

  return null;
};
