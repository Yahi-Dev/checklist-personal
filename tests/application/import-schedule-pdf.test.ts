import { beforeEach, describe, expect, it } from 'vitest';

import type { TestHarness } from '../support/test-context';

import { createTestHarness } from '../support/test-context';
import { HORARIO_2026_3, HORARIO_2027_1 } from '../support/unibe-schedule-fixture';
import { ImportSchedulePdfUseCase } from '../../src/application/use-cases/schedule/import-schedule-pdf';
import { isErr, unwrap } from '../../src/domain/shared/result';

/**
 * Importar el horario de un cuatrimestre.
 *
 * Lo que de verdad se prueba aqui es la RECONCILIACION. Los ids son UUID que genera el
 * cliente, asi que soltar dos veces el mismo PDF -algo que se hace en cuanto te cambian
 * un aula- duplicaria el horario entero si no se casara por clave natural. Es un fallo
 * que no da ningun error: simplemente aparece todo dos veces.
 */

const BYTES = new Uint8Array([1, 2, 3]);

describe('ImportSchedulePdfUseCase', () => {
  let harness: TestHarness;

  const importar = async (bytes = BYTES) =>
    new ImportSchedulePdfUseCase(harness.context).execute({ bytes });

  beforeEach(() => {
    harness = createTestHarness();
    harness.pdf.setItems(HORARIO_2027_1);
  });

  it('crea las asignaturas y sus clases en la misma operacion', async () => {
    const summary = unwrap(await importar());

    expect(summary.termCode).toBe('2027-1');
    expect(summary.createdSubjects).toBe(6);
    expect(summary.createdBlocks).toBe(8);
    expect(harness.subjects.items.size).toBe(6);
    expect(harness.scheduleBlocks.items.size).toBe(8);
  });

  it('exige sesion', async () => {
    const sinSesion = createTestHarness(new Date('2026-08-02T12:00:00.000Z'), null);
    sinSesion.pdf.setItems(HORARIO_2027_1);

    const result = await new ImportSchedulePdfUseCase(sinSesion.context).execute({ bytes: BYTES });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('UNAUTHENTICATED');
  });

  it('importar dos veces el mismo PDF no duplica nada', async () => {
    await importar();
    const segunda = unwrap(await importar());

    expect(segunda.createdSubjects).toBe(0);
    expect(segunda.updatedSubjects).toBe(6);
    expect(segunda.removedSubjects).toBe(0);
    expect(segunda.createdBlocks).toBe(0);
    expect(harness.subjects.items.size).toBe(6);
    expect(harness.scheduleBlocks.items.size).toBe(8);
  });

  it('conserva el id y el color de una asignatura que ya existia', async () => {
    await importar();

    const antes = [...harness.subjects.items.values()].find((item) => item.code === 'TI3210');
    if (antes === undefined) throw new Error('falta TI3210');

    // El usuario le cambia el color a mano.
    await harness.subjects.save({ ...antes, color: '#22c55e' });

    await importar();

    const despues = [...harness.subjects.items.values()].find((item) => item.code === 'TI3210');

    expect(despues?.id).toBe(antes.id);
    expect(despues?.color).toBe('#22c55e');
  });

  it('conserva el nivel de atencion al reimportar', async () => {
    // Misma razon que el color: la atencion no viene en el documento, asi que reimportar
    // no puede tocarla. Es lo que hace util marcar una materia como critica en la semana
    // 3 y que siga marcada en la 12.
    await importar();

    const antes = [...harness.subjects.items.values()].find((item) => item.code === 'EGC270');
    if (antes === undefined) throw new Error('falta EGC270');
    expect(antes.attention).toBe('normal');

    await harness.subjects.save({ ...antes, attention: 'critical' });
    await importar();

    const despues = harness.subjects.items.get(antes.id);
    expect(despues?.attention).toBe('critical');
    // Y lo que SI viene en el documento se sigue actualizando.
    expect(despues?.name).toBe('FÍSICA GENERAL II');
  });

  it('actualiza el aula sin perder el id de la clase', async () => {
    // Un cambio de aula tiene que leerse como edicion del mismo tramo. Si se borrara y
    // se creara otro, cada cambio de aula gastaria un id nuevo y la cola de salida
    // acumularia lapidas de algo que sigue existiendo.
    await importar();

    const logica = [...harness.subjects.items.values()].find((item) => item.code === 'TI3210');
    const lunes = [...harness.scheduleBlocks.items.values()].find(
      (block) => block.subjectId === logica?.id && block.weekday === 1,
    );
    if (lunes === undefined) throw new Error('falta el lunes de TI3210');

    await harness.scheduleBlocks.save({ ...lunes, locationLabel: 'FR9-999' });
    await importar();

    const despues = harness.scheduleBlocks.items.get(lunes.id);

    expect(despues?.locationLabel).toBe('FR1-411');
    expect(despues?.deletedAt).toBeNull();
  });

  it('da de baja en logico lo que ya no viene en el documento', async () => {
    await importar();

    const total = harness.subjects.items.size;

    // El cuatrimestre siguiente trae otras asignaturas. Se simula reimportando el mismo
    // codigo de cuatrimestre con el contenido de otro.
    harness.pdf.setItems(
      HORARIO_2026_3.map((item) =>
        item.text === 'Semestre: 2026-3' ? { ...item, text: 'Semestre: 2027-1' } : item,
      ),
    );

    const summary = unwrap(await importar());

    expect(summary.removedSubjects).toBe(total);
    expect(summary.createdSubjects).toBe(5);

    // Nada se borra fisicamente: el borrado tiene que viajar al otro dispositivo.
    const bajas = [...harness.subjects.items.values()].filter((item) => item.deletedAt !== null);
    expect(bajas).toHaveLength(total);

    const clasesVivas = [...harness.scheduleBlocks.items.values()].filter(
      (block) => block.deletedAt === null,
    );
    expect(clasesVivas).toHaveLength(summary.createdBlocks);
  });

  it('no toca las asignaturas de otro cuatrimestre', async () => {
    await importar();

    harness.pdf.setItems(HORARIO_2026_3);
    const summary = unwrap(await importar());

    expect(summary.termCode).toBe('2026-3');
    expect(summary.removedSubjects).toBe(0);

    // Los dos cuatrimestres conviven.
    const vivas = [...harness.subjects.items.values()].filter((item) => item.deletedAt === null);
    expect(new Set(vivas.map((item) => item.termCode))).toEqual(new Set(['2027-1', '2026-3']));
  });

  it('no escribe nada en modo vista previa', async () => {
    const summary = unwrap(
      await new ImportSchedulePdfUseCase(harness.context).execute({
        bytes: BYTES,
        dryRun: true,
      }),
    );

    expect(summary.createdSubjects).toBe(6);
    expect(harness.subjects.items.size).toBe(0);
    expect(harness.scheduleBlocks.items.size).toBe(0);
  });

  it('rechaza un PDF que no sea el horario, sin escribir', async () => {
    harness.pdf.setItems([{ text: 'FACTURA', page: 1, x: 100, y: 700, width: 40, height: 10 }]);

    const result = await importar();

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('VALIDATION');
    expect(harness.subjects.items.size).toBe(0);
  });

  it('propaga el error del extractor sin envolverlo', async () => {
    harness.pdf.failWith = 'El PDF esta protegido con clave.';

    const result = await importar();

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('INFRASTRUCTURE');
      expect(result.error.message).toBe('El PDF esta protegido con clave.');
    }
  });

  it('guarda las asignaturas antes que sus clases', async () => {
    // En el servidor hay una clave foranea y la cola de salida reproduce las
    // operaciones en el orden en que se encolaron: al reves, el primer tramo llegaria
    // antes que su asignatura y el servidor devolveria 23503.
    const orden: string[] = [];

    const subjects = harness.subjects;
    const blocks = harness.scheduleBlocks;
    const saveSubjects = subjects.saveMany.bind(subjects);
    const saveBlocks = blocks.saveMany.bind(blocks);

    subjects.saveMany = async (items) => {
      orden.push('asignaturas');
      return saveSubjects(items);
    };
    blocks.saveMany = async (items) => {
      orden.push('clases');
      return saveBlocks(items);
    };

    await importar();

    expect(orden).toEqual(['asignaturas', 'clases']);
  });

  it('una asignatura invalida no tumba la importacion entera', async () => {
    // Misma regla que el parser: lo que no se puede guardar se anota y se sigue. Antes,
    // un solo nombre demasiado largo devolvia error y no se escribia ni una fila.
    const nombreImposible = 'X'.repeat(200);
    harness.pdf.setItems(
      HORARIO_2027_1.map((item) =>
        item.text === 'CÁLCULO VECTORIAL' ? { ...item, text: nombreImposible } : item,
      ),
    );

    const summary = unwrap(await importar());

    expect(summary.createdSubjects).toBe(5);
    expect(summary.warnings.join(' ')).toMatch(/EGC252/u);
    expect(harness.subjects.items.size).toBe(5);
  });

  it('la asignatura que fallo no se da de baja al reimportar', async () => {
    // Se marca vista antes de intentar guardarla: un tropiezo leyendo el documento no
    // puede llevarse por delante la fila que ya estaba bien guardada.
    await importar();
    expect(harness.subjects.items.size).toBe(6);

    harness.pdf.setItems(
      HORARIO_2027_1.map((item) =>
        item.text === 'CÁLCULO VECTORIAL' ? { ...item, text: 'X'.repeat(200) } : item,
      ),
    );

    const summary = unwrap(await importar());

    expect(summary.removedSubjects).toBe(0);
    const calculo = [...harness.subjects.items.values()].find((item) => item.code === 'EGC252');
    expect(calculo?.deletedAt).toBeNull();
  });

  it('le pasa al extractor los bytes tal cual', async () => {
    await importar(new Uint8Array([37, 80, 68, 70]));

    expect([...(harness.pdf.calls[0] ?? [])]).toEqual([37, 80, 68, 70]);
  });
});
