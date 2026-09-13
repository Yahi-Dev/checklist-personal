import { beforeEach, describe, expect, it } from 'vitest';

import type { ScheduleBlock } from '../../src/domain/schedule/schedule-block';
import type { Subject } from '../../src/domain/schedule/subject';
import type { TestHarness } from '../support/test-context';

import {
  ClearAttendanceUseCase,
  MarkAttendanceUseCase,
} from '../../src/application/use-cases/schedule/attendance-commands';
import { createTestHarness } from '../support/test-context';
import {
  CreateScheduleBlockUseCase,
  CreateSubjectUseCase,
} from '../../src/application/use-cases/schedule/schedule-commands';
import { isErr, unwrap } from '../../src/domain/shared/result';

/**
 * Marcar asistencia tiene que ser IDEMPOTENTE por (tramo, dia).
 *
 * Marcar el martes dos veces, o marcarlo, quitarlo y volver a marcarlo, no puede dejar
 * dos filas para la misma clase: entonces el recuento contaria la falta dos veces y el
 * "te quedan 3 faltas" seria mentira.
 *
 * Y como el servidor NO tiene indice unico -a proposito, porque dos dispositivos sin
 * conexion marcando el mismo dia produciran siempre dos filas y un indice unico
 * envenenaria la cola-, la fusion tiene que ocurrir aqui.
 */

const LUNES = '2026-09-07';

describe('marcar asistencia', () => {
  let harness: TestHarness;
  let subject: Subject;
  let block: ScheduleBlock;

  beforeEach(async () => {
    harness = createTestHarness();

    subject = unwrap(
      await new CreateSubjectUseCase(harness.context).execute({
        code: 'TI3210',
        name: 'Logica Matematica',
        termCode: '2027-1',
        startsOn: '2026-09-07',
        endsOn: '2026-12-19',
      }),
    );

    block = unwrap(
      await new CreateScheduleBlockUseCase(harness.context).execute({
        subjectId: subject.id,
        weekday: 1,
        startsAt: '20:00',
        endsAt: '22:00',
      }),
    );
  });

  const marcar = (status: 'attended' | 'absent' | 'excused' | 'cancelled', date = LUNES) =>
    new MarkAttendanceUseCase(harness.context).execute({
      blockId: block.id,
      sessionDate: date,
      status,
    });

  const vivas = () =>
    [...harness.attendance.items.values()].filter((record) => record.deletedAt === null);

  it('guarda la marca con su materia ya resuelta', async () => {
    // `subjectId` se copia del tramo y no se pide: casi todas las consultas son por
    // materia, y pedirlo al llamador seria una via para que llegara mal.
    const record = unwrap(await marcar('attended'));

    expect(record.subjectId).toBe(subject.id);
    expect(record.blockId).toBe(block.id);
    expect(record.status).toBe('attended');
  });

  it('exige sesion', async () => {
    const sinSesion = createTestHarness(new Date('2026-09-13T12:00:00.000Z'), null);

    const result = await new MarkAttendanceUseCase(sinSesion.context).execute({
      blockId: block.id,
      sessionDate: LUNES,
      status: 'attended',
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('UNAUTHENTICATED');
  });

  it('falla si la clase no existe', async () => {
    const result = await new MarkAttendanceUseCase(harness.context).execute({
      blockId: '00000000-0000-4000-8000-999999999999' as never,
      sessionDate: LUNES,
      status: 'attended',
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('cambiar de opinion NO crea una segunda fila', async () => {
    const primera = unwrap(await marcar('attended'));
    const segunda = unwrap(await marcar('absent'));

    expect(segunda.id).toBe(primera.id);
    expect(segunda.status).toBe('absent');
    expect(harness.attendance.items.size).toBe(1);
  });

  it('quitar la marca la borra en logico, y volver a marcarla resucita la misma fila', async () => {
    const primera = unwrap(await marcar('absent'));

    unwrap(
      await new ClearAttendanceUseCase(harness.context).execute({
        blockId: block.id,
        sessionDate: LUNES,
      }),
    );

    expect(vivas()).toHaveLength(0);
    // En logico, nunca en fisico: quitar la marca tiene que viajar al otro dispositivo.
    expect(harness.attendance.items.size).toBe(1);

    const revivida = unwrap(await marcar('attended'));

    expect(revivida.id).toBe(primera.id);
    expect(revivida.deletedAt).toBeNull();
    expect(harness.attendance.items.size).toBe(1);
  });

  it('dias distintos son marcas distintas', async () => {
    await marcar('attended', '2026-09-07');
    await marcar('absent', '2026-09-14');

    expect(vivas()).toHaveLength(2);
  });

  it('FUSIONA lo que llega duplicado de dos dispositivos', async () => {
    // El escenario que el servidor no puede impedir: dos aparatos sin conexion marcan la
    // misma clase y suben dos filas con ids distintos. Sin esta fusion, el recuento
    // contaria la falta dos veces para siempre.
    const primera = unwrap(await marcar('attended'));

    const gemela = { ...primera, id: 'otra-fila' as typeof primera.id, status: 'absent' as const };
    await harness.attendance.save(gemela);
    expect(vivas()).toHaveLength(2);

    const resultado = unwrap(await marcar('excused'));

    expect(vivas()).toHaveLength(1);
    expect(resultado.status).toBe('excused');
  });

  it('quitar la marca limpia tambien los duplicados', async () => {
    const primera = unwrap(await marcar('attended'));
    await harness.attendance.save({ ...primera, id: 'otra-fila' as typeof primera.id });

    unwrap(
      await new ClearAttendanceUseCase(harness.context).execute({
        blockId: block.id,
        sessionDate: LUNES,
      }),
    );

    expect(vivas()).toHaveLength(0);
  });

  it('quitar una marca que no existe no es un error', async () => {
    const result = await new ClearAttendanceUseCase(harness.context).execute({
      blockId: block.id,
      sessionDate: '2026-10-05',
    });

    expect(isErr(result)).toBe(false);
  });
});
