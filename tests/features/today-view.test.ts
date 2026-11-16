import { describe, expect, it } from 'vitest';

import type { Task } from '../../src/domain/task/task';
import type { TaskId, UserId } from '../../src/domain/shared/branded';

import { brandId } from '../../src/domain/shared/branded';
import { buildTodayView } from '../../src/features/today/today-view';
import { createTask } from '../../src/domain/task/task';
import { unwrap } from '../../src/domain/shared/result';

const USER_ID = brandId<UserId>('00000000-0000-4000-8000-000000000001');
const NOW = new Date(2026, 10, 16, 12, 0, 0);

let counter = 0;
const makeTask = (overrides: Partial<Task> = {}): Task => {
  counter += 1;
  const base = unwrap(
    createTask({
      id: brandId<TaskId>(`00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`),
      userId: USER_ID,
      title: `Tarea ${counter}`,
      now: NOW.toISOString(),
    }),
  );
  return { ...base, ...overrides };
};

const hoursFromNow = (hours: number): string =>
  new Date(NOW.getTime() + hours * 3_600_000).toISOString();

const titles = (tasks: readonly Task[]) => tasks.map((task) => task.title).sort();

describe('la vista de Hoy', () => {
  const overdue = makeTask({
    title: 'Llamar a Raffy por los documentos',
    dueAt: hoursFromNow(-30),
  });
  const today = makeTask({ title: 'Enviarle el Daily a Jhoan', dueAt: hoursFromNow(3) });
  const tomorrow = makeTask({ title: 'Pagar la luz', dueAt: hoursFromNow(30) });
  const doneToday = makeTask({
    title: 'Configurar el celular',
    status: 'completed',
    completedAt: hoursFromNow(-1),
  });
  const doneYesterday = makeTask({
    title: 'Trabajar con KUIDO',
    status: 'completed',
    completedAt: hoursFromNow(-26),
  });
  const all = [overdue, today, tomorrow, doneToday, doneYesterday];

  it('separa lo que se pasó, lo de hoy y lo completado hoy', () => {
    const view = buildTodayView(all, NOW);
    expect(titles(view.overdue)).toEqual(['Llamar a Raffy por los documentos']);
    expect(titles(view.today)).toEqual(['Enviarle el Daily a Jhoan']);
    // Lo completado hoy está en la vista; lo de ayer, no (eso es de «Completadas»).
    expect(titles(view.completedToday)).toEqual(['Configurar el celular']);
  });

  it('el buscador filtra las tres partes, sin importar mayúsculas ni acentos', () => {
    const view = buildTodayView(all, NOW, 'LLAMAR');
    expect(titles(view.overdue)).toEqual(['Llamar a Raffy por los documentos']);
    expect(view.today).toEqual([]);
    expect(view.completedToday).toEqual([]);

    expect(titles(buildTodayView(all, NOW, 'celular').completedToday)).toEqual([
      'Configurar el celular',
    ]);
    expect(titles(buildTodayView(all, NOW, 'jhóan daily').today)).toEqual([
      'Enviarle el Daily a Jhoan',
    ]);
  });

  it('busca también en las notas y las subtareas', () => {
    const withNotes = makeTask({
      title: 'Trabajar en el proyecto de Ashley',
      notes: 'ashley ynoa 829-408-3176',
      dueAt: hoursFromNow(2),
    });
    expect(titles(buildTodayView([withNotes], NOW, '829-408').today)).toEqual([
      'Trabajar en el proyecto de Ashley',
    ]);
  });

  it('sin texto, o solo espacios, no filtra', () => {
    expect(buildTodayView(all, NOW, '   ')).toEqual(buildTodayView(all, NOW));
  });
});
