import { beforeEach, describe, expect, it } from 'vitest';

import type { Task } from '../../src/domain/task/task';
import type { TestHarness } from '../support/test-context';

import { createTestHarness } from '../support/test-context';
import { CreateTaskUseCase } from '../../src/application/use-cases/task/task-commands';
import { unwrap } from '../../src/domain/shared/result';
import {
  AddSubtaskUseCase,
  ReorderSubtaskUseCase,
} from '../../src/application/use-cases/task/subtask-commands';

const NOW = new Date('2026-08-03T12:00:00.000Z');

/** Los titulos en el orden en que salen en pantalla. */
const order = (task: Task): string[] =>
  [...task.subtasks].sort((a, b) => a.position - b.position).map((subtask) => subtask.title);

describe('ReorderSubtaskUseCase', () => {
  let harness: TestHarness;
  let task: Task;

  beforeEach(async () => {
    harness = createTestHarness(NOW);
    task = unwrap(await new CreateTaskUseCase(harness.context).execute({ title: 'Entrega' }));

    const add = new AddSubtaskUseCase(harness.context);
    for (const title of ['A', 'B', 'C', 'D']) {
      task = unwrap(await add.execute({ taskId: task.id, title }));
    }
  });

  /**
   * Reproduce lo que hace la interfaz al pulsar subir o bajar: coloca la subtarea ENTRE
   * las dos vecinas del destino, que con indexacion fraccionaria obliga a mirar dos
   * puestos mas alla en el sentido del movimiento.
   */
  const move = async (title: string, direction: -1 | 1): Promise<Task> => {
    const current = [...task.subtasks].sort((a, b) => a.position - b.position);
    const index = current.findIndex((subtask) => subtask.title === title);

    const previous =
      direction === -1 ? (current[index - 2]?.id ?? null) : (current[index + 1]?.id ?? null);
    const next =
      direction === -1 ? (current[index - 1]?.id ?? null) : (current[index + 2]?.id ?? null);

    const subtask = current[index];
    if (subtask === undefined) throw new Error(`no existe la subtarea ${title}`);

    task = unwrap(
      await new ReorderSubtaskUseCase(harness.context).execute({
        taskId: task.id,
        subtaskId: subtask.id,
        previousSubtaskId: previous,
        nextSubtaskId: next,
      }),
    );

    return task;
  };

  it('empieza en el orden en que se añadieron', () => {
    expect(order(task)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('sube una subtarea un puesto', async () => {
    expect(order(await move('C', -1))).toEqual(['A', 'C', 'B', 'D']);
  });

  it('baja una subtarea un puesto', async () => {
    expect(order(await move('B', 1))).toEqual(['A', 'C', 'B', 'D']);
  });

  it('sube hasta la primera posicion', async () => {
    await move('D', -1);
    await move('D', -1);
    expect(order(await move('D', -1))).toEqual(['D', 'A', 'B', 'C']);
  });

  it('baja hasta la ultima posicion', async () => {
    await move('A', 1);
    await move('A', 1);
    expect(order(await move('A', 1))).toEqual(['B', 'C', 'D', 'A']);
  });

  it('subir y bajar deja todo como estaba', async () => {
    await move('C', -1);
    expect(order(await move('C', 1))).toEqual(['A', 'B', 'C', 'D']);
  });

  it('aguanta mover muchas veces entre las mismas vecinas, que es cuando se agota el hueco', async () => {
    // Cada ida y vuelta parte el hueco entre A y C por la mitad. Antes, al quedarse sin
    // espacio, se rebalanceaba por el orden ANTERIOR al movimiento y la subtarea se
    // quedaba donde estaba: la accion no hacia nada y no avisaba de nada.
    for (let i = 0; i < 60; i++) {
      await move('B', 1);
      await move('B', -1);
    }

    expect(order(task)).toEqual(['A', 'B', 'C', 'D']);

    // Y despues del rebalanceo el orden sigue siendo manipulable.
    expect(order(await move('B', 1))).toEqual(['A', 'C', 'B', 'D']);
  });

  it('no pierde ninguna subtarea por el camino', async () => {
    await move('A', 1);
    await move('D', -1);
    expect(task.subtasks).toHaveLength(4);
    expect([...order(task)].sort()).toEqual(['A', 'B', 'C', 'D']);
  });
});
