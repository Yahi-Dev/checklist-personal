import { endOfLocalDay, startOfLocalDay } from '../../domain/shared/clock';

/**
 * Los rangos de fecha del historial.
 *
 * Se separa de la pantalla porque es lo unico de esta funcionalidad con aritmetica que se
 * puede equivocar, y se equivoca en silencio: un rango mal calculado no rompe nada, solo
 * enseña una lista incompleta que parece correcta. Aislado y puro, se prueba con fechas
 * concretas en vez de comprobarse a ojo.
 *
 * Todos los rangos van de medianoche local a las 23:59:59.999 locales. Esa precision
 * importa en los extremos: con un `to` a medianoche, TODO lo terminado el ultimo dia del
 * rango quedaria fuera, y el fallo solo se notaria al filtrar "hoy" por la tarde.
 */

export type RangePreset = 'hoy' | 'ayer' | 'semana' | 'mes' | 'todo' | 'personalizado';

export interface DateRange {
  /** `null` en "todo": sin limite por abajo. */
  readonly from: Date | null;
  readonly to: Date | null;
}

export const RANGE_PRESETS: readonly { id: RangePreset; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: '7 dias' },
  { id: 'mes', label: '30 dias' },
  { id: 'todo', label: 'Todo' },
  { id: 'personalizado', label: 'Elegir' },
];

/**
 * Traduce un preset a un rango concreto.
 *
 * "7 dias" incluye HOY y los seis anteriores, no los siete anteriores a hoy. Es la lectura
 * que espera cualquiera que acaba de terminar algo y quiere verlo ahi.
 */
export const resolveRange = (
  preset: RangePreset,
  custom: { from: string; to: string },
  now: Date = new Date(),
): DateRange => {
  switch (preset) {
    case 'hoy':
      return { from: startOfLocalDay(now), to: endOfLocalDay(now) };

    case 'ayer': {
      const yesterday = addDays(now, -1);
      return { from: startOfLocalDay(yesterday), to: endOfLocalDay(yesterday) };
    }

    case 'semana':
      return { from: startOfLocalDay(addDays(now, -6)), to: endOfLocalDay(now) };

    case 'mes':
      return { from: startOfLocalDay(addDays(now, -29)), to: endOfLocalDay(now) };

    case 'todo':
      return { from: null, to: null };

    case 'personalizado':
      return {
        from: parseDayInput(custom.from, startOfLocalDay),
        to: parseDayInput(custom.to, endOfLocalDay),
      };
  }
};

/** Describe el rango en una linea, para que el encabezado diga que se esta mirando. */
export const describeRange = (preset: RangePreset, range: DateRange): string => {
  if (preset !== 'personalizado') {
    return RANGE_PRESETS.find((option) => option.id === preset)?.label ?? '';
  }

  const from = range.from === null ? null : formatShort(range.from);
  const to = range.to === null ? null : formatShort(range.to);

  if (from !== null && to !== null) return from === to ? from : `${from} — ${to}`;
  if (from !== null) return `Desde ${from}`;
  if (to !== null) return `Hasta ${to}`;
  return 'Todo';
};

/**
 * Lee un `<input type="date">`, que llega como `AAAA-MM-DD`.
 *
 * Se parte a mano en vez de pasarlo a `new Date(value)`: esa cadena la interpreta el
 * navegador como UTC, asi que en cualquier huso al oeste el rango arrancaria el dia
 * anterior. Construyendo con los tres numeros, el dia es el que el usuario eligio.
 */
const parseDayInput = (value: string, edge: (date: Date) => Date): Date | null => {
  const parts = value.split('-').map(Number);
  const [year, month, day] = parts;

  if (parts.length !== 3 || year === undefined || month === undefined || day === undefined) {
    return null;
  }
  if (parts.some(Number.isNaN)) return null;

  return edge(new Date(year, month - 1, day));
};

const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const shortFormatter = new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short' });
const formatShort = (date: Date): string => shortFormatter.format(date);
