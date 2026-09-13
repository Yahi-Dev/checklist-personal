import { beforeEach, describe, expect, it } from 'vitest';

import type { Subject } from '../../src/domain/schedule/subject';
import type { TestHarness } from '../support/test-context';

import { createTestHarness } from '../support/test-context';
import {
  CreateScheduleBlockUseCase,
  CreateSubjectUseCase,
} from '../../src/application/use-cases/schedule/schedule-commands';
import { unwrap } from '../../src/domain/shared/result';

/**
 * El aviso antes de clase.
 *
 * Lo delicado no es programarlo: es que la hora salga bien. Una clase de los lunes a las
 * 20:00 es hora de RELOJ DE PARED -las ocho son las ocho-, asi que el instante hay que
 * construirlo en hora local. Pasar por UTC la moveria cuatro horas y el aviso sonaria a
 * las cuatro de la tarde.
 *
 * El ancla es el lunes 7 de septiembre de 2026 a las 10 de la mañana, hora local.
 */

const LUNES_10AM = new Date(2026, 8, 7, 10, 0, 0, 0);

describe('ClassReminderScheduler', () => {
  let harness: TestHarness;
  let subject: Subject;

  beforeEach(async () => {
    harness = createTestHarness(LUNES_10AM);

    subject = unwrap(
      await new CreateSubjectUseCase(harness.context).execute({
        code: 'TI3210',
        name: 'Logica Matematica',
        termCode: '2027-1',
        startsOn: '2026-09-07',
        endsOn: '2026-12-19',
      }),
    );

    await new CreateScheduleBlockUseCase(harness.context).execute({
      subjectId: subject.id,
      weekday: 1,
      startsAt: '20:00',
      endsAt: '22:00',
      locationLabel: 'FR1-411',
    });
  });

  const programados = () =>
    harness.notifications.schedule.mock.calls.map(
      ([notification]) =>
        notification as { id: string; title: string; body: string; scheduledAt: string },
    );

  it('avisa a la hora local, no en UTC', async () => {
    await harness.context.classReminders.rebuildAll(15);

    const aviso = programados().find((item) => item.id.startsWith('clase:'));
    if (aviso === undefined) throw new Error('no se programo el aviso');

    const cuando = new Date(aviso.scheduledAt);

    // 20:00 menos 15 minutos, en hora local: las 19:45 del lunes 7.
    expect(cuando.getFullYear()).toBe(2026);
    expect(cuando.getMonth()).toBe(8);
    expect(cuando.getDate()).toBe(7);
    expect(cuando.getHours()).toBe(19);
    expect(cuando.getMinutes()).toBe(45);
  });

  it('dice el aula, que es lo que se olvida', async () => {
    await harness.context.classReminders.rebuildAll(15);

    const aviso = programados().find((item) => item.id.startsWith('clase:'));

    expect(aviso?.title).toBe('Logica Matematica');
    expect(aviso?.body).toBe('Edif. FR1 · Aula 411');
  });

  it('no choca con los recordatorios de tareas', async () => {
    // Comparten el mismo puerto de notificaciones, asi que un id repetido haria que uno
    // reemplazara al otro sin avisar.
    await harness.context.classReminders.rebuildAll(15);

    for (const aviso of programados()) {
      expect(aviso.id.startsWith('clase:')).toBe(true);
    }
  });

  it('programa la semana entera pero no mas', async () => {
    // Lunes 7 y lunes 14: el horizonte es de siete dias, y el 14 cae justo dentro.
    await harness.context.classReminders.rebuildAll(15);

    const avisos = programados().filter((item) => item.id.startsWith('clase:'));

    expect(avisos).toHaveLength(2);
    expect(
      avisos.map((item) => item.id.endsWith('2026-09-07') || item.id.endsWith('2026-09-14')),
    ).toEqual([true, true]);
  });

  it('no programa lo que ya paso', async () => {
    // A las 21:00 del lunes, el aviso de las 19:45 de hoy ya no tiene sentido: el
    // navegador lo dispararia de inmediato.
    const tarde = createTestHarness(new Date(2026, 8, 7, 21, 0, 0, 0));

    const suSubject = unwrap(
      await new CreateSubjectUseCase(tarde.context).execute({
        code: 'TI3210',
        name: 'Logica',
        termCode: '2027-1',
        startsOn: '2026-09-07',
        endsOn: '2026-12-19',
      }),
    );
    await new CreateScheduleBlockUseCase(tarde.context).execute({
      subjectId: suSubject.id,
      weekday: 1,
      startsAt: '20:00',
      endsAt: '22:00',
    });

    await tarde.context.classReminders.rebuildAll(15);

    const avisos = tarde.notifications.schedule.mock.calls.map(
      ([notification]) => notification as { id: string },
    );

    expect(avisos.filter((item) => item.id.endsWith('2026-09-07'))).toHaveLength(0);
  });

  it('con antelacion 0 no programa nada, y ademas limpia', async () => {
    // Apagar la funcion tiene que dejar limpio de verdad, no solo dejar de crear avisos.
    await harness.context.classReminders.rebuildAll(0);

    expect(programados().filter((item) => item.id.startsWith('clase:'))).toHaveLength(0);
    expect(harness.notifications.cancel.mock.calls.length).toBeGreaterThan(0);
  });

  it('NO usa cancelAll, que borraria los avisos de las tareas', async () => {
    // El planificador de tareas si lo usa. Si este tambien lo hiciera, cada uno borraria
    // los del otro segun el orden en que arrancaran.
    await harness.context.classReminders.rebuildAll(15);

    expect(harness.notifications.cancelAll).not.toHaveBeenCalled();
  });

  it('cancela el aviso de una clase que ya no existe', async () => {
    // Quitar una clase del horario tiene que llevarse su aviso; si no, sonaria igual y el
    // usuario iria a un aula donde no hay nadie.
    const blocks = unwrap(await harness.context.scheduleBlocks.findAll());
    const block = blocks[0];
    if (block === undefined) throw new Error('falta el tramo');

    await harness.context.scheduleBlocks.save({ ...block, deletedAt: '2026-09-07T11:00:00.000Z' });

    await harness.context.classReminders.rebuildAll(15);

    const cancelados = harness.notifications.cancel.mock.calls.map(([id]) => id as string);

    expect(cancelados).toContain(`clase:${block.id}:2026-09-07`);
    expect(programados().filter((item) => item.id.startsWith('clase:'))).toHaveLength(0);
  });
});
