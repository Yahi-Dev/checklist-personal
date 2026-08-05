import { describe, expect, it } from 'vitest';

import type { TaskId, UserId } from '../../src/domain/shared/branded';
import type { Task } from '../../src/domain/task/task';

import { brandId } from '../../src/domain/shared/branded';
import { buildTaskFilter, wasCompletedBetweenSpec } from '../../src/domain/task/task-specifications';
import { createTask } from '../../src/domain/task/task';
import { groupByCompletionDay } from '../../src/domain/task/completion-log';
import { resolveRange } from '../../src/features/completed/completed-range';
import { unwrap } from '../../src/domain/shared/result';

/**
 * El historial de completadas.
 *
 * Todo lo que se prueba aqui es aritmetica de fechas, que es la parte que puede fallar SIN
 * dar ningun sintoma: un rango mal calculado no rompe nada, solo enseña una lista
 * incompleta que parece perfectamente correcta. La unica forma de tener confianza es fijar
 * instantes concretos y comprobar en que dia caen.
 */

const USER = brandId<UserId>('11111111-1111-4111-8111-111111111111');

let counter = 0;
const completedAt = (iso: string, overrides: Partial<Task> = {}): Task => {
  counter += 1;
  const base = unwrap(
    createTask({
      id: brandId<TaskId>(`00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`),
      userId: USER,
      title: `Tarea ${String(counter)}`,
      now: iso,
    }),
  );

  return { ...base, status: 'completed', completedAt: iso, ...overrides };
};

describe('agrupar por dia de completado', () => {
  it('mete en el mismo dia lo terminado a distintas horas', () => {
    const days = groupByCompletionDay([
      completedAt(local(2026, 8, 4, 9, 0)),
      completedAt(local(2026, 8, 4, 17, 30)),
      completedAt(local(2026, 8, 3, 11, 0)),
    ]);

    expect(days).toHaveLength(2);
    expect(days[0]?.tasks).toHaveLength(2);
    expect(days[1]?.tasks).toHaveLength(1);
  });

  it('pone los dias del mas reciente al mas antiguo', () => {
    const days = groupByCompletionDay([
      completedAt(local(2026, 8, 1, 10, 0)),
      completedAt(local(2026, 8, 5, 10, 0)),
      completedAt(local(2026, 8, 3, 10, 0)),
    ]);

    expect(days.map((day) => day.key)).toEqual(['2026-08-05', '2026-08-03', '2026-08-01']);
  });

  it('dentro de un dia pone lo ultimo terminado arriba', () => {
    const temprano = completedAt(local(2026, 8, 4, 8, 0));
    const tarde = completedAt(local(2026, 8, 4, 20, 0));

    const days = groupByCompletionDay([temprano, tarde]);

    expect(days[0]?.tasks.map((task) => task.id)).toEqual([tarde.id, temprano.id]);
  });

  it('agrupa por el dia LOCAL, no por el que lleva dentro la marca en UTC', () => {
    /**
     * El fallo que este modulo existe para no cometer.
     *
     * Una tarea cerrada a las 21:00 en Santo Domingo (UTC-4) se guarda como la 01:00 del
     * DIA SIGUIENTE en UTC. Partir el texto ISO por la T -que es lo que sale solo- la
     * pondria en el dia equivocado, y el error solo aparece de noche.
     */
    const nocheDelCuatro = new Date(2026, 7, 4, 21, 0).toISOString();
    const days = groupByCompletionDay([completedAt(nocheDelCuatro)]);

    expect(days[0]?.key).toBe('2026-08-04');
  });

  it('descarta lo que no se ha completado', () => {
    const pendiente = unwrap(
      createTask({
        id: brandId<TaskId>('00000000-0000-4000-8000-000000000999'),
        userId: USER,
        title: 'Sin terminar',
        now: local(2026, 8, 4, 10, 0),
      }),
    );

    expect(groupByCompletionDay([pendiente, completedAt(local(2026, 8, 4, 10, 0))])).toHaveLength(
      1,
    );
  });

  it('no pierde nada: la suma de los dias es el total', () => {
    const tasks = [
      completedAt(local(2026, 8, 4, 9, 0)),
      completedAt(local(2026, 8, 4, 10, 0)),
      completedAt(local(2026, 7, 30, 10, 0)),
      completedAt(local(2025, 12, 31, 23, 30)),
    ];

    const total = groupByCompletionDay(tasks).reduce((sum, day) => sum + day.tasks.length, 0);

    expect(total).toBe(tasks.length);
  });
});

describe('filtrar por fecha de completado', () => {
  it('incluye los extremos del rango', () => {
    const inicio = new Date(2026, 7, 3, 0, 0, 0, 0);
    const fin = new Date(2026, 7, 4, 23, 59, 59, 999);
    const specification = wasCompletedBetweenSpec(inicio, fin);

    expect(specification.isSatisfiedBy(completedAt(inicio.toISOString()))).toBe(true);
    expect(specification.isSatisfiedBy(completedAt(fin.toISOString()))).toBe(true);
    expect(specification.isSatisfiedBy(completedAt(local(2026, 8, 2, 23, 59)))).toBe(false);
    expect(specification.isSatisfiedBy(completedAt(local(2026, 8, 5, 0, 0)))).toBe(false);
  });

  it('mira cuando se HIZO, no cuando vencia', () => {
    // Una tarea que vencia el lunes y se cerro el viernes pertenece al viernes en este
    // historial. Confundirlo es lo que hacia que Buscar no sirviera para esta pregunta.
    const task = completedAt(local(2026, 8, 7, 10, 0), { dueAt: local(2026, 8, 3, 10, 0) });

    const viernes = buildTaskFilter({
      completedFrom: new Date(2026, 7, 7, 0, 0, 0, 0),
      completedTo: new Date(2026, 7, 7, 23, 59, 59, 999),
    });
    const lunes = buildTaskFilter({
      completedFrom: new Date(2026, 7, 3, 0, 0, 0, 0),
      completedTo: new Date(2026, 7, 3, 23, 59, 59, 999),
    });

    expect(viernes.isSatisfiedBy(task)).toBe(true);
    expect(lunes.isSatisfiedBy(task)).toBe(false);
  });

  it('cuenta tambien lo archivado despues de terminarlo', () => {
    // Archivar saca la tarea de "completada" pero no deja de ser algo que se hizo ese dia.
    // Filtrar por estado en vez de por fecha vaciaria el historial de quien ordena
    // archivando lo que ya cerro.
    const archivada = completedAt(local(2026, 8, 4, 10, 0), { status: 'archived' });

    const specification = buildTaskFilter({
      completedFrom: new Date(2026, 7, 4, 0, 0, 0, 0),
      completedTo: new Date(2026, 7, 4, 23, 59, 59, 999),
    });

    expect(specification.isSatisfiedBy(archivada)).toBe(true);
  });
});

describe('rangos por periodo', () => {
  const AHORA = new Date(2026, 7, 4, 15, 30);
  const vacio = { from: '', to: '' };

  it('"hoy" cubre el dia entero, no desde ahora', () => {
    const range = resolveRange('hoy', vacio, AHORA);

    expect(range.from?.getHours()).toBe(0);
    expect(range.to?.getHours()).toBe(23);
    // Lo terminado esta mañana entra: sin esto, filtrar "hoy" por la tarde perderia medio dia.
    expect(range.from?.getTime()).toBeLessThan(new Date(2026, 7, 4, 9, 0).getTime());
  });

  it('"7 dias" incluye hoy y los seis anteriores', () => {
    const range = resolveRange('semana', vacio, AHORA);

    expect(range.from?.getDate()).toBe(29);
    expect(range.from?.getMonth()).toBe(6);
    expect(range.to?.getDate()).toBe(4);
  });

  it('"ayer" es solo ayer', () => {
    const range = resolveRange('ayer', vacio, AHORA);

    expect(range.from?.getDate()).toBe(3);
    expect(range.to?.getDate()).toBe(3);
  });

  it('"todo" no pone limites', () => {
    expect(resolveRange('todo', vacio, AHORA)).toEqual({ from: null, to: null });
  });

  it('respeta el dia elegido a mano en vez de correrlo por el huso', () => {
    // `new Date('2026-08-04')` es medianoche UTC, que al oeste de Greenwich cae el dia 3.
    // El rango tiene que empezar el dia que el usuario escribio.
    const range = resolveRange('personalizado', { from: '2026-08-04', to: '2026-08-06' }, AHORA);

    expect(range.from?.getDate()).toBe(4);
    expect(range.to?.getDate()).toBe(6);
    expect(range.to?.getHours()).toBe(23);
  });

  it('admite un extremo suelto y descarta lo ilegible', () => {
    expect(resolveRange('personalizado', { from: '2026-08-04', to: '' }, AHORA).to).toBeNull();
    expect(resolveRange('personalizado', { from: 'vaya', to: '' }, AHORA).from).toBeNull();
  });
});

/** Instante local, con el mes como lo escribe una persona (8 = agosto). */
const local = (year: number, month: number, day: number, hour: number, minute: number): string =>
  new Date(year, month - 1, day, hour, minute).toISOString();
