import type { CalendarDate } from '../shared/clock';
import type { ClassAttendanceId, ScheduleBlockId, SubjectId, UserId } from '../shared/branded';
import type { DomainError } from '../shared/domain-error';
import type { IsoDateTime } from '../task/value-objects/iso-date-time';
import type { Result } from '../shared/result';
import { DomainErrors } from '../shared/domain-error';
import { err, ok } from '../shared/result';

/**
 * Si fuiste o no a una clase concreta.
 *
 * UNA FILA POR CLASE MARCADA, no por clase que existe. El calendario de sesiones
 * esperadas se calcula al vuelo desde el tramo y el rango del cuatrimestre -que ya estan
 * guardados- y aqui solo queda lo que el usuario toco. Generar una fila por cada clase
 * del semestre serian cientos de filas viajando por la sincronizacion para no decir nada,
 * y habria que rehacerlas enteras cada vez que se corrige un horario.
 *
 * Eso tiene una consecuencia que define toda la funcion: lo NO marcado no es una falta,
 * es una casilla vacia. Contarlo como falta convertiria la primera semana de uso en un
 * cuatrimestre reprobado.
 */
export interface ClassAttendance {
  readonly id: ClassAttendanceId;
  readonly userId: UserId;
  readonly blockId: ScheduleBlockId;
  /**
   * Repetido aqui aunque se pueda llegar por el tramo.
   *
   * Casi todas las preguntas son por MATERIA -"cuantas faltas llevo en Fisica"- y sin
   * este campo cada una obligaria a cruzar por los tramos. Es la desnormalizacion que
   * paga la consulta que de verdad se hace.
   */
  readonly subjectId: SubjectId;
  /** El dia de esa clase, en hora local. */
  readonly sessionDate: CalendarDate;
  readonly status: AttendanceStatus;
  readonly note: string | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly deletedAt: IsoDateTime | null;
}

/**
 * Cuatro estados, y `cancelled` es el que hace que el numero no mienta.
 *
 * Una clase que el profesor no dio no es una falta tuya, pero tampoco es una clase a la
 * que asististe: tiene que salir del calculo POR LAS DOS PUNTAS. Sin este estado, el
 * unico modo de registrarla seria mentir en una direccion o en la otra.
 *
 * `excused` -justificada- cuenta como clase dada pero no como falta. Es la diferencia
 * entre "no fui" y "no fui y esta justificado", que es justo lo que decide si te
 * reprueban.
 */
export const ATTENDANCE_STATUSES = ['attended', 'absent', 'excused', 'cancelled'] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_LABEL: Readonly<Record<AttendanceStatus, string>> = {
  attended: 'Asisti',
  absent: 'Falte',
  excused: 'Justificada',
  cancelled: 'No hubo clase',
};

export const ATTENDANCE_NOTE_MAX_LENGTH = 200;

export const isAttendanceStatus = (value: unknown): value is AttendanceStatus =>
  typeof value === 'string' && (ATTENDANCE_STATUSES as readonly string[]).includes(value);

export const parseAttendanceStatus = (value: unknown): Result<AttendanceStatus> =>
  isAttendanceStatus(value)
    ? ok(value)
    : err(
        DomainErrors.validation('Estado de asistencia no valido.', {
          field: 'status',
          details: { received: value, allowed: ATTENDANCE_STATUSES },
        }),
      );

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export interface CreateClassAttendanceInput {
  readonly id: ClassAttendanceId;
  readonly userId: UserId;
  readonly blockId: ScheduleBlockId;
  readonly subjectId: SubjectId;
  readonly sessionDate: CalendarDate;
  readonly status: AttendanceStatus;
  readonly now: IsoDateTime;
  readonly note?: string | null;
}

export const createClassAttendance = (
  input: CreateClassAttendanceInput,
): Result<ClassAttendance> => {
  if (!CALENDAR_DATE.test(input.sessionDate)) {
    return err(
      DomainErrors.validation('La fecha debe ir en formato AAAA-MM-DD.', {
        field: 'sessionDate',
        details: { received: input.sessionDate },
      }),
    );
  }

  if (!isAttendanceStatus(input.status)) {
    return err(
      DomainErrors.validation('Estado de asistencia no valido.', {
        field: 'status',
        details: { received: input.status },
      }),
    );
  }

  const note = normalizeNote(input.note);
  const noteError = validateNote(note);
  if (noteError !== null) return err(noteError);

  return ok({
    id: input.id,
    userId: input.userId,
    blockId: input.blockId,
    subjectId: input.subjectId,
    sessionDate: input.sessionDate,
    status: input.status,
    note,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
  } satisfies ClassAttendance);
};

export interface UpdateClassAttendancePatch {
  readonly status?: AttendanceStatus;
  readonly note?: string | null;
}

export const updateClassAttendance = (
  record: ClassAttendance,
  patch: UpdateClassAttendancePatch,
  now: IsoDateTime,
): Result<ClassAttendance> => {
  const rebuilt = createClassAttendance({
    id: record.id,
    userId: record.userId,
    blockId: record.blockId,
    subjectId: record.subjectId,
    sessionDate: record.sessionDate,
    status: patch.status ?? record.status,
    now,
    note: patch.note !== undefined ? patch.note : record.note,
  });

  if (!rebuilt.ok) return rebuilt;

  return ok({
    ...rebuilt.value,
    createdAt: record.createdAt,
    /* Volver a marcar RESUCITA la marca borrada en vez de crear otra. Si no, desmarcar y
       volver a marcar el mismo dia dejaria dos filas para la misma clase, y el recuento
       contaria la falta dos veces. */
    deletedAt: null,
    updatedAt: now,
  });
};

export const softDeleteClassAttendance = (
  record: ClassAttendance,
  now: IsoDateTime,
): ClassAttendance => ({
  ...record,
  deletedAt: now,
  updatedAt: now,
});

/**
 * Clave natural: que clase concreta es.
 *
 * El tramo y el dia bastan y no hace falta el id. Es lo que permite fusionar sin
 * duplicar cuando marcas la misma clase en el telefono y en la computadora estando los
 * dos sin conexion: son dos filas con ids distintos y la misma clave.
 */
export const attendanceKeyFor = (blockId: ScheduleBlockId, sessionDate: CalendarDate): string =>
  `${blockId}|${sessionDate}`;

export const attendanceNaturalKey = (
  record: Pick<ClassAttendance, 'blockId' | 'sessionDate'>,
): string => attendanceKeyFor(record.blockId, record.sessionDate);

/** `true` si esa marca gasta una de las faltas permitidas. */
export const countsAsAbsence = (status: AttendanceStatus): boolean => status === 'absent';

/** `true` si esa clase llego a darse, que es el denominador honesto. */
export const countsAsHeld = (status: AttendanceStatus): boolean => status !== 'cancelled';

// ---------------------------------------------------------------------------
// Auxiliares privados
// ---------------------------------------------------------------------------

const normalizeNote = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.replace(/\s+/gu, ' ').trim();
  return trimmed.length === 0 ? null : trimmed;
};

const validateNote = (note: string | null): DomainError | null => {
  if (note !== null && note.length > ATTENDANCE_NOTE_MAX_LENGTH) {
    return DomainErrors.validation(
      `La nota no puede pasar de ${String(ATTENDANCE_NOTE_MAX_LENGTH)} caracteres.`,
      { field: 'note' },
    );
  }

  return null;
};
