import type { IsoDateTime } from '../task/value-objects/iso-date-time';
import type { Result } from '../shared/result';
import { DomainErrors } from '../shared/domain-error';
import { err, ok } from '../shared/result';
import { isValidIso } from '../task/value-objects/iso-date-time';

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;

export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** 0 = domingo ... 6 = sabado, igual que `Date.prototype.getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export const WEEKDAY_LABEL: Readonly<Record<Weekday, string>> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miercoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sabado',
};

export const WEEKDAY_SHORT: Readonly<Record<Weekday, string>> = {
  0: 'D',
  1: 'L',
  2: 'M',
  3: 'X',
  4: 'J',
  5: 'V',
  6: 'S',
};

/** Cuando deja de repetirse la serie. */
export type RecurrenceEnd =
  | { readonly kind: 'never' }
  | { readonly kind: 'on'; readonly date: IsoDateTime }
  | { readonly kind: 'after'; readonly occurrences: number };

/** En repeticiones mensuales: por numero de dia, o por "el 3er martes". */
export type MonthlyMode = 'day-of-month' | 'day-of-week';

export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency;
  /** Cada cuantas unidades de `frequency`. Siempre >= 1. */
  readonly interval: number;
  /** Solo para `weekly`: en que dias de la semana cae. Vacio = el mismo dia del ancla. */
  readonly weekdays: readonly Weekday[];
  /** Solo para `monthly` en modo `day-of-month`. `null` = el mismo dia que el ancla. */
  readonly dayOfMonth: number | null;
  /** Solo para `monthly`. */
  readonly monthlyMode: MonthlyMode;
  /** Solo para `monthly` en modo `day-of-week`: 1..4, o -1 para "la ultima". */
  readonly weekOfMonth: number;
  readonly ends: RecurrenceEnd;
  /**
   * `true`  -> "cada 3 dias A PARTIR DE QUE LA COMPLETE" (regar las plantas).
   * `false` -> "cada 3 dias segun el calendario" (pagar la renta), aunque la marques tarde.
   */
  readonly fromCompletion: boolean;
  /** Cuantas veces se ha generado ya. Sirve para el fin de tipo `after`. */
  readonly occurrenceCount: number;
}

export const MAX_INTERVAL = 365;

export const defaultRecurrenceRule = (overrides: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  frequency: 'daily',
  interval: 1,
  weekdays: [],
  dayOfMonth: null,
  monthlyMode: 'day-of-month',
  weekOfMonth: 1,
  ends: { kind: 'never' },
  fromCompletion: false,
  occurrenceCount: 0,
  ...overrides,
});

export const isRecurrenceFrequency = (value: unknown): value is RecurrenceFrequency =>
  typeof value === 'string' && (RECURRENCE_FREQUENCIES as readonly string[]).includes(value);

const isWeekday = (value: unknown): value is Weekday =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;

/**
 * Valida y normaliza una regla de recurrencia venida de fuera (formulario, base de
 * datos o payload sincronizado). Los campos que no aplican a la frecuencia elegida
 * se llevan a su valor neutro, para que dos reglas equivalentes se guarden igual.
 */
export const createRecurrenceRule = (input: Partial<RecurrenceRule>): Result<RecurrenceRule> => {
  const frequency = input.frequency ?? 'daily';
  if (!isRecurrenceFrequency(frequency)) {
    return err(
      DomainErrors.validation('Frecuencia de repeticion no valida.', {
        field: 'recurrence.frequency',
        details: { received: input.frequency },
      }),
    );
  }

  const interval = input.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) {
    return err(
      DomainErrors.validation(`El intervalo debe ser un entero entre 1 y ${MAX_INTERVAL}.`, {
        field: 'recurrence.interval',
        details: { received: input.interval },
      }),
    );
  }

  const rawWeekdays = input.weekdays ?? [];
  if (!rawWeekdays.every(isWeekday)) {
    return err(
      DomainErrors.validation('Hay un dia de la semana no valido.', {
        field: 'recurrence.weekdays',
        details: { received: rawWeekdays },
      }),
    );
  }
  // Deduplicado y ordenado: [3,1,1] y [1,3] deben producir la misma regla.
  const weekdays = frequency === 'weekly' ? [...new Set(rawWeekdays)].sort((a, b) => a - b) : [];

  const dayOfMonth = frequency === 'monthly' ? (input.dayOfMonth ?? null) : null;
  if (dayOfMonth !== null && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) {
    return err(
      DomainErrors.validation('El dia del mes debe estar entre 1 y 31.', {
        field: 'recurrence.dayOfMonth',
        details: { received: input.dayOfMonth },
      }),
    );
  }

  const weekOfMonth = input.weekOfMonth ?? 1;
  if (![-1, 1, 2, 3, 4].includes(weekOfMonth)) {
    return err(
      DomainErrors.validation('La semana del mes debe ser 1, 2, 3, 4 o -1 (la ultima).', {
        field: 'recurrence.weekOfMonth',
        details: { received: input.weekOfMonth },
      }),
    );
  }

  const endsResult = validateEnd(input.ends ?? { kind: 'never' });
  if (!endsResult.ok) return endsResult;

  return ok({
    frequency,
    interval,
    weekdays,
    dayOfMonth,
    monthlyMode: frequency === 'monthly' ? (input.monthlyMode ?? 'day-of-month') : 'day-of-month',
    weekOfMonth: frequency === 'monthly' ? weekOfMonth : 1,
    ends: endsResult.value,
    fromCompletion: input.fromCompletion ?? false,
    occurrenceCount: Math.max(0, input.occurrenceCount ?? 0),
  });
};

const validateEnd = (ends: RecurrenceEnd): Result<RecurrenceEnd> => {
  switch (ends.kind) {
    case 'never':
      return ok({ kind: 'never' });

    case 'on':
      if (typeof ends.date !== 'string' || !isValidIso(ends.date)) {
        return err(
          DomainErrors.validation('La fecha de fin de la repeticion no es valida.', {
            field: 'recurrence.ends.date',
          }),
        );
      }
      return ok({ kind: 'on', date: ends.date });

    case 'after':
      if (!Number.isInteger(ends.occurrences) || ends.occurrences < 1 || ends.occurrences > 1000) {
        return err(
          DomainErrors.validation('El numero de repeticiones debe estar entre 1 y 1000.', {
            field: 'recurrence.ends.occurrences',
          }),
        );
      }
      return ok({ kind: 'after', occurrences: ends.occurrences });

    default:
      return err(
        DomainErrors.validation('Tipo de fin de repeticion no reconocido.', {
          field: 'recurrence.ends',
        }),
      );
  }
};

/** Texto legible de la regla, para mostrar en la tarjeta de la tarea. */
export const describeRecurrence = (rule: RecurrenceRule): string => {
  const base = describeFrequency(rule);
  const suffix = describeEnd(rule.ends);
  const origin = rule.fromCompletion ? ' desde que la completo' : '';
  return `${base}${origin}${suffix}`;
};

const describeFrequency = (rule: RecurrenceRule): string => {
  const { frequency, interval, weekdays, dayOfMonth, monthlyMode, weekOfMonth } = rule;

  switch (frequency) {
    case 'daily':
      return interval === 1 ? 'Cada dia' : `Cada ${interval} dias`;

    case 'weekly': {
      const cadence = interval === 1 ? 'Cada semana' : `Cada ${interval} semanas`;
      if (weekdays.length === 0) return cadence;
      const names = weekdays.map((day) => WEEKDAY_LABEL[day]);
      const list =
        names.length === 1
          ? names[0]
          : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
      return `${cadence} los ${list}`;
    }

    case 'monthly': {
      const cadence = interval === 1 ? 'Cada mes' : `Cada ${interval} meses`;
      if (monthlyMode === 'day-of-week') {
        const ordinal = weekOfMonth === -1 ? 'el ultimo' : `el ${weekOfMonth}.o`;
        return `${cadence}, ${ordinal} dia de la semana correspondiente`;
      }
      return dayOfMonth === null ? cadence : `${cadence}, el dia ${dayOfMonth}`;
    }

    case 'yearly':
      return interval === 1 ? 'Cada año' : `Cada ${interval} años`;

    default:
      return 'Se repite';
  }
};

const describeEnd = (ends: RecurrenceEnd): string => {
  switch (ends.kind) {
    case 'never':
      return '';
    case 'after':
      return `, ${ends.occurrences} ${ends.occurrences === 1 ? 'vez' : 'veces'}`;
    case 'on':
      return `, hasta el ${new Date(ends.date).toLocaleDateString('es-DO')}`;
    default:
      return '';
  }
};

/** Compara reglas por valor, para evitar escrituras cuando nada cambio. */
export const recurrenceEquals = (a: RecurrenceRule | null, b: RecurrenceRule | null): boolean => {
  if (a === null || b === null) return a === b;
  return (
    a.frequency === b.frequency &&
    a.interval === b.interval &&
    a.dayOfMonth === b.dayOfMonth &&
    a.monthlyMode === b.monthlyMode &&
    a.weekOfMonth === b.weekOfMonth &&
    a.fromCompletion === b.fromCompletion &&
    a.weekdays.length === b.weekdays.length &&
    a.weekdays.every((day, index) => day === b.weekdays[index]) &&
    JSON.stringify(a.ends) === JSON.stringify(b.ends)
  );
};
