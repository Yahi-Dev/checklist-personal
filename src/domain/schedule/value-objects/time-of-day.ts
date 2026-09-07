import type { Result } from '../../shared/result';
import { DomainErrors } from '../../shared/domain-error';
import { err, ok } from '../../shared/result';

/**
 * Hora de reloj de pared, sin fecha ni zona: `HH:mm` en 24 horas.
 *
 * Una clase de los lunes a las 8 de la noche NO es un instante absoluto: es la misma
 * hora todas las semanas del cuatrimestre, y sigue siendo esa aunque el pais mueva el
 * reloj o el usuario cruce un huso. Guardarla como `IsoDateTime` obligaria a inventar
 * una fecha para cada bloque y a recalcularla en cada ocurrencia; guardarla como
 * minutos desde medianoche la haria ilegible al depurar y al exportarla.
 *
 * `HH:mm` con cero a la izquierda ordena lexicograficamente igual que cronologicamente,
 * que es justo lo que necesita el indice de Dexie y el `order by` de Postgres.
 */
export type TimeOfDay = string;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;

export const MINUTES_PER_DAY = 1440;

export const isValidTimeOfDay = (value: string): boolean => TIME_PATTERN.test(value);

export const parseTimeOfDay = (value: unknown, field = 'startsAt'): Result<TimeOfDay> => {
  if (typeof value !== 'string' || !isValidTimeOfDay(value)) {
    return err(
      DomainErrors.validation('La hora debe ir en formato HH:mm, ej. 20:00.', {
        field,
        details: { received: value },
      }),
    );
  }

  return ok(value);
};

/** Minutos desde medianoche. Es la forma comoda de comparar, restar y ordenar. */
export const timeToMinutes = (value: TimeOfDay): number => {
  const match = TIME_PATTERN.exec(value);
  if (match === null) return 0;

  return Number.parseInt(match[1] ?? '0', 10) * 60 + Number.parseInt(match[2] ?? '0', 10);
};

export const minutesToTime = (minutes: number): TimeOfDay => {
  // Se envuelve el dia entero para que un calculo que se pase de las 24:00 no produzca
  // una hora imposible: es preferible un `00:30` del dia siguiente a un `24:30`.
  const clamped = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
};

/** Duracion en minutos de un tramo. Negativa nunca: el dominio ya valida inicio < fin. */
export const durationInMinutes = (startsAt: TimeOfDay, endsAt: TimeOfDay): number =>
  timeToMinutes(endsAt) - timeToMinutes(startsAt);

export const compareTimeOfDay = (a: TimeOfDay, b: TimeOfDay): number => a.localeCompare(b);
