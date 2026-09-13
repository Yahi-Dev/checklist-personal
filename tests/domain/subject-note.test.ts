import { describe, expect, it } from 'vitest';

import type { SubjectId, SubjectNoteId, UserId } from '../../src/domain/shared/branded';
import type { SubjectNote } from '../../src/domain/schedule/subject-note';

import { brandId } from '../../src/domain/shared/branded';
import { isErr, unwrap } from '../../src/domain/shared/result';
import {
  bySubjectNoteOrder,
  createSubjectNote,
  softDeleteSubjectNote,
  SUBJECT_NOTE_MAX_LENGTH,
  summarizeNote,
  togglePinned,
  updateSubjectNote,
} from '../../src/domain/schedule/subject-note';

/**
 * Las observaciones de una materia.
 *
 * La frontera con `Task` es lo que da sentido a esta entidad: si hay algo que HACER es
 * una tarea y se enlaza con `subjectId`; si solo hay algo que SABER, es una nota. De ahi
 * que aqui no haya vencimiento, ni completado, ni nada que huela a pendiente.
 */

const USER_ID = brandId<UserId>('00000000-0000-4000-8000-000000000001');
const SUBJECT_ID = brandId<SubjectId>('00000000-0000-4000-8000-000000000002');
const NOW = '2026-09-13T12:00:00.000Z';

let counter = 0;
const nextId = () =>
  brandId<SubjectNoteId>(`00000000-0000-4000-9000-${String(++counter).padStart(12, '0')}`);

const makeNote = (overrides: Partial<Parameters<typeof createSubjectNote>[0]> = {}): SubjectNote =>
  unwrap(
    createSubjectNote({
      id: nextId(),
      userId: USER_ID,
      subjectId: SUBJECT_ID,
      body: 'El parcial cubre hasta el capitulo 4',
      now: NOW,
      ...overrides,
    }),
  );

describe('crear una nota', () => {
  it('nace como apunte si no se dice otra cosa', () => {
    expect(makeNote().kind).toBe('note');
  });

  it('rechaza una nota vacia o de solo espacios', () => {
    for (const body of ['', '   ', '\n\n']) {
      const result = createSubjectNote({
        id: nextId(),
        userId: USER_ID,
        subjectId: SUBJECT_ID,
        body,
        now: NOW,
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.field).toBe('body');
    }
  });

  it('rechaza pasarse de largo', () => {
    const result = createSubjectNote({
      id: nextId(),
      userId: USER_ID,
      subjectId: SUBJECT_ID,
      body: 'x'.repeat(SUBJECT_NOTE_MAX_LENGTH + 1),
      now: NOW,
    });

    expect(isErr(result)).toBe(true);
  });

  it('CONSERVA los saltos de linea y colapsa el resto de espacios', () => {
    // Una nota se pega del grupo o se dicta al telefono, y ahi los saltos son los puntos
    // de una lista. Colapsarlos como se hace con el titulo de una tarea convertiria tres
    // avisos en un parrafo ilegible.
    const note = makeListaDePuntos();

    expect(note.body).toBe('Trae calculadora\nRepasar el 3\nEl viernes no hay clase');
  });

  it('recorta los saltos de mas y los bordes', () => {
    const note = makeNote({ body: '\n\n  Primero   punto\n\n\n\nSegundo  \n\n' });

    expect(note.body).toBe('Primero punto\n\nSegundo');
  });
});

/** Tres puntos escritos como se escriben de verdad: con saltos y espacios de sobra. */
const makeListaDePuntos = () =>
  makeNote({ body: 'Trae   calculadora\nRepasar  el 3\nEl viernes  no hay clase' });

describe('editar una nota', () => {
  it('conserva la fecha de creacion', () => {
    const note = makeNote();
    const updated = unwrap(updateSubjectNote(note, { kind: 'exam' }, '2026-10-01T10:00:00.000Z'));

    expect(updated.createdAt).toBe(NOW);
    expect(updated.updatedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(updated.kind).toBe('exam');
    expect(updated.body).toBe(note.body);
  });

  it('destacar y dejar de destacar es la misma operacion', () => {
    const note = makeNote();

    const fijada = togglePinned(note, NOW);
    expect(fijada.isPinned).toBe(true);

    expect(togglePinned(fijada, NOW).isPinned).toBe(false);
  });

  it('el borrado es logico', () => {
    expect(softDeleteSubjectNote(makeNote(), NOW).deletedAt).toBe(NOW);
  });
});

describe('orden de lectura', () => {
  it('destacadas arriba, luego lo que entra en el examen', () => {
    // El tipo pesa mas que la fecha a proposito: una nota vieja sobre el parcial sigue
    // siendo lo primero que hay que leer.
    const apunte = makeNote({ kind: 'note' });
    const examen = makeNote({ kind: 'exam' });
    const aviso = makeNote({ kind: 'notice' });
    const fijada = { ...makeNote({ kind: 'note' }), isPinned: true };

    const ordenadas = [apunte, examen, aviso, fijada].sort(bySubjectNoteOrder);

    expect(ordenadas.map((note) => note.kind)).toEqual(['note', 'exam', 'notice', 'note']);
    expect(ordenadas[0]?.isPinned).toBe(true);
  });

  it('a igualdad de tipo, la mas reciente primero', () => {
    const vieja = makeNote({ now: '2026-09-01T10:00:00.000Z' });
    const nueva = makeNote({ now: '2026-09-20T10:00:00.000Z' });

    expect([vieja, nueva].sort(bySubjectNoteOrder)[0]?.id).toBe(nueva.id);
  });
});

describe('resumen', () => {
  it('se queda con la primera linea', () => {
    expect(summarizeNote(makeListaDePuntos())).toBe('Trae calculadora');
  });

  it('corta las lineas largas con puntos suspensivos', () => {
    const note = makeNote({ body: 'x'.repeat(200) });

    expect(summarizeNote(note, 20)).toHaveLength(20);
    expect(summarizeNote(note, 20).endsWith('…')).toBe(true);
  });
});
