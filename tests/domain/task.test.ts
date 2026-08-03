import { describe, expect, it } from 'vitest';

import type { SubtaskId, TaskId, UserId } from '../../src/domain/shared/branded';

import { brandId } from '../../src/domain/shared/branded';
import { createSubtask, subtaskProgress, toggleSubtask } from '../../src/domain/task/subtask';
import {
  createTaskTitle,
  normalizeForSearch,
} from '../../src/domain/task/value-objects/task-title';
import { defaultRecurrenceRule } from '../../src/domain/recurrence/recurrence-rule';
import { isErr, isOk, unwrap } from '../../src/domain/shared/result';
import {
  attachSubtask,
  completeTask,
  createTask,
  isOverdue,
  snoozeTask,
  softDeleteTask,
  taskProgress,
  uncompleteTask,
  updateTask,
} from '../../src/domain/task/task';

const USER_ID = brandId<UserId>('00000000-0000-4000-8000-000000000001');
const TASK_ID = brandId<TaskId>('00000000-0000-4000-8000-000000000002');
const NOW = '2026-08-02T12:00:00.000Z';

let idCounter = 0;
const nextTaskId = () =>
  brandId<TaskId>(`00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`);
const nextSubtaskId = () =>
  brandId<SubtaskId>(`00000000-0000-4000-9000-${String(++idCounter).padStart(12, '0')}`);

const baseTask = (overrides: Partial<Parameters<typeof createTask>[0]> = {}) =>
  unwrap(
    createTask({
      id: TASK_ID,
      userId: USER_ID,
      title: 'Sacar la basura',
      now: NOW,
      ...overrides,
    }),
  );

describe('titulo de la tarea', () => {
  it('colapsa los espacios internos', () => {
    expect(unwrap(createTaskTitle('  Comprar   pan \n del dia  '))).toBe('Comprar pan del dia');
  });

  it('rechaza un titulo vacio o solo con espacios', () => {
    expect(isErr(createTaskTitle(''))).toBe(true);
    expect(isErr(createTaskTitle('    \n\t  '))).toBe(true);
  });

  it('rechaza titulos demasiado largos', () => {
    expect(isErr(createTaskTitle('a'.repeat(501)))).toBe(true);
  });

  it('normaliza acentos y mayusculas para buscar', () => {
    expect(normalizeForSearch('Acción Rápida')).toBe('accion rapida');
  });
});

describe('creacion', () => {
  it('crea una tarea pendiente con valores por defecto sensatos', () => {
    const task = baseTask();

    expect(task.status).toBe('pending');
    expect(task.priority).toBe('medium');
    expect(task.isImportant).toBe(false);
    expect(task.deletedAt).toBeNull();
    expect(task.completedAt).toBeNull();
    expect(task.snoozeCount).toBe(0);
  });

  it('rechaza un recordatorio posterior al vencimiento', () => {
    const result = createTask({
      id: TASK_ID,
      userId: USER_ID,
      title: 'Reunion',
      now: NOW,
      dueAt: '2026-08-02T15:00:00.000Z',
      reminderAt: '2026-08-02T16:00:00.000Z',
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe('reminderAt');
  });

  it('rechaza una repeticion sin fecha de vencimiento', () => {
    // Una regla de repeticion no tiene desde donde contar sin fecha de partida.
    const result = createTask({
      id: TASK_ID,
      userId: USER_ID,
      title: 'Regar plantas',
      now: NOW,
      recurrence: defaultRecurrenceRule({ frequency: 'daily' }),
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe('dueAt');
  });

  it('deduplica las etiquetas', () => {
    const tagId = brandId<TaskId>('00000000-0000-4000-8000-00000000000a');
    const task = baseTask({ tagIds: [tagId, tagId] as never });

    expect(task.tagIds).toHaveLength(1);
  });
});

describe('completar', () => {
  it('marca la tarea y guarda el instante', () => {
    const result = completeTask(baseTask(), { now: NOW, nextTaskId, nextSubtaskId });

    expect(isOk(result)).toBe(true);
    const { completed, next } = unwrap(result);

    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBe(NOW);
    expect(next).toBeNull();
  });

  it('no deja completar una tarea borrada', () => {
    const deleted = softDeleteTask(baseTask(), NOW);
    const result = completeTask(deleted, { now: NOW, nextTaskId, nextSubtaskId });

    expect(isErr(result)).toBe(true);
  });

  it('genera la siguiente ocurrencia de una tarea recurrente', () => {
    const task = baseTask({
      dueAt: '2026-08-02T13:00:00.000Z',
      recurrence: defaultRecurrenceRule({ frequency: 'daily', interval: 1 }),
    });

    const { completed, next } = unwrap(completeTask(task, { now: NOW, nextTaskId, nextSubtaskId }));

    expect(completed.status).toBe('completed');
    expect(next).not.toBeNull();
    expect(next?.status).toBe('pending');
    expect(next?.id).not.toBe(task.id);
    // La serie apunta a la primera instancia.
    expect(next?.seriesId).toBe(task.id);
    expect(Date.parse(next?.dueAt ?? '')).toBeGreaterThan(Date.parse(task.dueAt ?? ''));
  });

  it('corta la regla en la instancia completada para no duplicar al deshacer', () => {
    // Sin esto, marcar y desmarcar tres veces crearia tres copias futuras.
    const task = baseTask({
      dueAt: '2026-08-02T13:00:00.000Z',
      recurrence: defaultRecurrenceRule({ frequency: 'daily' }),
    });

    const { completed } = unwrap(completeTask(task, { now: NOW, nextTaskId, nextSubtaskId }));
    expect(completed.recurrence).toBeNull();

    const reopened = unwrap(uncompleteTask(completed, NOW));
    const second = unwrap(completeTask(reopened, { now: NOW, nextTaskId, nextSubtaskId }));

    expect(second.next).toBeNull();
  });

  it('reinicia las subtareas y no copia los adjuntos en la nueva ocurrencia', () => {
    let task = baseTask({
      dueAt: '2026-08-02T13:00:00.000Z',
      recurrence: defaultRecurrenceRule({ frequency: 'daily' }),
    });

    const subtask = unwrap(
      createSubtask({
        id: nextSubtaskId(),
        taskId: task.id,
        title: 'Paso 1',
        position: 1,
        now: NOW,
      }),
    );
    task = unwrap(attachSubtask(task, toggleSubtask(subtask, NOW), NOW));

    expect(task.subtasks[0]?.isDone).toBe(true);

    const { next } = unwrap(completeTask(task, { now: NOW, nextTaskId, nextSubtaskId }));

    expect(next?.subtasks).toHaveLength(1);
    expect(next?.subtasks[0]?.isDone).toBe(false);
    expect(next?.subtasks[0]?.id).not.toBe(task.subtasks[0]?.id);
    expect(next?.attachments).toHaveLength(0);
  });

  it('con fromCompletion cuenta desde el momento de completar, no desde la fecha', () => {
    // Vencia hace tres dias pero se completa hoy: la siguiente sale de hoy.
    const task = baseTask({
      dueAt: '2026-07-30T13:00:00.000Z',
      recurrence: defaultRecurrenceRule({
        frequency: 'daily',
        interval: 3,
        fromCompletion: true,
      }),
    });

    const { next } = unwrap(completeTask(task, { now: NOW, nextTaskId, nextSubtaskId }));

    expect(Date.parse(next?.dueAt ?? '')).toBeGreaterThan(Date.parse(NOW));
  });

  it('conserva la antelacion del recordatorio en la nueva ocurrencia', () => {
    const task = baseTask({
      dueAt: '2026-08-02T13:00:00.000Z',
      reminderAt: '2026-08-02T12:30:00.000Z', // 30 minutos antes
      recurrence: defaultRecurrenceRule({ frequency: 'daily' }),
    });

    const { next } = unwrap(completeTask(task, { now: NOW, nextTaskId, nextSubtaskId }));

    const lead = (Date.parse(next?.dueAt ?? '') - Date.parse(next?.reminderAt ?? '')) / 60_000;
    expect(lead).toBe(30);
  });
});

describe('posponer', () => {
  it('mueve la fecha y suma al contador', () => {
    const task = baseTask({ dueAt: '2026-08-02T13:00:00.000Z' });
    const later = '2026-08-03T09:00:00.000Z';

    const snoozed = unwrap(snoozeTask(task, later, NOW));

    expect(snoozed.dueAt).toBe(later);
    expect(snoozed.snoozeCount).toBe(1);
  });

  it('arrastra el recordatorio manteniendo la antelacion', () => {
    const task = baseTask({
      dueAt: '2026-08-02T13:00:00.000Z',
      reminderAt: '2026-08-02T12:45:00.000Z', // 15 minutos antes
    });

    const snoozed = unwrap(snoozeTask(task, '2026-08-03T13:00:00.000Z', NOW));

    expect(snoozed.reminderAt).toBe('2026-08-03T12:45:00.000Z');
  });

  it('rechaza posponer al pasado', () => {
    const result = snoozeTask(baseTask(), '2026-08-01T12:00:00.000Z', NOW);
    expect(isErr(result)).toBe(true);
  });
});

describe('consultas derivadas', () => {
  it('detecta las tareas vencidas', () => {
    const overdue = baseTask({ dueAt: '2026-08-01T12:00:00.000Z' });
    const future = baseTask({ dueAt: '2026-08-03T12:00:00.000Z' });

    expect(isOverdue(overdue, NOW)).toBe(true);
    expect(isOverdue(future, NOW)).toBe(false);
  });

  it('una tarea completada nunca esta vencida', () => {
    const task = baseTask({ dueAt: '2026-08-01T12:00:00.000Z' });
    const { completed } = unwrap(completeTask(task, { now: NOW, nextTaskId, nextSubtaskId }));

    expect(isOverdue(completed, NOW)).toBe(false);
  });

  it('el progreso sale de las subtareas cuando las hay', () => {
    let task = baseTask();

    for (let index = 0; index < 4; index += 1) {
      const subtask = unwrap(
        createSubtask({
          id: nextSubtaskId(),
          taskId: task.id,
          title: `Paso ${index}`,
          position: index,
          now: NOW,
        }),
      );
      task = unwrap(attachSubtask(task, index < 2 ? toggleSubtask(subtask, NOW) : subtask, NOW));
    }

    expect(subtaskProgress(task.subtasks)).toBe(0.5);
    expect(taskProgress(task)).toBe(0.5);
  });
});

describe('actualizacion', () => {
  it('solo cambia lo indicado', () => {
    const task = baseTask({ notes: 'nota original' });
    const updated = unwrap(updateTask(task, { priority: 'high' }, '2026-08-02T13:00:00.000Z'));

    expect(updated.priority).toBe('high');
    expect(updated.title).toBe(task.title);
    expect(updated.notes).toBe('nota original');
    expect(updated.updatedAt).not.toBe(task.updatedAt);
  });

  it('permite quitar la fecha pasando null explicitamente', () => {
    const task = baseTask({ dueAt: '2026-08-02T13:00:00.000Z' });
    const updated = unwrap(updateTask(task, { dueAt: null, reminderAt: null }, NOW));

    expect(updated.dueAt).toBeNull();
  });

  it('no muta el objeto original', () => {
    const task = baseTask();
    updateTask(task, { title: 'Otro titulo' }, NOW);

    expect(task.title).toBe('Sacar la basura');
  });
});
