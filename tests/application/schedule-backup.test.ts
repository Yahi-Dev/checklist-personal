import { beforeEach, describe, expect, it } from 'vitest';

import type { TestHarness } from '../support/test-context';

import { createTestHarness } from '../support/test-context';
import { HORARIO_2027_1 } from '../support/unibe-schedule-fixture';
import { ImportSchedulePdfUseCase } from '../../src/application/use-cases/schedule/import-schedule-pdf';
import { CreateSubjectNoteUseCase } from '../../src/application/use-cases/schedule/subject-note-commands';
import { CreateTaskUseCase } from '../../src/application/use-cases/task/task-commands';
import { isErr, unwrap } from '../../src/domain/shared/result';
import {
  ExportBackupUseCase,
  ImportBackupUseCase,
} from '../../src/application/use-cases/backup/backup-commands';

/**
 * El horario tiene que viajar en los respaldos.
 *
 * Es la clase de olvido que no avisa: el esquema del respaldo declara las dos listas
 * nuevas con `.default([])` -para que un archivo viejo siga siendo valido-, asi que si
 * el exportador no las escribiera, el archivo seguiria validando y el horario
 * desapareceria sin que nada fallara. Solo se nota el dia que alguien restaura.
 */

const BYTES = new Uint8Array([1, 2, 3]);

describe('el horario en los respaldos', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = createTestHarness();
    harness.pdf.setItems(HORARIO_2027_1);
    await new ImportSchedulePdfUseCase(harness.context).execute({ bytes: BYTES });
  });

  it('se exporta con las asignaturas y sus clases', async () => {
    const backup = unwrap(await new ExportBackupUseCase(harness.context).execute());

    expect(backup.counts.subjects).toBe(6);
    expect(backup.counts.scheduleBlocks).toBe(8);

    const parsed = JSON.parse(backup.contents) as {
      data: { subjects: unknown[]; scheduleBlocks: unknown[] };
    };
    expect(parsed.data.subjects).toHaveLength(6);
    expect(parsed.data.scheduleBlocks).toHaveLength(8);
  });

  it('vuelve entero al restaurarlo en un dispositivo vacio', async () => {
    const backup = unwrap(await new ExportBackupUseCase(harness.context).execute());

    const limpio = createTestHarness();
    const result = unwrap(
      await new ImportBackupUseCase(limpio.context).execute({ contents: backup.contents }),
    );

    expect(result.imported.subjects).toBe(6);
    expect(result.imported.scheduleBlocks).toBe(8);
    expect(limpio.subjects.items.size).toBe(6);
    expect(limpio.scheduleBlocks.items.size).toBe(8);

    const logica = [...limpio.subjects.items.values()].find((item) => item.code === 'TI3210');
    expect(logica?.name).toBe('LÓGICA MATEMÁTICA');
    expect(logica?.termCode).toBe('2027-1');
  });

  it('lleva las notas, la atencion y la materia de cada tarea', async () => {
    const logica = [...harness.subjects.items.values()].find((item) => item.code === 'TI3210');
    if (logica === undefined) throw new Error('falta TI3210');

    await harness.subjects.save({ ...logica, attention: 'critical' });
    await new CreateSubjectNoteUseCase(harness.context).execute({
      subjectId: logica.id,
      body: 'Entra hasta el capitulo 4',
      kind: 'exam',
    });
    await new CreateTaskUseCase(harness.context).execute({
      title: 'Ejercicios del 3',
      subjectId: logica.id,
    });

    const backup = unwrap(await new ExportBackupUseCase(harness.context).execute());
    expect(backup.counts.subjectNotes).toBe(1);

    const limpio = createTestHarness();
    unwrap(await new ImportBackupUseCase(limpio.context).execute({ contents: backup.contents }));

    const restaurada = [...limpio.subjects.items.values()].find((item) => item.code === 'TI3210');
    expect(restaurada?.attention).toBe('critical');
    expect(limpio.subjectNotes.items.size).toBe(1);

    const tarea = [...limpio.tasks.items.values()][0];
    expect(tarea?.subjectId).toBe(logica.id);
  });

  it('un respaldo de antes del horario sigue siendo valido', async () => {
    // El `.default([])` del esquema es lo que lo permite. Sin el, nadie podria restaurar
    // sus tareas por culpa de una funcion que cuando hizo la copia no existia.
    const antiguo = JSON.stringify({
      format: 'checklist-personal-backup',
      version: 1,
      exportedAt: '2026-08-02T12:00:00.000Z',
      data: { tasks: [], categories: [], tags: [] },
    });

    const limpio = createTestHarness();
    const result = await new ImportBackupUseCase(limpio.context).execute({ contents: antiguo });

    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.value.imported.subjects).toBe(0);
      expect(result.value.imported.scheduleBlocks).toBe(0);
      expect(result.value.imported.subjectNotes).toBe(0);
    }
  });

  it('reasigna el dueño al restaurar con otra cuenta', async () => {
    // Sin esto, cada fila restaurada conserva el userId del archivo y las politicas de
    // seguridad de Supabase la rechazan una por una, para siempre.
    const backup = unwrap(await new ExportBackupUseCase(harness.context).execute());

    const otro = createTestHarness(new Date('2026-08-02T12:00:00.000Z'), {
      id: harness.context.currentUser()?.id ?? ('x' as never),
      email: 'otro@ejemplo.com',
      displayName: 'Otro',
    });

    await new ImportBackupUseCase(otro.context).execute({ contents: backup.contents });

    const dueños = new Set([...otro.subjects.items.values()].map((item) => item.userId));
    expect(dueños.size).toBe(1);
    expect([...dueños][0]).toBe(otro.context.currentUser()?.id);
  });
});
