import { describe, expect, it } from 'vitest';

import type { ClassAttendance } from '../../src/domain/schedule/class-attendance';
import type { ScheduleBlock } from '../../src/domain/schedule/schedule-block';
import type { Subject } from '../../src/domain/schedule/subject';
import type {
  ClassAttendanceId,
  ScheduleBlockId,
  SubjectId,
  UserId,
} from '../../src/domain/shared/branded';

import {
  attendanceNaturalKey,
  createClassAttendance,
  softDeleteClassAttendance,
  updateClassAttendance,
} from '../../src/domain/schedule/class-attendance';
import {
  attendanceRate,
  buildAttendanceTally,
  expectedSessions,
  pendingSessions,
} from '../../src/domain/schedule/attendance-report';
import { brandId } from '../../src/domain/shared/branded';
import { createScheduleBlock } from '../../src/domain/schedule/schedule-block';
import { createSubject } from '../../src/domain/schedule/subject';
import { unwrap } from '../../src/domain/shared/result';

/**
 * El control de faltas.
 *
 * Las tres reglas que hacen que el numero no mienta, y que son lo que de verdad se prueba
 * aqui: una clase cancelada sale del calculo por las dos puntas, una justificada cuenta
 * como clase dada pero no gasta cupo, y lo NO marcado es una casilla vacia y nunca una
 * falta. Sin la tercera, la primera semana de uso pareceria un cuatrimestre reprobado.
 *
 * El cuatrimestre de referencia es el real: del lunes 7 de septiembre de 2026 al sabado
 * 19 de diciembre.
 */

const USER_ID = brandId<UserId>('00000000-0000-4000-8000-000000000001');
const NOW = '2026-09-13T12:00:00.000Z';

let counter = 0;
const nextSubjectId = () =>
  brandId<SubjectId>(`00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`);
const nextBlockId = () =>
  brandId<ScheduleBlockId>(`00000000-0000-4000-9000-${String(++counter).padStart(12, '0')}`);
const nextRecordId = () =>
  brandId<ClassAttendanceId>(`00000000-0000-4000-a000-${String(++counter).padStart(12, '0')}`);

const makeSubject = (overrides: Partial<Parameters<typeof createSubject>[0]> = {}): Subject =>
  unwrap(
    createSubject({
      id: nextSubjectId(),
      userId: USER_ID,
      code: 'TI3210',
      name: 'Logica Matematica',
      termCode: '2027-1',
      now: NOW,
      startsOn: '2026-09-07',
      endsOn: '2026-12-19',
      ...overrides,
    }),
  );

const makeBlock = (
  subject: Subject,
  overrides: Partial<Parameters<typeof createScheduleBlock>[0]> = {},
): ScheduleBlock =>
  unwrap(
    createScheduleBlock({
      id: nextBlockId(),
      userId: USER_ID,
      subjectId: subject.id,
      weekday: 1,
      startsAt: '20:00',
      endsAt: '22:00',
      now: NOW,
      startsOn: '2026-09-07',
      endsOn: '2026-12-19',
      ...overrides,
    }),
  );

const mark = (
  block: ScheduleBlock,
  sessionDate: string,
  status: 'attended' | 'absent' | 'excused' | 'cancelled',
): ClassAttendance =>
  unwrap(
    createClassAttendance({
      id: nextRecordId(),
      userId: USER_ID,
      blockId: block.id,
      subjectId: block.subjectId,
      sessionDate,
      status,
      now: NOW,
    }),
  );

describe('las clases que tocaban', () => {
  it('son los lunes desde que empieza el cuatrimestre', () => {
    const subject = makeSubject();
    const block = makeBlock(subject, { weekday: 1 });

    const sessions = expectedSessions(block, subject, '2026-09-28');

    expect(sessions.map((session) => session.date)).toEqual([
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
    ]);
  });

  it('empiezan en el primer dia que toca, no el dia que abre el cuatrimestre', () => {
    // El cuatrimestre abre un lunes y la clase es el miercoles: la primera sesion es el 9.
    const subject = makeSubject();
    const block = makeBlock(subject, { weekday: 3 });

    expect(expectedSessions(block, subject, '2026-09-20')[0]?.date).toBe('2026-09-09');
  });

  it('no pasan del final del cuatrimestre aunque se pregunte mas alla', () => {
    const subject = makeSubject();
    const block = makeBlock(subject, { weekday: 1, endsOn: '2026-09-21' });

    const sessions = expectedSessions(block, subject, '2026-12-31');

    expect(sessions.map((session) => session.date)).toEqual([
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
    ]);
  });

  it('estan vacias antes de que empiece', () => {
    const subject = makeSubject();

    expect(expectedSessions(makeBlock(subject), subject, '2026-08-30')).toEqual([]);
  });

  it('estan vacias si no hay fechas, en vez de inventarse el rango', () => {
    // Mejor no decir nada que dar un recuento sobre un cuatrimestre imaginado.
    const subject = makeSubject({ startsOn: null, endsOn: null });
    const block = makeBlock(subject, { startsOn: null, endsOn: null });

    expect(expectedSessions(block, subject, '2026-10-01')).toEqual([]);
  });

  it('el tramo manda sobre la asignatura cuando trae sus propias fechas', () => {
    const subject = makeSubject({ startsOn: '2026-09-07' });
    const block = makeBlock(subject, { weekday: 1, startsOn: '2026-09-21' });

    expect(expectedSessions(block, subject, '2026-09-28')[0]?.date).toBe('2026-09-21');
  });
});

describe('el recuento', () => {
  const subject = makeSubject({ maxAbsences: 3 });
  const block = makeBlock(subject, { weekday: 1 });
  // Hasta el 28 de septiembre tocaban cuatro lunes: 7, 14, 21 y 28.
  const today = '2026-09-28';

  it('no cuenta como falta lo que no esta marcado', () => {
    // Es la regla que evita que la primera semana de uso parezca un cuatrimestre perdido.
    const tally = buildAttendanceTally(subject, [block], [], today);

    expect(tally.unmarked).toBe(4);
    expect(tally.absent).toBe(0);
    expect(tally.held).toBe(0);
    expect(tally.remainingAbsences).toBe(3);
  });

  it('descuenta las faltas del limite', () => {
    const tally = buildAttendanceTally(
      subject,
      [block],
      [mark(block, '2026-09-07', 'attended'), mark(block, '2026-09-14', 'absent')],
      today,
    );

    expect(tally.attended).toBe(1);
    expect(tally.absent).toBe(1);
    expect(tally.held).toBe(2);
    expect(tally.unmarked).toBe(2);
    expect(tally.remainingAbsences).toBe(2);
    expect(tally.overLimit).toBe(false);
  });

  it('una justificada cuenta como clase dada pero NO gasta cupo', () => {
    // Es la diferencia entre "no fui" y "no fui y esta justificado", que es justo lo que
    // decide si te reprueban.
    const tally = buildAttendanceTally(
      subject,
      [block],
      [mark(block, '2026-09-07', 'excused')],
      today,
    );

    expect(tally.excused).toBe(1);
    expect(tally.held).toBe(1);
    expect(tally.absent).toBe(0);
    expect(tally.remainingAbsences).toBe(3);
  });

  it('una clase cancelada sale del calculo por las DOS puntas', () => {
    // Ni asististe ni faltaste: sin este estado, el unico modo de registrarla seria
    // mentir en una direccion o en la otra.
    const tally = buildAttendanceTally(
      subject,
      [block],
      [mark(block, '2026-09-07', 'cancelled')],
      today,
    );

    expect(tally.cancelled).toBe(1);
    expect(tally.held).toBe(0);
    expect(tally.absent).toBe(0);
    expect(tally.attended).toBe(0);
  });

  it('avisa cuando se paso del limite y nunca baja de cero', () => {
    const tally = buildAttendanceTally(
      subject,
      [block],
      [
        mark(block, '2026-09-07', 'absent'),
        mark(block, '2026-09-14', 'absent'),
        mark(block, '2026-09-21', 'absent'),
        mark(block, '2026-09-28', 'absent'),
      ],
      today,
    );

    expect(tally.absent).toBe(4);
    expect(tally.overLimit).toBe(true);
    expect(tally.remainingAbsences).toBe(0);
  });

  it('sin limite no inventa un numero', () => {
    const sinLimite = makeSubject({ maxAbsences: null });
    const suyo = makeBlock(sinLimite, { weekday: 1 });

    const tally = buildAttendanceTally(
      sinLimite,
      [suyo],
      [mark(suyo, '2026-09-07', 'absent')],
      today,
    );

    expect(tally.remainingAbsences).toBeNull();
    expect(tally.overLimit).toBe(false);
  });

  it('ignora las marcas borradas y las de otra materia', () => {
    const otra = makeSubject({ code: 'EGC252' });
    const suyo = makeBlock(otra, { weekday: 1 });

    const tally = buildAttendanceTally(
      subject,
      [block],
      [
        softDeleteClassAttendance(mark(block, '2026-09-07', 'absent'), NOW),
        mark(suyo, '2026-09-14', 'absent'),
      ],
      today,
    );

    expect(tally.absent).toBe(0);
    expect(tally.unmarked).toBe(4);
  });

  it('el porcentaje es dato secundario y no existe si no hay nada marcado', () => {
    // Un 0% recien empezado el cuatrimestre es una mentira con pinta de dato.
    expect(attendanceRate(buildAttendanceTally(subject, [block], [], today))).toBeNull();

    const conDatos = buildAttendanceTally(
      subject,
      [block],
      [mark(block, '2026-09-07', 'attended'), mark(block, '2026-09-14', 'absent')],
      today,
    );

    expect(attendanceRate(conDatos)).toBe(0.5);
  });

  it('suma los dos tramos de la misma materia', () => {
    const lunes = makeBlock(subject, { weekday: 1 });
    const miercoles = makeBlock(subject, { weekday: 3 });

    // Hasta el 14 de septiembre: lunes 7 y 14, miercoles 9. Tres sesiones.
    const tally = buildAttendanceTally(subject, [lunes, miercoles], [], '2026-09-14');

    expect(tally.unmarked).toBe(3);
  });
});

describe('rellenar hacia atras', () => {
  const subject = makeSubject();
  const block = makeBlock(subject, { weekday: 1 });

  it('devuelve lo que quedo sin marcar, lo mas reciente primero', () => {
    // Lo de ayer se recuerda y lo de hace tres semanas ya no, asi que lo util va arriba.
    const pending = pendingSessions(
      subject,
      [block],
      [mark(block, '2026-09-14', 'attended')],
      '2026-09-28',
    );

    expect(pending.map((session) => session.date)).toEqual([
      '2026-09-28',
      '2026-09-21',
      '2026-09-07',
    ]);
  });

  it('se queda vacio cuando esta todo marcado', () => {
    const pending = pendingSessions(
      subject,
      [block],
      [mark(block, '2026-09-07', 'attended'), mark(block, '2026-09-14', 'absent')],
      '2026-09-14',
    );

    expect(pending).toEqual([]);
  });
});

describe('la marca de una clase', () => {
  const subject = makeSubject();
  const block = makeBlock(subject);

  it('se identifica por tramo y dia, no por id', () => {
    // Es lo que permite fusionar sin duplicar cuando se marca la misma clase en el
    // telefono y en la computadora estando los dos sin conexion.
    const unaVez = mark(block, '2026-09-07', 'attended');
    const otraVez = mark(block, '2026-09-07', 'absent');

    expect(unaVez.id).not.toBe(otraVez.id);
    expect(attendanceNaturalKey(unaVez)).toBe(attendanceNaturalKey(otraVez));
  });

  it('volver a marcarla RESUCITA la borrada en vez de crear otra', () => {
    // Sin esto, desmarcar y volver a marcar dejaria dos filas para la misma clase y el
    // recuento contaria la falta dos veces.
    const borrada = softDeleteClassAttendance(mark(block, '2026-09-07', 'absent'), NOW);

    const revivida = unwrap(updateClassAttendance(borrada, { status: 'attended' }, NOW));

    expect(revivida.deletedAt).toBeNull();
    expect(revivida.status).toBe('attended');
    expect(revivida.id).toBe(borrada.id);
  });
});
