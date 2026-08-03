import type { Result } from '../../shared/result';
import { DomainErrors } from '../../shared/domain-error';
import { err, ok } from '../../shared/result';

/**
 * Instante absoluto serializado como ISO-8601 en UTC, ej. `2026-08-02T18:30:00.000Z`.
 *
 * Todos los instantes del dominio se guardan asi, nunca como objetos `Date`. Un Date
 * es mutable, no sobrevive a `structuredClone` en algunos puentes de IPC, y compara
 * mal con `===`. Un string ISO en UTC viaja intacto entre IndexedDB, Postgres
 * (`timestamptz`), el puente de Electron y JSON, y ordena lexicograficamente igual
 * que cronologicamente.
 */
export type IsoDateTime = string;

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export const toIso = (date: Date): IsoDateTime => date.toISOString();

export const fromIso = (value: IsoDateTime): Date => new Date(value);

export const isValidIso = (value: string): boolean =>
  ISO_PATTERN.test(value) && !Number.isNaN(Date.parse(value));

export const parseIsoDateTime = (value: unknown, field = 'date'): Result<IsoDateTime> => {
  if (typeof value !== 'string' || !isValidIso(value)) {
    return err(
      DomainErrors.validation('La fecha no tiene un formato valido.', {
        field,
        details: { received: value },
      }),
    );
  }
  // Se re-serializa para dejar todo en la misma forma canonica (UTC, con milisegundos).
  return ok(toIso(new Date(value)));
};

/** Igual que parseIsoDateTime pero deja pasar null/undefined como null. */
export const parseOptionalIsoDateTime = (
  value: unknown,
  field = 'date',
): Result<IsoDateTime | null> => {
  if (value === null || value === undefined || value === '') return ok(null);
  return parseIsoDateTime(value, field);
};

export const isBefore = (a: IsoDateTime, b: IsoDateTime): boolean => Date.parse(a) < Date.parse(b);

export const isAfter = (a: IsoDateTime, b: IsoDateTime): boolean => Date.parse(a) > Date.parse(b);

export const addMinutes = (value: IsoDateTime, minutes: number): IsoDateTime =>
  toIso(new Date(Date.parse(value) + minutes * 60_000));

export const addDays = (value: IsoDateTime, days: number): IsoDateTime =>
  toIso(new Date(Date.parse(value) + days * 86_400_000));

/** Diferencia en minutos: positiva si `a` es posterior a `b`. */
export const differenceInMinutes = (a: IsoDateTime, b: IsoDateTime): number =>
  (Date.parse(a) - Date.parse(b)) / 60_000;
