import { beforeEach, describe, expect, it } from 'vitest';

import type { TestHarness } from '../support/test-context';

import { createTestHarness } from '../support/test-context';
import { defaultRecurrenceRule } from '../../src/domain/recurrence/recurrence-rule';
import { isErr, unwrap } from '../../src/domain/shared/result';
import {
  CompleteTaskUseCase,
  CreateTaskUseCase,
  DeleteTaskUseCase,
  resolvePreset,
  SnoozeTaskUseCase,
  UncompleteTaskUseCase,
  UpdateTaskUseCase,
} from '../../src/application/use-cases/task/task-commands';
import { QuickCaptureTaskUseCase } from '../../src/application/use-cases/task/quick-capture-task';

describe('CreateTaskUseCase', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
  });

  it('crea y persiste la tarea', async () => {
    const result = await new CreateTaskUseCase(harness.context).execute({ title: 'Comprar pan' });

    const task = unwrap(result);
    expect(task.title).toBe('Comprar pan');
    expect(harness.tasks.items.size).toBe(1);
  });

  it('programa el recordatorio al guardar', async () => {
    await new CreateTaskUseCase(harness.context).execute({
      title: 'Reunion',
      dueAt: '2026-08-02T15:00:00.000Z',
      reminderAt: '2026-08-02T14:30:00.000Z',
    });

    expect(harness.notifications.schedule).toHaveBeenCalledTimes(1);
  });

  it('no programa recordatorios que ya pasaron', async () => {
    await new CreateTaskUseCase(harness.context).execute({
      title: 'Ya paso',
      dueAt: '2026-08-01T15:00:00.000Z',
      reminderAt: '2026-08-01T14:30:00.000Z',
    });

    expect(harness.notifications.schedule).not.toHaveBeenCalled();
  });

  it('exige sesion', async () => {
    const anonymous = createTestHarness(new Date('2026-08-02T12:00:00.000Z'), null);
    const result = await new CreateTaskUseCase(anonymous.context).execute({ title: 'Algo' });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('UNAUTHENTICATED');
  });

  it('asigna posiciones crecientes', async () => {
    const create = new CreateTaskUseCase(harness.context);

    const first = unwrap(await create.execute({ title: 'Primera' }));
    const second = unwrap(await create.execute({ title: 'Segunda' }));

    expect(second.position).toBeGreaterThan(first.position);
  });

  it('crea las subtareas iniciales', async () => {
    const task = unwrap(
      await new CreateTaskUseCase(harness.context).execute({
        title: 'Mudanza',
        subtaskTitles: ['Cajas', 'Camion', 'Limpieza'],
      }),
    );

    expect(task.subtasks).toHaveLength(3);
    expect(task.subtasks.map((subtask) => subtask.title)).toEqual(['Cajas', 'Camion', 'Limpieza']);
  });
});

describe('CompleteTaskUseCase', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
  });

  it('guarda la tarea completada y su siguiente ocurrencia en la misma operacion', async () => {
    const task = unwrap(
      await new CreateTaskUseCase(harness.context).execute({
        title: 'Regar plantas',
        dueAt: '2026-08-02T13:00:00.000Z',
        recurrence: defaultRecurrenceRule({ frequency: 'daily', interval: 2 }),
      }),
    );

    const result = unwrap(
      await new CompleteTaskUseCase(harness.context).execute({ taskId: task.id }),
    );

    expect(result.completed.status).toBe('completed');
    expect(result.next).not.toBeNull();
    // Las dos tienen que estar persistidas: si solo estuviera la completada, la serie
    // se habria perdido.
    expect(harness.tasks.items.size).toBe(2);
  });

  it('cancela el recordatorio de la tarea completada', async () => {
    const task = unwrap(
      await new CreateTaskUseCase(harness.context).execute({
        title: 'Reunion',
        dueAt: '2026-08-02T15:00:00.000Z',
        reminderAt: '2026-08-02T14:30:00.000Z',
      }),
    );

    harness.notifications.cancel.mockClear();
    await new CompleteTaskUseCase(harness.context).execute({ taskId: task.id });

    expect(harness.notifications.cancel).toHaveBeenCalled();
  });

  it('falla si la tarea no existe', async () => {
    const result = await new CompleteTaskUseCase(harness.context).execute({
      taskId: '00000000-0000-4000-8000-999999999999' as never,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('UncompleteTaskUseCase', () => {
  it('borra la ocurrencia que se genero al completar', async () => {
    // Es el bug clasico de las apps de habitos: marcar y desmarcar deja copias sueltas.
    const harness = createTestHarness();

    const task = unwrap(
      await new CreateTaskUseCase(harness.context).execute({
        title: 'Ejercicio',
        dueAt: '2026-08-02T13:00:00.000Z',
        recurrence: defaultRecurrenceRule({ frequency: 'daily' }),
      }),
    );

    const { completed } = unwrap(
      await new CompleteTaskUseCase(harness.context).execute({ taskId: task.id }),
    );

    const alive = () => [...harness.tasks.items.values()].filter((item) => item.deletedAt === null);

    expect(alive()).toHaveLength(2);

    await new UncompleteTaskUseCase(harness.context).execute({ taskId: completed.id });

    // La copia futura se marca como borrada; solo queda la original, reabierta.
    expect(alive()).toHaveLength(1);
    expect(alive()[0]?.status).toBe('pending');
  });
});

describe('SnoozeTaskUseCase', () => {
  it('aplica los atajos de posponer', async () => {
    const harness = createTestHarness(new Date('2026-08-02T12:00:00.000Z'));

    const task = unwrap(
      await new CreateTaskUseCase(harness.context).execute({
        title: 'Llamar',
        dueAt: '2026-08-02T13:00:00.000Z',
      }),
    );

    const snoozed = unwrap(
      await new SnoozeTaskUseCase(harness.context).execute({ taskId: task.id, preset: '1h' }),
    );

    expect(snoozed.snoozeCount).toBe(1);
    expect(Date.parse(snoozed.dueAt as string)).toBeGreaterThan(
      Date.parse('2026-08-02T12:00:00.000Z'),
    );
  });

  it('exige indicar hasta cuando', async () => {
    const harness = createTestHarness();
    const task = unwrap(await new CreateTaskUseCase(harness.context).execute({ title: 'Algo' }));

    const result = await new SnoozeTaskUseCase(harness.context).execute({ taskId: task.id });

    expect(isErr(result)).toBe(true);
  });
});

describe('resolvePreset', () => {
  it('"esta noche" salta a mañana si ya pasaron las 20:00', () => {
    const lateNight = new Date(2026, 7, 2, 22, 0, 0);
    const resolved = new Date(resolvePreset('tonight', lateNight));

    expect(resolved.getDate()).toBe(3);
    expect(resolved.getHours()).toBe(20);
  });

  it('"mañana" son las 9:00 del dia siguiente', () => {
    const resolved = new Date(resolvePreset('tomorrow', new Date(2026, 7, 2, 14, 0, 0)));

    expect(resolved.getDate()).toBe(3);
    expect(resolved.getHours()).toBe(9);
  });

  it('"la semana que viene" es el proximo lunes', () => {
    // La referencia es domingo: el proximo lunes es mañana.
    const resolved = new Date(resolvePreset('next-week', new Date(2026, 7, 2, 14, 0, 0)));

    expect(resolved.getDay()).toBe(1);
    expect(resolved.getDate()).toBe(3);
  });
});

describe('DeleteTaskUseCase', () => {
  it('borra en logico, no fisico', async () => {
    // La fila con `deletedAt` es lo unico que propaga el borrado al otro dispositivo.
    const harness = createTestHarness();
    const task = unwrap(await new CreateTaskUseCase(harness.context).execute({ title: 'Algo' }));

    await new DeleteTaskUseCase(harness.context).execute({ taskId: task.id });

    expect(harness.tasks.items.size).toBe(1);
    expect(harness.tasks.items.get(task.id)?.deletedAt).not.toBeNull();
  });
});

describe('QuickCaptureTaskUseCase', () => {
  it('crea la tarea con todo lo que interpreto la frase', async () => {
    const harness = createTestHarness(new Date(2026, 7, 2, 10, 0, 0));

    const result = unwrap(
      await new QuickCaptureTaskUseCase(harness.context).execute({
        text: 'Enviar informe mañana a las 9am !alta #trabajo @proyectos',
      }),
    );

    expect(result.task.title).toBe('Enviar informe');
    expect(result.task.priority).toBe('high');
    expect(result.task.dueAt).not.toBeNull();
    expect(result.createdCategory).toBe(true);
    expect(result.createdTags).toEqual(['trabajo']);

    expect(harness.categories.items.size).toBe(1);
    expect(harness.tags.items.size).toBe(1);
  });

  it('reutiliza una categoria existente sin importar mayusculas ni acentos', async () => {
    const harness = createTestHarness();
    const quickCapture = new QuickCaptureTaskUseCase(harness.context);

    await quickCapture.execute({ text: 'Uno @Trabajo' });
    const second = unwrap(await quickCapture.execute({ text: 'Dos @trabajo' }));

    expect(second.createdCategory).toBe(false);
    expect(harness.categories.items.size).toBe(1);
  });

  it('rechaza un texto vacio', async () => {
    const harness = createTestHarness();
    const result = await new QuickCaptureTaskUseCase(harness.context).execute({ text: '   ' });

    expect(isErr(result)).toBe(true);
  });

  it('pone recordatorio automatico cuando hay hora concreta', async () => {
    const harness = createTestHarness(new Date(2026, 7, 2, 10, 0, 0));

    const result = unwrap(
      await new QuickCaptureTaskUseCase(harness.context).execute({
        text: 'Reunion mañana a las 15:00',
      }),
    );

    expect(result.task.reminderAt).not.toBeNull();

    const lead =
      (Date.parse(result.task.dueAt as string) - Date.parse(result.task.reminderAt as string)) /
      60_000;
    expect(lead).toBe(10);
  });

  it('no pone recordatorio en tareas de todo el dia', async () => {
    // Avisar a una hora arbitraria de algo sin hora concreta seria ruido.
    const harness = createTestHarness(new Date(2026, 7, 2, 10, 0, 0));

    const result = unwrap(
      await new QuickCaptureTaskUseCase(harness.context).execute({ text: 'Cumpleaños el 15' }),
    );

    expect(result.task.isAllDay).toBe(true);
    expect(result.task.reminderAt).toBeNull();
  });
});

describe('UpdateTaskUseCase', () => {
  it('reprograma el recordatorio al mover la fecha', async () => {
    const harness = createTestHarness();

    const task = unwrap(
      await new CreateTaskUseCase(harness.context).execute({
        title: 'Cita',
        dueAt: '2026-08-02T15:00:00.000Z',
        reminderAt: '2026-08-02T14:30:00.000Z',
      }),
    );

    harness.notifications.cancel.mockClear();
    harness.notifications.schedule.mockClear();

    await new UpdateTaskUseCase(harness.context).execute({
      taskId: task.id,
      dueAt: '2026-08-04T15:00:00.000Z',
      reminderAt: '2026-08-04T14:30:00.000Z',
    });

    expect(harness.notifications.cancel).toHaveBeenCalled();
    expect(harness.notifications.schedule).toHaveBeenCalled();
  });
});
