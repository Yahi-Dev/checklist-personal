/**
 * Aritmetica de calendario en hora LOCAL.
 *
 * La recurrencia es un concepto de calendario, no de instante. "Cada mes el dia 5 a
 * las 9:00" tiene que caer a las 9:00 locales aunque en el medio cambie el horario de
 * verano, asi que se opera sobre los componentes locales del Date y no sobre epoch.
 *
 * Cada funcion conserva la hora, los minutos, los segundos y los milisegundos de la
 * fecha original salvo que se indique lo contrario.
 */

export const MILLISECONDS_PER_DAY = 86_400_000;

const timeParts = (date: Date): [number, number, number, number] => [
  date.getHours(),
  date.getMinutes(),
  date.getSeconds(),
  date.getMilliseconds(),
];

export const addDaysLocal = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

/**
 * Suma meses respetando el fin de mes: 31 de enero + 1 mes = 28/29 de febrero, no
 * el 2 o 3 de marzo, que es lo que haria `setMonth` por si solo.
 */
export const addMonthsLocal = (date: Date, months: number): Date => {
  const [hours, minutes, seconds, ms] = timeParts(date);
  const totalMonths = date.getMonth() + months;
  const year = date.getFullYear() + Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12;
  const day = Math.min(date.getDate(), daysInMonth(year, month));
  return new Date(year, month, day, hours, minutes, seconds, ms);
};

/** Suma años recortando el 29 de febrero a 28 en los años no bisiestos. */
export const addYearsLocal = (date: Date, years: number): Date => addMonthsLocal(date, years * 12);

export const daysInMonth = (year: number, month: number): number =>
  new Date(year, month + 1, 0).getDate();

export const startOfDayLocal = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

/** Inicio de la semana, con el domingo como primer dia (igual que `getDay() === 0`). */
export const startOfWeekLocal = (date: Date): Date =>
  addDaysLocal(startOfDayLocal(date), -date.getDay());

/** Semanas completas entre dos fechas, contando desde el inicio de cada semana. */
export const weeksBetween = (from: Date, to: Date): number =>
  Math.round(
    (startOfWeekLocal(to).getTime() - startOfWeekLocal(from).getTime()) /
      (7 * MILLISECONDS_PER_DAY),
  );

/** Meses de calendario entre dos fechas, ignorando el dia. */
export const monthsBetween = (from: Date, to: Date): number =>
  (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());

/**
 * La n-esima aparicion de un dia de la semana dentro de un mes.
 * `nth` va de 1 a 4, o -1 para "la ultima del mes".
 * Devuelve `null` si esa aparicion no existe (ej. el 5.o lunes de un mes que no lo tiene).
 */
export const nthWeekdayOfMonth = (
  year: number,
  month: number,
  weekday: number,
  nth: number,
  time: Date,
): Date | null => {
  const [hours, minutes, seconds, ms] = timeParts(time);

  if (nth === -1) {
    const last = new Date(year, month, daysInMonth(year, month));
    const delta = (last.getDay() - weekday + 7) % 7;
    return new Date(year, month, last.getDate() - delta, hours, minutes, seconds, ms);
  }

  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  if (day > daysInMonth(year, month)) return null;

  return new Date(year, month, day, hours, minutes, seconds, ms);
};

/** Copia la hora de `time` sobre la fecha de calendario de `date`. */
export const withTimeOf = (date: Date, time: Date): Date => {
  const [hours, minutes, seconds, ms] = timeParts(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, seconds, ms);
};

export const isSameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
