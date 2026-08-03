import { appConfig } from '../config/app-config';

/**
 * Formateo de fechas para la interfaz, en español.
 *
 * Los `Intl.DateTimeFormat` se crean una sola vez y se reutilizan: construir uno es
 * caro (carga datos de localizacion) y en una lista de tareas se llamaria una vez por
 * fila en cada render.
 */

const LOCALE = appConfig.ui.locale;

const timeFormatter = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });

const dayMonthFormatter = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });

const fullDateFormatter = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const monthYearFormatter = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });

const weekdayShortFormatter = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });

const MS_PER_DAY = 86_400_000;

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Dias de calendario entre dos fechas: hoy vs mañana es 1 aunque falten 2 horas. */
export const calendarDaysBetween = (from: Date, to: Date): number =>
  Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);

export const formatTime = (iso: string): string => timeFormatter.format(new Date(iso));

export const formatFullDate = (iso: string): string => fullDateFormatter.format(new Date(iso));

export const formatMonthYear = (date: Date): string => monthYearFormatter.format(date);

export const formatWeekdayShort = (date: Date): string =>
  weekdayShortFormatter.format(date).replace('.', '');

/**
 * Etiqueta relativa: "Hoy 18:30", "Mañana", "Vencio hace 2 dias".
 *
 * Es la que se ve en cada tarjeta de tarea. Un "2026-08-05T18:30:00Z" obliga a hacer
 * cuentas mentales; "Mañana 18:30" se entiende sin pensar, que es de lo que se trata
 * en una lista que se mira de reojo veinte veces al dia.
 */
export const formatDueDate = (
  iso: string,
  options: { isAllDay?: boolean; now?: Date } = {},
): string => {
  const now = options.now ?? new Date();
  const due = new Date(iso);
  const days = calendarDaysBetween(now, due);
  const time = options.isAllDay === true ? '' : ` ${timeFormatter.format(due)}`;

  if (days === 0) return `Hoy${time}`;
  if (days === 1) return `Mañana${time}`;
  if (days === -1) return `Ayer${time}`;

  if (days < 0) {
    const overdue = Math.abs(days);
    return overdue < 30
      ? `Hace ${overdue} dias`
      : `${dayMonthFormatter.format(due)}${due.getFullYear() === now.getFullYear() ? '' : ` ${due.getFullYear()}`}`;
  }

  // Dentro de la semana se dice el dia: "Jueves 09:00" ubica mejor que "en 3 dias".
  if (days < 7) {
    const weekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' }).format(due);
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}${time}`;
  }

  const suffix = due.getFullYear() === now.getFullYear() ? '' : ` ${due.getFullYear()}`;
  return `${dayMonthFormatter.format(due)}${suffix}${time}`;
};

/** "hace 3 minutos", "hace 2 horas". Se usa en el indicador de sincronizacion. */
export const formatRelativeToNow = (iso: string, now: Date = new Date()): string => {
  const deltaSeconds = Math.round((now.getTime() - Date.parse(iso)) / 1000);

  if (deltaSeconds < 10) return 'hace un momento';
  if (deltaSeconds < 60) return `hace ${deltaSeconds} s`;
  if (deltaSeconds < 3600) return `hace ${Math.floor(deltaSeconds / 60)} min`;
  if (deltaSeconds < 86_400) return `hace ${Math.floor(deltaSeconds / 3600)} h`;

  return `hace ${Math.floor(deltaSeconds / 86_400)} d`;
};

/** `YYYY-MM-DD` local: la clave con la que se agrupan las tareas por dia. */
export const toDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

/** Valor para un `<input type="datetime-local">`, que espera hora LOCAL sin zona. */
export const toDateTimeLocalValue = (iso: string | null): string => {
  if (iso === null) return '';
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
};

/** Camino inverso: lo que escribe el input a un instante absoluto en ISO. */
export const fromDateTimeLocalValue = (value: string): string | null => {
  if (value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const isToday = (iso: string, now: Date = new Date()): boolean =>
  calendarDaysBetween(now, new Date(iso)) === 0;

export const isOverdueDate = (iso: string, now: Date = new Date()): boolean =>
  Date.parse(iso) < now.getTime();

/** Los 7 dias de la semana que contiene `date`, empezando en lunes. */
export const weekDaysOf = (date: Date): Date[] => {
  const start = startOfDay(date);
  const offsetToMonday = (start.getDay() + 6) % 7;
  const monday = new Date(start.getTime() - offsetToMonday * MS_PER_DAY);

  return Array.from({ length: 7 }, (_, index) => new Date(monday.getTime() + index * MS_PER_DAY));
};

/**
 * Rejilla completa del mes: siempre 6 semanas (42 celdas).
 * Fijar el numero de filas evita que el calendario cambie de alto al pasar de mes,
 * que es un salto visual muy molesto al navegar rapido.
 */
export const monthGridOf = (date: Date): Date[] => {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const offsetToMonday = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(firstOfMonth.getTime() - offsetToMonday * MS_PER_DAY);

  return Array.from({ length: 42 }, (_, index) => new Date(start.getTime() + index * MS_PER_DAY));
};
