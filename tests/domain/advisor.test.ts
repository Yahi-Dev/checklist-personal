import { describe, expect, it } from 'vitest';

import type { Subtask } from '../../src/domain/task/subtask';
import type { SubtaskId, TaskId, UserId } from '../../src/domain/shared/branded';
import type { Task } from '../../src/domain/task/task';

import { brandId } from '../../src/domain/shared/branded';
import { buildPlanningBrief, MAX_BRIEF_TASKS } from '../../src/domain/assistant/planning-brief';
import { createSubtask, toggleSubtask } from '../../src/domain/task/subtask';
import { createTask } from '../../src/domain/task/task';
import { isErr, unwrap } from '../../src/domain/shared/result';
import { MAX_PLAN_STEPS, parseAdvisorPlan } from '../../src/domain/assistant/advisor-plan';
import { positionsBeforeAll } from '../../src/domain/shared/sortable-position';

const USER_ID = brandId<UserId>('00000000-0000-4000-8000-000000000001');

/** Mediodia del domingo 2 de agosto de 2026 en hora local. */
const NOW = new Date(2026, 7, 2, 12, 0, 0);

let counter = 0;
const nextId = () =>
  brandId<TaskId>(`00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`);

const task = (overrides: Partial<Parameters<typeof createTask>[0]> = {}): Task =>
  unwrap(
    createTask({
      id: nextId(),
      userId: USER_ID,
      title: 'Tarea',
      now: NOW.toISOString(),
      ...overrides,
    }),
  );

/** Desplazamiento en horas sobre NOW, como ISO. */
const hours = (delta: number): string =>
  new Date(NOW.getTime() + delta * 60 * 60 * 1000).toISOString();

describe('buildPlanningBrief', () => {
  it('clasifica cada tarea segun donde cae respecto a ahora', () => {
    const brief = buildPlanningBrief({
      tasks: [
        task({ title: 'Vencida ayer', dueAt: hours(-30) }),
        task({ title: 'Para esta tarde', dueAt: hours(5) }),
        task({ title: 'Pasado mañana', dueAt: hours(48) }),
        task({ title: 'Sin fecha' }),
      ],
      now: NOW,
    });

    const byTitle = new Map(brief.tareas.map((item) => [item.titulo, item.horizonte]));

    expect(byTitle.get('Vencida ayer')).toBe('atrasada');
    expect(byTitle.get('Para esta tarde')).toBe('hoy');
    expect(byTitle.get('Pasado mañana')).toBe('pronto');
    expect(byTitle.get('Sin fecha')).toBe('sin-fecha');
  });

  it('deja fuera lo que vence pasado el horizonte de tres dias', () => {
    const brief = buildPlanningBrief({
      tasks: [task({ title: 'El mes que viene', dueAt: hours(24 * 30) })],
      now: NOW,
    });

    expect(brief.tareas).toHaveLength(0);
    // No es un recorte por el limite: sencillamente no es relevante para hoy.
    expect(brief.omitidas).toBe(0);
  });

  it('pone lo atrasado primero y lo destacado por delante de la prioridad', () => {
    const brief = buildPlanningBrief({
      tasks: [
        task({ title: 'Sin fecha', priority: 'high' }),
        task({ title: 'Hoy normal', dueAt: hours(3) }),
        task({ title: 'Hoy destacada', dueAt: hours(6), isImportant: true }),
        task({ title: 'Atrasada', dueAt: hours(-2) }),
      ],
      now: NOW,
    });

    expect(brief.tareas.map((item) => item.titulo)).toEqual([
      'Atrasada',
      'Hoy destacada',
      'Hoy normal',
      'Sin fecha',
    ]);
  });

  it('cuenta las que no caben en vez de recortarlas en silencio', () => {
    const many = Array.from({ length: MAX_BRIEF_TASKS + 5 }, (_, index) =>
      task({ title: `Tarea ${String(index)}`, dueAt: hours(2) }),
    );

    const brief = buildPlanningBrief({ tasks: many, now: NOW });

    expect(brief.tareas).toHaveLength(MAX_BRIEF_TASKS);
    expect(brief.omitidas).toBe(5);
  });

  it('cuenta las completadas de hoy y no las mete en la lista', () => {
    const done: Task = {
      ...task({ title: 'Ya hecha' }),
      status: 'completed',
      completedAt: hours(-1),
    };
    const doneYesterday: Task = {
      ...task({ title: 'De ayer' }),
      status: 'completed',
      completedAt: hours(-30),
    };

    const brief = buildPlanningBrief({
      tasks: [done, doneYesterday, task({ title: 'Pendiente', dueAt: hours(1) })],
      now: NOW,
    });

    expect(brief.completadasHoy).toBe(1);
    expect(brief.tareas.map((item) => item.titulo)).toEqual(['Pendiente']);
  });

  it('traduce pomodoros a minutos y resume el progreso de las subtareas', () => {
    const parent = task({ title: 'Con partes', dueAt: hours(2), estimatedPomodoros: 3 });

    const subtask = (title: string, position: number): Subtask =>
      unwrap(
        createSubtask({
          id: brandId<SubtaskId>(`00000000-0000-4000-9000-${String(position).padStart(12, '0')}`),
          taskId: parent.id,
          title,
          now: NOW.toISOString(),
          position,
        }),
      );

    const withSubtasks: Task = {
      ...parent,
      subtasks: [toggleSubtask(subtask('a', 1), NOW.toISOString()), subtask('b', 2)],
    };

    const [item] = buildPlanningBrief({ tasks: [withSubtasks], now: NOW }).tareas;

    expect(item?.minutosEstimados).toBe(75);
    expect(item?.subtareas).toEqual({ hechas: 1, total: 2 });
  });

  it('no incluye tareas borradas', () => {
    const deleted: Task = { ...task({ dueAt: hours(1) }), deletedAt: hours(-1) };

    expect(buildPlanningBrief({ tasks: [deleted], now: NOW }).tareas).toHaveLength(0);
  });
});

describe('parseAdvisorPlan', () => {
  const A = '00000000-0000-4000-8000-00000000aaaa';
  const B = '00000000-0000-4000-8000-00000000bbbb';
  const known = new Set([A, B]);

  it('acepta un plan bien formado', () => {
    const plan = unwrap(
      parseAdvisorPlan(
        {
          resumen: 'Primero lo que vence.',
          pasos: [
            { taskId: A, minutos: 30, porque: 'Vence en una hora.' },
            { taskId: B, minutos: 0, porque: 'Lo demas puede esperar.' },
          ],
          ajustes: [{ taskId: B, tipo: 'prioridad', valor: 'low' }],
        },
        known,
      ),
    );

    expect(plan.pasos.map((step) => step.taskId)).toEqual([A, B]);
    // `minutos: 0` significa "no supe estimarlo", no "cero minutos".
    expect(plan.pasos[1]?.minutos).toBeNull();
    expect(plan.ajustes).toEqual([{ kind: 'prioridad', taskId: B, prioridad: 'low' }]);
    expect(plan.descartadas).toBe(0);
  });

  it('descarta los identificadores que no existen y lo declara', () => {
    const plan = unwrap(
      parseAdvisorPlan(
        {
          resumen: '',
          pasos: [
            { taskId: A, minutos: 10, porque: 'Real.' },
            { taskId: 'tarea-inventada', minutos: 10, porque: 'Alucinada.' },
          ],
          ajustes: [{ taskId: 'otra-inventada', tipo: 'destacar', valor: true }],
        },
        known,
      ),
    );

    expect(plan.pasos).toHaveLength(1);
    expect(plan.ajustes).toHaveLength(0);
    expect(plan.descartadas).toBe(2);
  });

  it('no coloca la misma tarea dos veces en el orden', () => {
    const plan = unwrap(
      parseAdvisorPlan(
        {
          resumen: '',
          pasos: [
            { taskId: A, minutos: 10, porque: 'Primera vez.' },
            { taskId: A, minutos: 10, porque: 'Repetida.' },
          ],
          ajustes: [],
        },
        known,
      ),
    );

    expect(plan.pasos).toHaveLength(1);
    expect(plan.descartadas).toBe(1);
  });

  it('rechaza el plan cuando ninguna referencia es real', () => {
    const result = parseAdvisorPlan(
      { resumen: 'x', pasos: [{ taskId: 'fantasma', minutos: 1, porque: 'x' }], ajustes: [] },
      known,
    );

    expect(isErr(result)).toBe(true);
  });

  it('rechaza un ajuste con un valor que no es del tipo declarado', () => {
    const plan = unwrap(
      parseAdvisorPlan(
        {
          resumen: '',
          pasos: [{ taskId: A, minutos: 5, porque: 'ok' }],
          ajustes: [
            { taskId: B, tipo: 'prioridad', valor: 'urgentisima' },
            { taskId: B, tipo: 'posponer', valor: 'el-año-que-viene' },
            { taskId: B, tipo: 'destacar', valor: 'si' },
          ],
        },
        known,
      ),
    );

    expect(plan.ajustes).toHaveLength(0);
    expect(plan.descartadas).toBe(3);
  });

  it('corta el plan al maximo de pasos', () => {
    const ids = Array.from({ length: MAX_PLAN_STEPS + 3 }, (_, i) => `id-${String(i)}`);

    const plan = unwrap(
      parseAdvisorPlan(
        {
          resumen: '',
          pasos: ids.map((id) => ({ taskId: id, minutos: 5, porque: 'x' })),
          ajustes: [],
        },
        new Set(ids),
      ),
    );

    expect(plan.pasos).toHaveLength(MAX_PLAN_STEPS);
  });

  it('rechaza cualquier cosa que no sea un objeto', () => {
    expect(isErr(parseAdvisorPlan('un plan', known))).toBe(true);
    expect(isErr(parseAdvisorPlan(null, known))).toBe(true);
    expect(isErr(parseAdvisorPlan([1, 2], known))).toBe(true);
  });
});

describe('positionsBeforeAll', () => {
  it('devuelve posiciones crecientes y todas por delante de las existentes', () => {
    const positions = positionsBeforeAll(3, [1024, 2048, 3072]);

    expect(positions).toHaveLength(3);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(Math.max(...positions)).toBeLessThan(1024);
  });

  it('funciona sobre una lista vacia', () => {
    expect(positionsBeforeAll(2, [])).toHaveLength(2);
  });
});
