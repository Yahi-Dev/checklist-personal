import type { ScheduleBlock } from '../../domain/schedule/schedule-block';
import type { ScheduleDay } from '../../domain/schedule/weekly-schedule';
import type { TimeOfDay } from '../../domain/schedule/value-objects/time-of-day';
import type { UpcomingClass } from '../../domain/schedule/next-class';
import type { Weekday } from '../../domain/recurrence/recurrence-rule';
import { describeRoom } from '../../domain/schedule/schedule-block';
import { timeToMinutes } from '../../domain/schedule/value-objects/time-of-day';
import { WEEKDAY_LABEL } from '../../domain/recurrence/recurrence-rule';

/**
 * Como se lee un horario en pantalla.
 *
 * Son funciones puras y sin React a proposito: son las decisiones que de verdad pueden
 * estar mal -que "20:00" se lea "8:00 pm" y no "20:00 pm", que cuatro horas muertas se
 * anuncien como "4h libre" y no como "240min"- y asi se prueban sin montar un DOM.
 */

/**
 * `20:00` -> `8:00 pm`.
 *
 * Doce horas y no veinticuatro porque es como habla la universidad en el propio
 * documento y como lo dice cualquiera aqui. Sin cero a la izquierda en la hora, que en
 * una columna estrecha roba sitio sin aportar nada; los minutos si lo llevan, porque
 * "8:5 pm" no se lee.
 */
export const formatClassTime = (time: TimeOfDay): string => {
  const minutes = timeToMinutes(time);
  const hour = Math.floor(minutes / 60);
  const meridiem = hour < 12 ? 'am' : 'pm';
  // El 0 y el 12 son ambos "12": medianoche y mediodia.
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;

  return `${String(displayHour)}:${String(minutes % 60).padStart(2, '0')} ${meridiem}`;
};

/**
 * Minutos muertos entre dos clases, dichos como los diria una persona.
 *
 * Por debajo de media hora no se anuncia: un hueco de diez minutos es el tiempo de
 * cambiar de aula, no tiempo libre, y anunciarlo llena la pantalla de ruido entre
 * clases seguidas.
 */
export const MIN_GAP_MINUTES = 30;

export const formatGap = (minutes: number): string | null => {
  if (minutes < MIN_GAP_MINUTES) return null;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${String(rest)}min libre`;
  if (rest === 0) return `${String(hours)}h libre`;

  return `${String(hours)}h ${String(rest)}min libre`;
};

export interface LocationParts {
  readonly isRemote: boolean;
  /** Ej. `Edif. FR1`. `null` si el aula no sigue el formato de la universidad. */
  readonly building: string | null;
  /** Ej. `Aula 305`. */
  readonly room: string | null;
  /** Ej. `LAB. FISICA`. */
  readonly note: string | null;
  /** Lo que se enseña cuando no se pudo trocear: el texto crudo. */
  readonly fallback: string | null;
}

/**
 * Trocea el aula para pintarla con iconos.
 *
 * Cuando el troceo falla se devuelve el texto tal cual en `fallback` en vez de no
 * enseñar nada: si algun cuatrimestre estrena un formato de aula, es preferible un
 * "FR3/B-12" crudo a una linea vacia donde el usuario esperaba saber a donde ir.
 */
export const describeLocation = (block: ScheduleBlock): LocationParts => {
  if (block.isRemote) {
    return { isRemote: true, building: null, room: null, note: null, fallback: null };
  }

  const label = block.locationLabel.trim();
  if (label.length === 0) {
    return { isRemote: false, building: null, room: null, note: null, fallback: null };
  }

  const parsed = describeRoom(label);

  if (parsed.building === null || parsed.room === null) {
    return { isRemote: false, building: null, room: null, note: null, fallback: label };
  }

  return {
    isRemote: false,
    building: `Edif. ${parsed.building}`,
    room: `Aula ${parsed.room}`,
    note: parsed.note,
    fallback: null,
  };
};

export const formatClassCount = (count: number): string =>
  `${String(count)} ${count === 1 ? 'clase' : 'clases'}`;

export const weekdayLabel = (weekday: Weekday): string => WEEKDAY_LABEL[weekday];

/** Minutos transcurridos del dia local. La hora entra por parametro, nunca de `Date.now()`. */
export const minutesOfDay = (now: Date): number => now.getHours() * 60 + now.getMinutes();

export type ClassProgress = 'past' | 'now' | 'upcoming';

/**
 * En que punto esta una clase respecto a "ahora".
 *
 * Solo tiene sentido en el dia de hoy: el lunes que viene todas sus clases son
 * `upcoming`, y pintar de gris las de por la mañana porque ya pasaron HOY seria mentir.
 */
export const classProgressAt = (
  block: Pick<ScheduleBlock, 'startsAt' | 'endsAt'>,
  minutes: number,
): ClassProgress => {
  if (minutes >= timeToMinutes(block.endsAt)) return 'past';
  if (minutes >= timeToMinutes(block.startsAt)) return 'now';
  return 'upcoming';
};

/** Total de clases de la semana. Alimenta el subtitulo de la cabecera. */
export const countClasses = (days: readonly ScheduleDay[]): number =>
  days.reduce((total, day) => total + day.classes.length, 0);

/**
 * Una cuenta atras corta: `40 min`, `1 h 10 min`, `3 h`.
 *
 * Sin decimales y sin segundos. Nadie sale antes porque falten 47 minutos en vez de 45, y
 * un numero que cambia cada segundo en una tira que se mira de reojo es ruido.
 */
export const formatCountdown = (minutes: number): string => {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;

  if (hours === 0) return `${String(rest)} min`;
  if (rest === 0) return `${String(hours)} h`;

  return `${String(hours)} h ${String(rest)} min`;
};

/**
 * Cuando es la proxima clase, dicho como lo diria una persona.
 *
 * La clase EN CURSO se anuncia por lo que queda, no por lo que lleva: sentado en el aula,
 * lo unico que quieres saber es cuanto falta para salir.
 *
 * A partir de cierta distancia la cuenta atras deja de servir -"en 19 h 40 min" no le
 * dice nada a nadie- y se pasa a nombrar el dia y la hora.
 */
export const describeUpcoming = (upcoming: UpcomingClass): string => {
  if (upcoming.isNow) return `Ahora · termina en ${formatCountdown(upcoming.minutesUntilEnd)}`;

  if (upcoming.daysAhead === 0) return `En ${formatCountdown(upcoming.minutesUntilStart)}`;

  const at = formatClassTime(upcoming.item.block.startsAt);

  if (upcoming.daysAhead === 1) return `Mañana a las ${at}`;

  return `El ${weekdayLabel(upcoming.weekday).toLocaleLowerCase('es')} a las ${at}`;
};
