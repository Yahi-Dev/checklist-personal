import { beforeEach, describe, expect, it } from 'vitest';

import type { Subject } from '../../src/domain/schedule/subject';
import type { TestHarness } from '../support/test-context';

import { createTestHarness } from '../support/test-context';
import {
  CreateSubjectUseCase,
  DeleteSubjectUseCase,
} from '../../src/application/use-cases/schedule/schedule-commands';
import { CreateTaskUseCase } from '../../src/application/use-cases/task/task-commands';
import { isErr, unwrap } from '../../src/domain/shared/result';
import {
  CreateSubjectNoteUseCase,
  DeleteSubjectNoteUseCase,
  ToggleSubjectNotePinnedUseCase,
  UpdateSubjectNoteUseCase,
} from '../../src/application/use-cases/schedule/subject-note-commands';

/**
 * Las notas de una materia, y sobre todo QUE SE LLEVA POR DELANTE borrar la asignatura.
 *
 * Ese reparto es una decision de diseño, no un detalle: las notas son DE la materia y se
 * van con ella; las tareas son TUYAS y se quedan. Quitar una asignatura del horario no
 * puede borrarte trabajo.
 */

describe('notas de una materia', () => {
  let harness: TestHarness;
  let subject: Subject;

  beforeEach(async () => {
    harness = createTestHarness();
    subject = unwrap(
      await new CreateSubjectUseCase(harness.context).execute({
        code: 'TI3210',
        name: 'Logica Matematica',
        termCode: '2027-1',
        section: '01',
      }),
    );
  });

  const crearNota = (body: string, kind?: 'exam' | 'assignment' | 'notice' | 'note') =>
    new CreateSubjectNoteUseCase(harness.context).execute({
      subjectId: subject.id,
      body,
      ...(kind === undefined ? {} : { kind }),
    });

  it('crea la nota enlazada a su materia', async () => {
    const note = unwrap(await crearNota('El parcial cubre hasta el capitulo 4', 'exam'));

    expect(note.subjectId).toBe(subject.id);
    expect(note.kind).toBe('exam');
    expect(harness.subjectNotes.items.size).toBe(1);
  });

  it('exige sesion', async () => {
    const sinSesion = createTestHarness(new Date('2026-09-13T12:00:00.000Z'), null);

    const result = await new CreateSubjectNoteUseCase(sinSesion.context).execute({
      subjectId: subject.id,
      body: 'algo',
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('UNAUTHENTICATED');
  });

  it('no deja colgar una nota de una materia que no existe', async () => {
    const result = await new CreateSubjectNoteUseCase(harness.context).execute({
      subjectId: '00000000-0000-4000-8000-999999999999' as never,
      body: 'huerfana',
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('cambia el tipo sin tocar el texto', async () => {
    const note = unwrap(await crearNota('Trae calculadora'));

    const updated = unwrap(
      await new UpdateSubjectNoteUseCase(harness.context).execute({
        noteId: note.id,
        kind: 'notice',
      }),
    );

    expect(updated.kind).toBe('notice');
    expect(updated.body).toBe('Trae calculadora');
    expect(updated.createdAt).toBe(note.createdAt);
  });

  it('destaca y deja de destacar con el mismo comando', async () => {
    const note = unwrap(await crearNota('Importante'));
    const toggle = new ToggleSubjectNotePinnedUseCase(harness.context);

    expect(unwrap(await toggle.execute({ noteId: note.id })).isPinned).toBe(true);
    expect(unwrap(await toggle.execute({ noteId: note.id })).isPinned).toBe(false);
  });

  it('borra en logico, nunca en fisico', async () => {
    // El borrado tiene que viajar al otro dispositivo: un `hardDelete` local haria que el
    // telefono volviera a subir la fila que el escritorio acaba de quitar.
    const note = unwrap(await crearNota('Se borra'));

    unwrap(await new DeleteSubjectNoteUseCase(harness.context).execute({ noteId: note.id }));

    expect(harness.subjectNotes.items.get(note.id)?.deletedAt).not.toBeNull();
  });

  it('las devuelve ordenadas para leer', async () => {
    await crearNota('Un apunte cualquiera', 'note');
    const examen = unwrap(await crearNota('Entra el capitulo 4', 'exam'));

    const todas = unwrap(await harness.context.subjectNotes.findAll({ subjectId: subject.id }));

    expect(todas[0]?.id).toBe(examen.id);
  });
});

describe('al quitar la asignatura', () => {
  let harness: TestHarness;
  let subject: Subject;

  beforeEach(async () => {
    harness = createTestHarness();
    subject = unwrap(
      await new CreateSubjectUseCase(harness.context).execute({
        code: 'EGC252',
        name: 'Calculo Vectorial',
        termCode: '2027-1',
      }),
    );
  });

  it('sus notas se van con ella', async () => {
    const note = unwrap(
      await new CreateSubjectNoteUseCase(harness.context).execute({
        subjectId: subject.id,
        body: 'Algo de Calculo',
      }),
    );

    unwrap(await new DeleteSubjectUseCase(harness.context).execute({ subjectId: subject.id }));

    expect(harness.subjectNotes.items.get(note.id)?.deletedAt).not.toBeNull();
  });

  it('pero sus TAREAS se quedan', async () => {
    // Es la decision que mas conviene no equivocarse: una tarea es tuya, no de la materia.
    // Quitar una asignatura del horario no puede borrarte trabajo.
    const task = unwrap(
      await new CreateTaskUseCase(harness.context).execute({
        title: 'Entregar el informe',
        subjectId: subject.id,
      }),
    );

    unwrap(await new DeleteSubjectUseCase(harness.context).execute({ subjectId: subject.id }));

    const guardada = harness.tasks.items.get(task.id);
    expect(guardada?.deletedAt).toBeNull();
    expect(guardada?.status).toBe('pending');
  });
});

describe('la tarea sabe de que materia es', () => {
  it('nace sin materia si no se dice', async () => {
    const harness = createTestHarness();

    const task = unwrap(
      await new CreateTaskUseCase(harness.context).execute({ title: 'Comprar pan' }),
    );

    expect(task.subjectId).toBeNull();
  });

  it('y con ella cuando se pide', async () => {
    const harness = createTestHarness();
    const subject = unwrap(
      await new CreateSubjectUseCase(harness.context).execute({
        code: 'TI3210',
        name: 'Logica',
        termCode: '2027-1',
      }),
    );

    const task = unwrap(
      await new CreateTaskUseCase(harness.context).execute({
        title: 'Ejercicios del 3',
        subjectId: subject.id,
      }),
    );

    expect(task.subjectId).toBe(subject.id);
  });
});
