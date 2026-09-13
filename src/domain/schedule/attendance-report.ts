import type { AttendanceStatus, ClassAttendance } from './class-attendance';
import type { CalendarDate } from '../shared/clock';
import type { ScheduleBlock } from './schedule-block';
import type { Subject } from './subject';
import { addDaysLocal } from '../recurrence/date-arithmetic';
import { attendanceNaturalKey, countsAsAbsence, countsAsHeld } from './class-attendance';
import { fromCalendarDate, toCalendarDate } from '../shared/clock';

/**
 * Cuantas faltas llevas y cuantas te quedan.
 *
 * Aqui esta la decision que hace util toda la funcion: el dato que se enseña NO es "85%
 * de asistencia". Un porcentaje obliga a hacer una division mental para responder a la
 * unica pregunta que de verdad importa, que es "¿puedo faltar el jueves?". Lo que se
 * calcula, y lo que se pinta, es FALTAS RESTANTES.
 *
 * Las tres reglas que hacen que el numero no mienta:
 *
 *   1. Una clase cancelada sale del calculo por las dos puntas: ni asististe ni faltaste.
 *   2. Una falta justificada cuenta como clase dada, pero no gasta cupo.
 *   3. Lo NO marcado es una casilla vacia, no una falta. Contarlo como falta convertiria
 *      la primera semana de uso en un cuatrimestre reprobado.
 */

/** Tope antibucle. Un cuatrimestre real no pasa de ~20 sesiones por tramo. */
const MAX_SESSIONS_PER_BLOCK = 60;

export interface ExpectedSession {
  readonly blockId: ScheduleBlock['id'];
  readonly date: CalendarDate;
}

/**
 * Los dias en que ESA clase tocaba, entre el comienzo del cuatrimestre y la fecha dada.
 *
 * Se calcula, no se guarda. El tramo ya sabe su dia de la semana y su rango de fechas, asi
 * que la lista es una consecuencia de dos datos que ya existen; persistirla seria
 * duplicar informacion que ademas caduca en cuanto se corrige un horario.
 */
export const expectedSessions = (
  block: ScheduleBlock,
  subject: Subject,
  until: CalendarDate,
): readonly ExpectedSession[] => sessionsBetween(block, subject, null, until);

/**
 * Las sesiones de un tramo dentro de una ventana, recortada por el cuatrimestre.
 *
 * `from` a `null` significa "desde que empieza el cuatrimestre", que es lo que quiere el
 * recuento de faltas. Los avisos, en cambio, piden una ventana corta hacia adelante: sin
 * este parametro habria que generar el semestre entero para quedarse con tres dias.
 */
export const sessionsBetween = (
  block: ScheduleBlock,
  subject: Subject,
  from: CalendarDate | null,
  until: CalendarDate,
): readonly ExpectedSession[] => {
  const termStart = block.startsOn ?? subject.startsOn;
  const endsOn = block.endsOn ?? subject.endsOn;

  // Sin fechas no hay calendario posible. Se devuelve vacio en vez de inventarlo: mejor
  // no decir nada que dar un recuento sobre un rango imaginado.
  if (termStart === null) return [];

  const startsOn = from === null || from < termStart ? termStart : from;
  const last = endsOn === null || until < endsOn ? until : endsOn;
  if (last < startsOn) return [];

  const sessions: ExpectedSession[] = [];
  let cursor = fromCalendarDate(startsOn);

  /* Se adelanta hasta el primer dia de la semana que toca en vez de recorrer dia a dia
     todo el cuatrimestre: son a lo sumo seis pasos frente a un centenar. */
  const offset = (block.weekday - cursor.getDay() + 7) % 7;
  cursor = addDaysLocal(cursor, offset);

  while (sessions.length < MAX_SESSIONS_PER_BLOCK) {
    const date = toCalendarDate(cursor);
    if (date > last) break;

    sessions.push({ blockId: block.id, date });
    cursor = addDaysLocal(cursor, 7);
  }

  return sessions;
};

export interface AttendanceTally {
  /** Clases que llegaron a darse y estan marcadas. Es el denominador honesto. */
  readonly held: number;
  readonly attended: number;
  /** Faltas que gastan cupo. Las justificadas NO entran aqui. */
  readonly absent: number;
  readonly excused: number;
  readonly cancelled: number;
  /** Clases que ya pasaron y siguen sin marcar. Nunca cuentan como falta. */
  readonly unmarked: number;
  /** Cuantas faltas quedan antes del limite. `null` si la materia no tiene limite. */
  readonly remainingAbsences: number | null;
  /** `true` cuando ya se paso del limite. */
  readonly overLimit: boolean;
}

export const EMPTY_TALLY: AttendanceTally = {
  held: 0,
  attended: 0,
  absent: 0,
  excused: 0,
  cancelled: 0,
  unmarked: 0,
  remainingAbsences: null,
  overLimit: false,
};

/**
 * El recuento de una materia hasta la fecha dada.
 *
 * `records` son SOLO las marcas guardadas; las sesiones esperadas salen de los tramos.
 * De ese cruce sale lo unico que no se puede deducir de ninguno de los dos por separado:
 * cuantas clases ya pasaron y siguen sin marcar.
 */
export const buildAttendanceTally = (
  subject: Subject,
  blocks: readonly ScheduleBlock[],
  records: readonly ClassAttendance[],
  today: CalendarDate,
): AttendanceTally => {
  const own = blocks.filter((block) => block.subjectId === subject.id && block.deletedAt === null);

  const marks = new Map<string, AttendanceStatus>();
  for (const record of records) {
    if (record.deletedAt !== null) continue;
    if (record.subjectId !== subject.id) continue;
    marks.set(attendanceNaturalKey(record), record.status);
  }

  let held = 0;
  let attended = 0;
  let absent = 0;
  let excused = 0;
  let cancelled = 0;
  let unmarked = 0;

  for (const block of own) {
    for (const session of expectedSessions(block, subject, today)) {
      const status = marks.get(`${block.id}|${session.date}`);

      if (status === undefined) {
        unmarked += 1;
        continue;
      }

      if (countsAsHeld(status)) held += 1;
      if (status === 'attended') attended += 1;
      if (status === 'excused') excused += 1;
      if (status === 'cancelled') cancelled += 1;
      if (countsAsAbsence(status)) absent += 1;
    }
  }

  const limit = subject.maxAbsences;

  return {
    held,
    attended,
    absent,
    excused,
    cancelled,
    unmarked,
    remainingAbsences: limit === null ? null : Math.max(0, limit - absent),
    overLimit: limit !== null && absent > limit,
  };
};

/**
 * Que porcentaje de las clases dadas asististe.
 *
 * Existe para enseñarlo como dato secundario, nunca como el principal. `null` cuando no
 * hay ninguna clase marcada todavia: un 0% recien empezado el cuatrimestre es una mentira
 * con pinta de dato.
 */
export const attendanceRate = (tally: AttendanceTally): number | null =>
  tally.held === 0 ? null : tally.attended / tally.held;

export interface PendingSession extends ExpectedSession {
  readonly subjectId: Subject['id'];
}

/**
 * Las clases que ya pasaron y siguen sin marcar, de la mas reciente a la mas antigua.
 *
 * Alimenta la vista de rellenar hacia atras. El orden importa: lo de ayer se recuerda y
 * lo de hace tres semanas ya no, asi que lo util va arriba.
 */
export const pendingSessions = (
  subject: Subject,
  blocks: readonly ScheduleBlock[],
  records: readonly ClassAttendance[],
  today: CalendarDate,
  limit = 30,
): readonly PendingSession[] => {
  const marked = new Set(
    records
      .filter((record) => record.deletedAt === null)
      .map((record) => attendanceNaturalKey(record)),
  );

  const pending: PendingSession[] = [];

  for (const block of blocks) {
    if (block.subjectId !== subject.id || block.deletedAt !== null) continue;

    for (const session of expectedSessions(block, subject, today)) {
      if (marked.has(`${block.id}|${session.date}`)) continue;
      pending.push({ ...session, subjectId: subject.id });
    }
  }

  return pending.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
};
