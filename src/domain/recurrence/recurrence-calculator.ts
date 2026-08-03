import type { IsoDateTime } from '../task/value-objects/iso-date-time';
import type { RecurrenceRule } from './recurrence-rule';
import { fromIso, toIso } from '../task/value-objects/iso-date-time';
import { strategyFor } from './strategies';

/**
 * Calcula ocurrencias de una serie recurrente.
 *
 * Es una fachada delgada sobre las estrategias, y su unico trabajo extra es hacer
 * cumplir las condiciones de fin (`ends`), que son transversales a las cuatro
 * frecuencias y no tendrian por que repetirse en cada estrategia.
 */

export interface OccurrenceContext {
  /** Fecha original de la serie: fija la fase de la repeticion. */
  readonly anchor: IsoDateTime;
  /** Desde donde buscar. Al completar con `fromCompletion` es el momento de completar. */
  readonly from: IsoDateTime;
}

/** La siguiente ocurrencia, o `null` si la serie ya termino. */
export const nextOccurrence = (
  rule: RecurrenceRule,
  context: OccurrenceContext,
): IsoDateTime | null => {
  if (hasReachedOccurrenceLimit(rule)) return null;

  const candidate = strategyFor(rule.frequency).next(
    rule,
    fromIso(context.anchor),
    fromIso(context.from),
  );
  if (candidate === null) return null;

  const candidateIso = toIso(candidate);
  if (isPastEndDate(rule, candidateIso)) return null;

  return candidateIso;
};

/**
 * Las proximas `limit` ocurrencias, para pintar la vista de calendario sin tener que
 * materializar en la base de datos tareas que quiza nunca se completen.
 */
export const upcomingOccurrences = (
  rule: RecurrenceRule,
  context: OccurrenceContext,
  options: { limit?: number; until?: IsoDateTime } = {},
): IsoDateTime[] => {
  const limit = Math.min(options.limit ?? 10, 500);
  const occurrences: IsoDateTime[] = [];

  let cursor = context.from;
  let counter = rule.occurrenceCount;

  while (occurrences.length < limit) {
    const ruleWithCount: RecurrenceRule = { ...rule, occurrenceCount: counter };
    const next = nextOccurrence(ruleWithCount, { anchor: context.anchor, from: cursor });

    if (next === null) break;
    if (options.until !== undefined && Date.parse(next) > Date.parse(options.until)) break;

    occurrences.push(next);
    cursor = next;
    counter += 1;
  }

  return occurrences;
};

const hasReachedOccurrenceLimit = (rule: RecurrenceRule): boolean =>
  rule.ends.kind === 'after' && rule.occurrenceCount >= rule.ends.occurrences;

const isPastEndDate = (rule: RecurrenceRule, candidate: IsoDateTime): boolean =>
  rule.ends.kind === 'on' && Date.parse(candidate) > Date.parse(rule.ends.date);

/** Suma uno al contador de ocurrencias tras generar una nueva instancia. */
export const advanceOccurrenceCount = (rule: RecurrenceRule): RecurrenceRule => ({
  ...rule,
  occurrenceCount: rule.occurrenceCount + 1,
});

/** `true` si la serie ya no puede producir mas ocurrencias. */
export const isSeriesFinished = (rule: RecurrenceRule, context: OccurrenceContext): boolean =>
  nextOccurrence(rule, context) === null;
