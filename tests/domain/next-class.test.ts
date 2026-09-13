import { describe, expect, it } from 'vitest';

import type { ScheduleBlock } from '../../src/domain/schedule/schedule-block';
import type { ScheduleBlockId, SubjectId, UserId } from '../../src/domain/shared/branded';
import type { Subject } from '../../src/domain/schedule/subject';
import type { Weekday } from '../../src/domain/recurrence/recurrence-rule';

import { brandId } from '../../src/domain/shared/branded';
import { buildWeeklySchedule } from '../../src/domain/schedule/weekly-schedule';
import { createScheduleBlock } from '../../src/domain/schedule/schedule-block';
import { createSubject } from '../../src/domain/schedule/subject';
import { findUpcomingClass } from '../../src/domain/schedule/next-class';
import { unwrap } from '../../src/domain/shared/result';

/**
 * Cual es la proxima clase.
 *
 * Parece trivial y tiene tres casos que se cruzan: estar DENTRO de una clase, que la
 * siguiente sea hoy mas tarde, y que ya no quede ninguna hoy y haya que saltar al proximo
 * dia CON clases -que no es "mañana", porque el fin de semana existe-.
 */

const USER_ID = brandId<UserId>('00000000-0000-4000-8000-000000000001');
const NOW = '2026-09-13T12:00:00.000Z';

let counter = 0;
const nextSubjectId = () =>
  brandId<SubjectId>(`00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`);
const nextBlockId = () =>
  brandId<ScheduleBlockId>(`00000000-0000-4000-9000-${String(++counter).padStart(12, '0')}`);

const makeSubject = (code: string): Subject =>
  unwrap(
    createSubject({
      id: nextSubjectId(),
      userId: USER_ID,
      code,
      name: `Materia ${code}`,
      termCode: '2027-1',
      now: NOW,
    }),
  );

const makeBlock = (
  subject: Subject,
  weekday: Weekday,
  startsAt: string,
  endsAt: string,
): ScheduleBlock =>
  unwrap(
    createScheduleBlock({
      id: nextBlockId(),
      userId: USER_ID,
      subjectId: subject.id,
      weekday,
      startsAt,
      endsAt,
      now: NOW,
      locationLabel: 'FR1-411',
    }),
  );

const logica = makeSubject('TI3210');
const calculo = makeSubject('EGC252');

/* Lunes 12:00-14:00 y 20:00-22:00; jueves 16:00-19:00. Entre el lunes y el jueves hay dos
   dias sin ninguna clase, que es justo lo que hay que saber saltar. */
const BLOCKS = [
  makeBlock(calculo, 1, '12:00', '14:00'),
  makeBlock(logica, 1, '20:00', '22:00'),
  makeBlock(calculo, 4, '16:00', '19:00'),
];

const DAYS = buildWeeklySchedule([logica, calculo], BLOCKS);

describe('la proxima clase', () => {
  it('es la siguiente de hoy cuando aun queda alguna', () => {
    // Lunes a las 9:00: la de las 12:00.
    const upcoming = findUpcomingClass(DAYS, 1, 9 * 60);

    expect(upcoming?.item.subject.code).toBe('EGC252');
    expect(upcoming?.daysAhead).toBe(0);
    expect(upcoming?.minutesUntilStart).toBe(180);
    expect(upcoming?.isNow).toBe(false);
  });

  it('la que esta EN CURSO gana a la siguiente', () => {
    // Lunes a las 13:00, sentado en Calculo. Decir "Logica en 7 horas" seria cierto y
    // completamente inutil.
    const upcoming = findUpcomingClass(DAYS, 1, 13 * 60);

    expect(upcoming?.item.subject.code).toBe('EGC252');
    expect(upcoming?.isNow).toBe(true);
    expect(upcoming?.minutesUntilEnd).toBe(60);
    expect(upcoming?.minutesUntilStart).toBe(-60);
  });

  it('una clase que acaba de terminar ya no cuenta', () => {
    // A las 14:00 en punto la de las 12:00 se acabo: toca la de las 20:00.
    const upcoming = findUpcomingClass(DAYS, 1, 14 * 60);

    expect(upcoming?.item.subject.code).toBe('TI3210');
    expect(upcoming?.isNow).toBe(false);
  });

  it('salta a los dias siguientes cuando hoy ya no queda nada', () => {
    // Lunes a las 23:00 -> el jueves, tres dias despues. Los martes y miercoles no
    // existen en este horario y hay que pasarlos de largo.
    const upcoming = findUpcomingClass(DAYS, 1, 23 * 60);

    expect(upcoming?.daysAhead).toBe(3);
    expect(upcoming?.weekday).toBe(4);
    expect(upcoming?.item.block.startsAt).toBe('16:00');
  });

  it('cuenta los minutos atravesando la medianoche', () => {
    // Jueves a las 23:00 -> el lunes de la semana que viene a las 12:00.
    const upcoming = findUpcomingClass(DAYS, 4, 23 * 60);

    expect(upcoming?.daysAhead).toBe(4);
    // Cuatro dias menos once horas de esa noche, mas las doce del lunes.
    expect(upcoming?.minutesUntilStart).toBe(4 * 1440 + 12 * 60 - 23 * 60);
  });

  it('da la vuelta a la semana desde un dia sin clases', () => {
    // Sabado: la proxima es el lunes, dos dias despues.
    const upcoming = findUpcomingClass(DAYS, 6, 10 * 60);

    expect(upcoming?.daysAhead).toBe(2);
    expect(upcoming?.weekday).toBe(1);
  });

  it('devuelve null cuando no hay ninguna clase', () => {
    // Y la tira no se pinta. Un hueco fijo diciendo "no tienes clases" ocupa el mejor
    // sitio de la pantalla para no decir nada.
    expect(findUpcomingClass([], 1, 9 * 60)).toBeNull();
  });
});
