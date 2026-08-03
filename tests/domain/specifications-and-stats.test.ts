import { describe, expect, it } from 'vitest';

import type { Task } from '../../src/domain/task/task';
import type { TaskId, UserId } from '../../src/domain/shared/branded';

import { brandId } from '../../src/domain/shared/branded';
import {
  buildProductivitySnapshot,
  calculateStreak,
} from '../../src/domain/stats/productivity-stats';
import { createTask } from '../../src/domain/task/task';
import { positionBetween, rebalance } from '../../src/domain/shared/sortable-position';
import { sortTasks } from '../../src/domain/task/task-sorting';
import { unwrap } from '../../src/domain/shared/result';
import {
  buildTaskFilter,
  isInTodayViewSpec,
  isOverdueSpec,
  matchesQuerySpec,
} from '../../src/domain/task/task-specifications';

const USER_ID = brandId<UserId>('00000000-0000-4000-8000-000000000001');
const NOW_DATE = new Date(2026, 7, 2, 12, 0, 0);
const NOW = NOW_DATE.toISOString();

let counter = 0;
const makeTask = (overrides: Partial<Task> = {}): Task => {
  counter += 1;

  const base = unwrap(
    createTask({
      id: brandId<TaskId>(`00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`),
      userId: USER_ID,
      title: `Tarea ${counter}`,
      now: NOW,
    }),
  );

  return { ...base, ...overrides };
};

const at = (hoursFromNow: number): string =>
  new Date(NOW_DATE.getTime() + hoursFromNow * 3_600_000).toISOString();

describe('vista de Hoy', () => {
  it('incluye lo que vence hoy y lo que ya se vencio', () => {
    // Que lo atrasado entre en Hoy es la regla que define la pantalla: si se
    // quedara fuera, seria trabajo invisible.
    const dueLaterToday = makeTask({ dueAt: at(3) });
    const overdueYesterday = makeTask({ dueAt: at(-30) });
    const tomorrow = makeTask({ dueAt: at(30) });
    const noDate = makeTask();

    const spec = isInTodayViewSpec(NOW_DATE);

    expect(spec.isSatisfiedBy(dueLaterToday)).toBe(true);
    expect(spec.isSatisfiedBy(overdueYesterday)).toBe(true);
    expect(spec.isSatisfiedBy(tomorrow)).toBe(false);
    expect(spec.isSatisfiedBy(noDate)).toBe(false);
  });

  it('deja fuera lo completado y lo borrado', () => {
    const completed = makeTask({ dueAt: at(1), status: 'completed', completedAt: NOW });
    const deleted = makeTask({ dueAt: at(1), deletedAt: NOW });

    const spec = isInTodayViewSpec(NOW_DATE);

    expect(spec.isSatisfiedBy(completed)).toBe(false);
    expect(spec.isSatisfiedBy(deleted)).toBe(false);
  });

  it('una tarea completada nunca cuenta como atrasada', () => {
    const task = makeTask({ dueAt: at(-10), status: 'completed', completedAt: NOW });
    expect(isOverdueSpec(NOW).isSatisfiedBy(task)).toBe(false);
  });
});

describe('busqueda por texto', () => {
  it('ignora mayusculas y acentos', () => {
    const task = makeTask({ title: 'Revisión del informe ANUAL' });

    expect(matchesQuerySpec('revision').isSatisfiedBy(task)).toBe(true);
    expect(matchesQuerySpec('anual').isSatisfiedBy(task)).toBe(true);
  });

  it('exige que aparezcan todos los terminos', () => {
    const task = makeTask({ title: 'Comprar pan y leche' });

    expect(matchesQuerySpec('comprar leche').isSatisfiedBy(task)).toBe(true);
    expect(matchesQuerySpec('comprar cafe').isSatisfiedBy(task)).toBe(false);
  });

  it('busca tambien en notas y subtareas', () => {
    const withNotes = makeTask({ notes: 'Preguntar por el presupuesto' });
    expect(matchesQuerySpec('presupuesto').isSatisfiedBy(withNotes)).toBe(true);
  });
});

describe('filtros combinados', () => {
  it('acumula criterios', () => {
    const match = makeTask({ priority: 'high', isImportant: true, title: 'Informe urgente' });
    const wrongPriority = makeTask({ priority: 'low', isImportant: true, title: 'Informe' });

    const spec = buildTaskFilter({
      query: 'informe',
      priorities: ['high'],
      onlyImportant: true,
      now: NOW_DATE,
    });

    expect(spec.isSatisfiedBy(match)).toBe(true);
    expect(spec.isSatisfiedBy(wrongPriority)).toBe(false);
  });

  it('sin criterios solo excluye lo borrado', () => {
    const alive = makeTask();
    const deleted = makeTask({ deletedAt: NOW });

    const spec = buildTaskFilter({});

    expect(spec.isSatisfiedBy(alive)).toBe(true);
    expect(spec.isSatisfiedBy(deleted)).toBe(false);
  });
});

describe('ordenacion inteligente', () => {
  it('pone lo atrasado primero y lo mas atrasado arriba', () => {
    const slightlyLate = makeTask({ dueAt: at(-2), title: 'Poco tarde' });
    const veryLate = makeTask({ dueAt: at(-48), title: 'Muy tarde' });
    const upcoming = makeTask({ dueAt: at(2), title: 'Proxima' });

    const sorted = sortTasks([upcoming, slightlyLate, veryLate], 'smart', NOW_DATE);

    expect(sorted.map((task) => task.title)).toEqual(['Muy tarde', 'Poco tarde', 'Proxima']);
  });

  it('entre tareas no vencidas, lo destacado gana a la prioridad', () => {
    const important = makeTask({ isImportant: true, priority: 'low', title: 'Destacada' });
    const highPriority = makeTask({ isImportant: false, priority: 'high', title: 'Alta' });

    const sorted = sortTasks([highPriority, important], 'smart', NOW_DATE);

    expect(sorted[0]?.title).toBe('Destacada');
  });

  it('las tareas sin fecha van al final', () => {
    const dated = makeTask({ dueAt: at(5), title: 'Con fecha' });
    const undated = makeTask({ title: 'Sin fecha' });

    const sorted = sortTasks([undated, dated], 'due-asc', NOW_DATE);

    expect(sorted[0]?.title).toBe('Con fecha');
  });
});

describe('indexacion fraccionaria', () => {
  it('calcula el punto medio entre dos posiciones', () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
  });

  it('devuelve null cuando ya no queda hueco', () => {
    // Es la señal de que toca rebalancear.
    expect(positionBetween(1, 1 + 1e-9)).toBeNull();
  });

  it('el rebalanceo reparte posiciones equidistantes conservando el orden', () => {
    const items = [
      { id: 'a', position: 1 },
      { id: 'b', position: 1.0000001 },
      { id: 'c', position: 2 },
    ];

    const rebalanced = rebalance(items, (item, position) => ({ ...item, position }));

    expect(rebalanced.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(rebalanced[1]!.position - rebalanced[0]!.position).toBe(1024);
  });
});

describe('rachas', () => {
  const completedOn = (daysAgo: number): Task =>
    makeTask({
      status: 'completed',
      completedAt: new Date(NOW_DATE.getTime() - daysAgo * 86_400_000).toISOString(),
    });

  it('cuenta dias consecutivos hasta hoy', () => {
    const streak = calculateStreak([completedOn(0), completedOn(1), completedOn(2)], NOW_DATE);

    expect(streak.current).toBe(3);
    expect(streak.longest).toBe(3);
  });

  it('no rompe la racha si hoy todavia no se ha completado nada', () => {
    // Romperla a las 00:01 seria castigar por no haber empezado el dia.
    const streak = calculateStreak([completedOn(1), completedOn(2)], NOW_DATE);

    expect(streak.current).toBe(2);
  });

  it('la racha se rompe con un hueco de dos dias', () => {
    const streak = calculateStreak([completedOn(0), completedOn(3), completedOn(4)], NOW_DATE);

    expect(streak.current).toBe(1);
    expect(streak.longest).toBe(2);
  });

  it('sin actividad no hay racha', () => {
    const streak = calculateStreak([makeTask()], NOW_DATE);

    expect(streak.current).toBe(0);
    expect(streak.lastActiveDate).toBeNull();
  });
});

describe('foto de productividad', () => {
  it('resume totales, atrasadas y tasa de completado', () => {
    const tasks = [
      makeTask({ status: 'completed', completedAt: NOW }),
      makeTask({ status: 'completed', completedAt: NOW }),
      makeTask({ dueAt: at(-10) }),
      makeTask({ dueAt: at(10) }),
    ];

    const snapshot = buildProductivitySnapshot(tasks, [], NOW_DATE, 30);

    expect(snapshot.completedTotal).toBe(2);
    expect(snapshot.pendingTotal).toBe(2);
    expect(snapshot.overdueTotal).toBe(1);
    expect(snapshot.completionRate).toBe(0.5);
    expect(snapshot.completedToday).toBe(2);
  });

  it('la serie diaria cubre toda la ventana pedida', () => {
    const snapshot = buildProductivitySnapshot([makeTask()], [], NOW_DATE, 14);
    expect(snapshot.dailyCounts).toHaveLength(14);
  });

  it('lista las tareas mas pospuestas', () => {
    const tasks = [
      makeTask({ snoozeCount: 5, title: 'La eterna' }),
      makeTask({ snoozeCount: 1, title: 'Una vez' }),
      makeTask({ snoozeCount: 0 }),
    ];

    const snapshot = buildProductivitySnapshot(tasks, [], NOW_DATE, 30);

    expect(snapshot.mostPostponed[0]?.title).toBe('La eterna');
    expect(snapshot.mostPostponed).toHaveLength(2);
  });

  it('ignora las tareas borradas', () => {
    const snapshot = buildProductivitySnapshot(
      [makeTask(), makeTask({ deletedAt: NOW })],
      [],
      NOW_DATE,
      30,
    );

    expect(snapshot.totalTasks).toBe(1);
  });
});
