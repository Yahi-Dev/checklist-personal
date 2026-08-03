/**
 * Patron Strategy para el calculo de la siguiente ocurrencia.
 *
 * Cada frecuencia (diaria, semanal, mensual, anual) resuelve el problema de forma
 * distinta, y meterlas todas en un `switch` gigante convierte cualquier ajuste
 * mensual en un riesgo para lo semanal. Aqui cada estrategia es una unidad aislada
 * que se puede probar sola, y añadir "cada dia habil" seria un archivo nuevo sin
 * tocar nada de lo existente.
 */
import type { RecurrenceRule, Weekday } from './recurrence-rule';
import {
  addDaysLocal,
  addMonthsLocal,
  daysInMonth,
  monthsBetween,
  nthWeekdayOfMonth,
  weeksBetween,
  withTimeOf,
} from './date-arithmetic';

export interface RecurrenceStrategy {
  /**
   * Primera ocurrencia ESTRICTAMENTE posterior a `from`.
   *
   * @param anchor Fecha original de la serie. Define la fase: "cada 2 semanas"
   *               necesita saber desde que semana se cuenta.
   * @param from   Desde donde buscar hacia adelante.
   * @returns La siguiente fecha, o `null` si la regla no puede producir ninguna.
   */
  next(rule: RecurrenceRule, anchor: Date, from: Date): Date | null;
}

/** Tope de iteraciones: evita bucles infinitos si una regla nunca puede cumplirse. */
const MAX_SEARCH_STEPS = 400;

const dailyStrategy: RecurrenceStrategy = {
  next(rule, _anchor, from) {
    return addDaysLocal(from, rule.interval);
  },
};

const weeklyStrategy: RecurrenceStrategy = {
  next(rule, anchor, from) {
    // Sin dias marcados se comporta como "cada N semanas el mismo dia del ancla".
    if (rule.weekdays.length === 0) {
      return addDaysLocal(from, rule.interval * 7);
    }

    const allowed = new Set<Weekday>(rule.weekdays);

    for (let step = 1; step <= MAX_SEARCH_STEPS; step += 1) {
      const candidate = addDaysLocal(from, step);
      if (!allowed.has(candidate.getDay() as Weekday)) continue;

      // La semana candidata tiene que caer en fase con el ancla.
      if (weeksBetween(anchor, candidate) % rule.interval !== 0) continue;

      return candidate;
    }

    return null;
  },
};

const monthlyStrategy: RecurrenceStrategy = {
  next(rule, anchor, from) {
    const elapsed = monthsBetween(anchor, from);
    let multiple = Math.floor(elapsed / rule.interval);

    for (let attempt = 0; attempt < MAX_SEARCH_STEPS; attempt += 1) {
      multiple += 1;
      const base = addMonthsLocal(anchor, multiple * rule.interval);
      const candidate = resolveMonthlyCandidate(rule, anchor, base);

      if (candidate !== null && candidate.getTime() > from.getTime()) {
        return candidate;
      }
    }

    return null;
  },
};

const resolveMonthlyCandidate = (rule: RecurrenceRule, anchor: Date, base: Date): Date | null => {
  const year = base.getFullYear();
  const month = base.getMonth();

  if (rule.monthlyMode === 'day-of-week') {
    return nthWeekdayOfMonth(year, month, anchor.getDay(), rule.weekOfMonth, anchor);
  }

  // "El dia 31" en un mes de 30 se recorta al 30, en vez de saltar al mes siguiente.
  const targetDay = rule.dayOfMonth ?? anchor.getDate();
  const day = Math.min(targetDay, daysInMonth(year, month));
  return withTimeOf(new Date(year, month, day), anchor);
};

const yearlyStrategy: RecurrenceStrategy = {
  next(rule, anchor, from) {
    const elapsedYears = from.getFullYear() - anchor.getFullYear();
    let multiple = Math.floor(elapsedYears / rule.interval);

    for (let attempt = 0; attempt < MAX_SEARCH_STEPS; attempt += 1) {
      multiple += 1;
      const candidate = addMonthsLocal(anchor, multiple * rule.interval * 12);
      if (candidate.getTime() > from.getTime()) return candidate;
    }

    return null;
  },
};

const STRATEGIES: Readonly<Record<RecurrenceRule['frequency'], RecurrenceStrategy>> = {
  daily: dailyStrategy,
  weekly: weeklyStrategy,
  monthly: monthlyStrategy,
  yearly: yearlyStrategy,
};

export const strategyFor = (frequency: RecurrenceRule['frequency']): RecurrenceStrategy =>
  STRATEGIES[frequency];
