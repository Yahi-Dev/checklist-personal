import type { CalendarDate } from '../shared/clock';
import type { ClassModality } from './value-objects/class-modality';
import type { DomainError } from '../shared/domain-error';
import type { IsoDateTime } from '../task/value-objects/iso-date-time';
import type { Result } from '../shared/result';
import type { ScheduleBlockId, SubjectId, UserId } from '../shared/branded';
import type { TimeOfDay } from './value-objects/time-of-day';
import type { Weekday } from '../recurrence/recurrence-rule';
import { DomainErrors } from '../shared/domain-error';
import { err, ok } from '../shared/result';
import { isClassModality } from './value-objects/class-modality';
import { isValidTimeOfDay, timeToMinutes } from './value-objects/time-of-day';

/**
 * Un tramo semanal de una asignatura: "los lunes de 20:00 a 22:00 en el aula FR1-411".
 *
 * Es un bloque RECURRENTE, no una clase concreta. Por eso no lleva fecha ni hora
 * absoluta: lleva dia de la semana y hora de reloj, y el rango de fechas del
 * cuatrimestre acota hasta cuando se repite. Modelarlo como ocurrencias sueltas
 * generaria dieciseis filas por asignatura y por cuatrimestre para no decir nada que no
 * diga esta.
 *
 * Es entidad HIJA de la asignatura, no agregado propio... salvo para la
 * sincronizacion, donde si es una fila con vida propia. La razon es practica: cambiar
 * de aula a mitad de cuatrimestre es lo mas frecuente que le pasa a un horario, y si el
 * bloque viajara dentro de la asignatura, dos dispositivos que tocaran bloques
 * distintos de la misma asignatura se pisarian el uno al otro.
 *
 * El aula se guarda como el texto que imprime la universidad (`locationLabel`) y no
 * troceada en columnas. `describeRoom` la trocea al pintarla, y si algun cuatrimestre
 * estrena un formato de aula que no encaja, se enseña tal cual en vez de perderse.
 */
export interface ScheduleBlock {
  readonly id: ScheduleBlockId;
  readonly userId: UserId;
  readonly subjectId: SubjectId;
  /** 0 = domingo ... 6 = sabado, igual que `Date.prototype.getDay()`. */
  readonly weekday: Weekday;
  readonly startsAt: TimeOfDay;
  readonly endsAt: TimeOfDay;
  readonly modality: ClassModality;
  /** El aula tal y como venia en el documento, ej. `FR1-305` o `VIRTUAL [ASINCRONICA 100%]`. */
  readonly locationLabel: string;
  /** `true` cuando la clase no se da en un aula fisica aunque la asignatura sea presencial. */
  readonly isRemote: boolean;
  readonly startsOn: CalendarDate | null;
  readonly endsOn: CalendarDate | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly deletedAt: IsoDateTime | null;
}

export const LOCATION_LABEL_MAX_LENGTH = 120;

/**
 * Tope por asignatura. No hay horario universitario con doce tramos de la misma
 * materia; un numero asi solo sale de un PDF mal leido, y es preferible pararlo aqui a
 * escribir doce filas basura y sincronizarlas.
 */
export const MAX_BLOCKS_PER_SUBJECT = 12;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * `FR2-L06 [LAB. FISICA]` -> edificio, aula y aclaracion.
 *
 * El edificio LLEVA DIGITO (`FR1`, `FR2`) ademas de letras; una clase de solo letras
 * dejaba fuera justo el formato mas comun del campus y devolvia todo a `null`, con lo
 * que la pantalla enseñaba el codigo crudo en vez de "Edif. FR1 - Aula 305".
 */
const ROOM_CODE = /^([A-Z]{2,4}\d{0,2})-([A-Z0-9]{1,6})(?:\s*\[([^\]]+)\])?$/u;

export interface CreateScheduleBlockInput {
  readonly id: ScheduleBlockId;
  readonly userId: UserId;
  readonly subjectId: SubjectId;
  readonly weekday: Weekday;
  readonly startsAt: TimeOfDay;
  readonly endsAt: TimeOfDay;
  readonly now: IsoDateTime;
  readonly modality?: ClassModality;
  readonly locationLabel?: string;
  readonly isRemote?: boolean;
  readonly startsOn?: CalendarDate | null;
  readonly endsOn?: CalendarDate | null;
}

export const createScheduleBlock = (input: CreateScheduleBlockInput): Result<ScheduleBlock> => {
  if (!isWeekday(input.weekday)) {
    return err(
      DomainErrors.validation('El dia de la semana no es valido.', {
        field: 'weekday',
        details: { received: input.weekday },
      }),
    );
  }

  const timeError = validateTimes(input.startsAt, input.endsAt);
  if (timeError !== null) return err(timeError);

  const modality = input.modality ?? 'presencial';
  if (!isClassModality(modality)) {
    return err(
      DomainErrors.validation('Modalidad de clase no valida.', {
        field: 'modality',
        details: { received: modality },
      }),
    );
  }

  const locationLabel = (input.locationLabel ?? '').replace(/\s+/gu, ' ').trim();
  if (locationLabel.length > LOCATION_LABEL_MAX_LENGTH) {
    return err(
      DomainErrors.validation(
        `El aula no puede pasar de ${String(LOCATION_LABEL_MAX_LENGTH)} caracteres.`,
        { field: 'locationLabel' },
      ),
    );
  }

  const rangeError = validateRange(input.startsOn ?? null, input.endsOn ?? null);
  if (rangeError !== null) return err(rangeError);

  return ok({
    id: input.id,
    userId: input.userId,
    subjectId: input.subjectId,
    weekday: input.weekday,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    modality,
    locationLabel,
    isRemote: input.isRemote ?? isRemoteLabel(locationLabel),
    startsOn: input.startsOn ?? null,
    endsOn: input.endsOn ?? null,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
  } satisfies ScheduleBlock);
};

export interface UpdateScheduleBlockPatch {
  readonly weekday?: Weekday;
  readonly startsAt?: TimeOfDay;
  readonly endsAt?: TimeOfDay;
  readonly modality?: ClassModality;
  readonly locationLabel?: string;
  readonly isRemote?: boolean;
  readonly startsOn?: CalendarDate | null;
  readonly endsOn?: CalendarDate | null;
}

export const updateScheduleBlock = (
  block: ScheduleBlock,
  patch: UpdateScheduleBlockPatch,
  now: IsoDateTime,
): Result<ScheduleBlock> => {
  const rebuilt = createScheduleBlock({
    id: block.id,
    userId: block.userId,
    subjectId: block.subjectId,
    weekday: patch.weekday ?? block.weekday,
    startsAt: patch.startsAt ?? block.startsAt,
    endsAt: patch.endsAt ?? block.endsAt,
    now,
    modality: patch.modality ?? block.modality,
    locationLabel: patch.locationLabel ?? block.locationLabel,
    /* `isRemote` se recalcula desde la etiqueta cuando cambia el aula y no se pasa a
       mano: si no, mover una clase de "VIRTUAL" a "FR1-305" la dejaria marcada como
       remota para siempre. */
    ...(patch.isRemote === undefined && patch.locationLabel !== undefined
      ? {}
      : { isRemote: patch.isRemote ?? block.isRemote }),
    startsOn: patch.startsOn !== undefined ? patch.startsOn : block.startsOn,
    endsOn: patch.endsOn !== undefined ? patch.endsOn : block.endsOn,
  });

  if (!rebuilt.ok) return rebuilt;

  return ok({
    ...rebuilt.value,
    createdAt: block.createdAt,
    deletedAt: block.deletedAt,
    updatedAt: now,
  });
};

export const softDeleteScheduleBlock = (block: ScheduleBlock, now: IsoDateTime): ScheduleBlock => ({
  ...block,
  deletedAt: now,
  updatedAt: now,
});

/**
 * Clave natural de un bloque dentro de su asignatura.
 *
 * Dia y hora de comienzo bastan: una asignatura no puede tener dos tramos que empiecen
 * a la misma hora del mismo dia -eso es justo lo que impide `findOverlap`-. El aula
 * queda fuera a proposito, para que cambiar de aula entre importaciones se lea como una
 * ACTUALIZACION del mismo bloque y no como borrar uno y crear otro.
 */
export const scheduleBlockKeyFor = (
  subjectId: SubjectId,
  weekday: Weekday,
  startsAt: TimeOfDay,
): string => `${subjectId}|${String(weekday)}|${startsAt}`;

export const scheduleBlockNaturalKey = (
  block: Pick<ScheduleBlock, 'subjectId' | 'weekday' | 'startsAt'>,
): string => scheduleBlockKeyFor(block.subjectId, block.weekday, block.startsAt);

export const blockDurationMinutes = (block: ScheduleBlock): number =>
  timeToMinutes(block.endsAt) - timeToMinutes(block.startsAt);

export const byBlockStart = (a: ScheduleBlock, b: ScheduleBlock): number =>
  a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id);

/** Dos tramos del mismo dia que se pisan. Tocarse en el extremo no es pisarse. */
export const blocksOverlap = (a: ScheduleBlock, b: ScheduleBlock): boolean =>
  a.weekday === b.weekday &&
  timeToMinutes(a.startsAt) < timeToMinutes(b.endsAt) &&
  timeToMinutes(b.startsAt) < timeToMinutes(a.endsAt);

/**
 * El primer tramo ya guardado con el que chocaria `candidate`, o `null`.
 *
 * Se ignoran los borrados y el propio bloque -por id- para que editar la hora de un
 * tramo no lo haga chocar consigo mismo, que es el fallo clasico de esta comprobacion.
 */
export const findOverlap = (
  blocks: readonly ScheduleBlock[],
  candidate: ScheduleBlock,
): ScheduleBlock | null =>
  blocks.find(
    (block) =>
      block.id !== candidate.id && block.deletedAt === null && blocksOverlap(block, candidate),
  ) ?? null;

export interface RoomDescription {
  /** Edificio, ej. `FR1`. `null` si el aula no sigue el formato de la universidad. */
  readonly building: string | null;
  /** Numero o codigo de aula, ej. `305` o `L06`. */
  readonly room: string | null;
  /** Aclaracion entre corchetes, ej. `LAB. FISICA`. */
  readonly note: string | null;
}

/**
 * Trocea `FR2-L06 [LAB. FISICA]` en edificio, aula y aclaracion.
 *
 * Devuelve todo a `null` cuando no encaja en vez de adivinar: un cuatrimestre con un
 * formato de aula nuevo tiene que enseñar el texto crudo, no un troceado inventado.
 */
export const describeRoom = (locationLabel: string): RoomDescription => {
  const match = ROOM_CODE.exec(locationLabel.trim());

  if (match === null) return { building: null, room: null, note: null };

  return {
    building: match[1] ?? null,
    room: match[2] ?? null,
    note: match[3]?.trim() ?? null,
  };
};

export const isRemoteLabel = (locationLabel: string): boolean =>
  /^virtual\b/iu.test(locationLabel.trim());

export const isWeekday = (value: unknown): value is Weekday =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;

export const parseWeekday = (value: unknown): Result<Weekday> =>
  isWeekday(value)
    ? ok(value)
    : err(
        DomainErrors.validation('El dia de la semana no es valido.', {
          field: 'weekday',
          details: { received: value, allowed: '0-6' },
        }),
      );

// ---------------------------------------------------------------------------
// Auxiliares privados
// ---------------------------------------------------------------------------

const validateTimes = (startsAt: unknown, endsAt: unknown): DomainError | null => {
  for (const [field, value] of [
    ['startsAt', startsAt],
    ['endsAt', endsAt],
  ] as const) {
    if (typeof value !== 'string' || !isValidTimeOfDay(value)) {
      return DomainErrors.validation('La hora debe ir en formato HH:mm, ej. 20:00.', {
        field,
        details: { received: value },
      });
    }
  }

  if (typeof startsAt === 'string' && typeof endsAt === 'string') {
    if (timeToMinutes(endsAt) <= timeToMinutes(startsAt)) {
      return DomainErrors.validation('La clase no puede terminar antes de empezar.', {
        field: 'endsAt',
        details: { startsAt, endsAt },
      });
    }
  }

  return null;
};

const validateRange = (
  startsOn: CalendarDate | null,
  endsOn: CalendarDate | null,
): DomainError | null => {
  for (const [field, value] of [
    ['startsOn', startsOn],
    ['endsOn', endsOn],
  ] as const) {
    if (value !== null && !CALENDAR_DATE.test(value)) {
      return DomainErrors.validation('La fecha debe ir en formato AAAA-MM-DD.', {
        field,
        details: { received: value },
      });
    }
  }

  if (startsOn !== null && endsOn !== null && endsOn < startsOn) {
    return DomainErrors.validation('El tramo no puede terminar antes de empezar.', {
      field: 'endsOn',
    });
  }

  return null;
};
