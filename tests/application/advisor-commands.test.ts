import { beforeEach, describe, expect, it } from 'vitest';

import type { AdvisorMessage } from '../../src/application/ports/services';
import type { AdvisorPlan } from '../../src/domain/assistant/advisor-plan';
import type { Task } from '../../src/domain/task/task';
import type { TaskId } from '../../src/domain/shared/branded';
import type { TestHarness } from '../support/test-context';

import {
  ApplyAdvisorPlanUseCase,
  AskAdvisorUseCase,
  resolvePostponeTarget,
} from '../../src/application/use-cases/assistant/advisor-commands';
import { createTestHarness, ScriptedAdvisorService } from '../support/test-context';
import { CreateTaskUseCase } from '../../src/application/use-cases/task/task-commands';
import { isErr, unwrap } from '../../src/domain/shared/result';

const NOW = new Date('2026-08-02T12:00:00.000Z');

const ask = (text: string): AdvisorMessage[] => [
  {
    id: 'm1',
    role: 'user',
    text,
    plan: null,
    planOutcome: 'pendiente',
    at: NOW.toISOString(),
  },
];

const drain = async (events: AsyncIterable<unknown>): Promise<unknown[]> => {
  const collected: unknown[] = [];
  for await (const event of events) collected.push(event);
  return collected;
};

describe('AskAdvisorUseCase', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = createTestHarness(NOW);
    await new CreateTaskUseCase(harness.context).execute({
      title: 'Llamar al banco',
      dueAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
    });
  });

  it('manda el estado del dia junto con la conversacion', async () => {
    const result = await new AskAdvisorUseCase(harness.context).execute({
      messages: ask('¿Que hago?'),
    });

    const stream = unwrap(result);
    expect(stream.brief.tareas.map((t) => t.titulo)).toEqual(['Llamar al banco']);

    await drain(stream.events);

    // El puerto recibio el resumen construido por el caso de uso, no uno de la interfaz.
    expect(harness.advisor.turns).toHaveLength(1);
    expect(harness.advisor.turns[0]?.brief.tareas).toHaveLength(1);
    expect(harness.advisor.turns[0]?.messages[0]?.text).toBe('¿Que hago?');
  });

  it('reenvia los eventos del asistente tal cual', async () => {
    harness.advisor.setScript([
      { type: 'text', text: 'Empieza por ' },
      { type: 'text', text: 'el banco.' },
      { type: 'done' },
    ]);

    const stream = unwrap(
      await new AskAdvisorUseCase(harness.context).execute({ messages: ask('¿Y ahora?') }),
    );

    expect(await drain(stream.events)).toEqual([
      { type: 'text', text: 'Empieza por ' },
      { type: 'text', text: 'el banco.' },
      { type: 'done' },
    ]);
  });

  it('falla sin llamar al modelo cuando no hay nada pendiente', async () => {
    const empty = createTestHarness(NOW);

    const result = await new AskAdvisorUseCase(empty.context).execute({ messages: ask('hola') });

    expect(isErr(result)).toBe(true);
    expect(empty.advisor.turns).toHaveLength(0);
  });

  it('falla cuando el asistente no esta disponible', async () => {
    const offline = createTestHarness(NOW);
    Object.assign(offline.context, { advisor: new ScriptedAdvisorService([], false) });

    const result = await new AskAdvisorUseCase(offline.context).execute({ messages: ask('hola') });

    expect(isErr(result)).toBe(true);
  });
});

describe('ApplyAdvisorPlanUseCase', () => {
  let harness: TestHarness;
  let uno: Task;
  let dos: Task;
  let tres: Task;

  beforeEach(async () => {
    harness = createTestHarness(NOW);
    const create = new CreateTaskUseCase(harness.context);

    uno = unwrap(await create.execute({ title: 'Uno' }));
    dos = unwrap(await create.execute({ title: 'Dos' }));
    tres = unwrap(await create.execute({ title: 'Tres' }));
  });

  const plan = (overrides: Partial<AdvisorPlan> = {}): AdvisorPlan => ({
    resumen: 'Da igual el orden en que las creaste.',
    pasos: [],
    ajustes: [],
    descartadas: 0,
    ...overrides,
  });

  const step = (taskId: TaskId) => ({ taskId, minutos: 15, porque: 'porque si' });

  const positionOf = (id: TaskId) => harness.tasks.items.get(id)?.position ?? 0;

  it('deja las tareas del plan en el orden propuesto y por delante del resto', async () => {
    const result = await new ApplyAdvisorPlanUseCase(harness.context).execute({
      plan: plan({ pasos: [step(tres.id), step(uno.id)] }),
    });

    expect(unwrap(result).reordenadas).toBe(2);
    expect(positionOf(tres.id)).toBeLessThan(positionOf(uno.id));
    expect(positionOf(uno.id)).toBeLessThan(positionOf(dos.id));
  });

  it('aplica los ajustes de prioridad y de destacada', async () => {
    const result = await new ApplyAdvisorPlanUseCase(harness.context).execute({
      plan: plan({
        pasos: [step(uno.id)],
        ajustes: [
          { kind: 'prioridad', taskId: uno.id, prioridad: 'high' },
          { kind: 'destacar', taskId: dos.id, destacada: true },
        ],
      }),
    });

    expect(unwrap(result).ajustadas).toBe(2);
    expect(harness.tasks.items.get(uno.id)?.priority).toBe('high');
    expect(harness.tasks.items.get(dos.id)?.isImportant).toBe(true);
  });

  it('pospone y deja esa tarea fuera del orden aunque el plan la nombrara', async () => {
    const result = await new ApplyAdvisorPlanUseCase(harness.context).execute({
      plan: plan({
        pasos: [step(uno.id), step(dos.id)],
        ajustes: [{ kind: 'posponer', taskId: dos.id, hasta: 'manana' }],
      }),
    });

    const applied = unwrap(result);
    expect(applied.reordenadas).toBe(1);
    expect(applied.omitidas).toBe(1);

    const postponed = harness.tasks.items.get(dos.id);
    expect(postponed?.dueAt).toBe(resolvePostponeTarget('manana', NOW));
    expect(postponed?.snoozeCount).toBe(1);
  });

  it('cuenta como omitida la tarea que se completo entre la propuesta y el aplicar', async () => {
    await harness.tasks.save({ ...dos, status: 'completed', completedAt: NOW.toISOString() });

    const result = await new ApplyAdvisorPlanUseCase(harness.context).execute({
      plan: plan({ pasos: [step(uno.id), step(dos.id)] }),
    });

    const applied = unwrap(result);
    expect(applied.reordenadas).toBe(1);
    expect(applied.omitidas).toBe(1);
  });

  it('un ajuste que no se puede aplicar no tumba el resto del plan', async () => {
    const fantasma = 'no-existe' as TaskId;

    const result = await new ApplyAdvisorPlanUseCase(harness.context).execute({
      plan: plan({
        pasos: [step(uno.id)],
        ajustes: [
          { kind: 'prioridad', taskId: fantasma, prioridad: 'high' },
          { kind: 'prioridad', taskId: uno.id, prioridad: 'low' },
        ],
      }),
    });

    const applied = unwrap(result);
    expect(applied.ajustadas).toBe(1);
    expect(applied.omitidas).toBe(1);
    expect(applied.reordenadas).toBe(1);
    expect(harness.tasks.items.get(uno.id)?.priority).toBe('low');
  });

  it('no toca nada cuando el plan solo trae pasos imposibles', async () => {
    const before = positionOf(uno.id);

    const result = await new ApplyAdvisorPlanUseCase(harness.context).execute({
      plan: plan({ pasos: [step('fantasma' as TaskId)] }),
    });

    expect(unwrap(result).reordenadas).toBe(0);
    expect(positionOf(uno.id)).toBe(before);
  });
});
