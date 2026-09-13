import type { DomainError } from '../shared/domain-error';
import type { IsoDateTime } from '../task/value-objects/iso-date-time';
import type { Result } from '../shared/result';
import type { SubjectId, SubjectNoteId, UserId } from '../shared/branded';
import { DomainErrors } from '../shared/domain-error';
import { err, ok } from '../shared/result';

/**
 * Lo que el profesor dijo y no es una tarea.
 *
 * "El parcial cubre hasta el capitulo 4" no vence, no se completa y no es un pendiente.
 * Meterlo en `Task` obligaria a inventarle una fecha que no tiene y lo dejaria colgando
 * de la vista Hoy para siempre; por eso es entidad propia y no un campo mas de la tarea.
 *
 * La frontera con `Task` es justo esa: si tiene algo que HACER, es una tarea y se enlaza
 * a la materia con `subjectId`, que asi hereda vencimiento, recordatorio y todo lo demas.
 * Si solo hay algo que SABER, es una nota.
 */
export interface SubjectNote {
  readonly id: SubjectNoteId;
  readonly userId: UserId;
  readonly subjectId: SubjectId;
  readonly kind: SubjectNoteKind;
  readonly body: string;
  /** Se queda arriba del todo, por encima del orden normal. */
  readonly isPinned: boolean;
  readonly position: number;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly deletedAt: IsoDateTime | null;
}

/**
 * Se clasifican por TIPO y no por importancia.
 *
 * "Alta/media/baja" dice cuanto te importa; el tipo dice QUE HACER con ello, y es lo
 * unico que permite preguntar "enseñame todo lo que entra en el parcial de Fisica". Una
 * escala de importancia no responde a esa pregunta por mucho que se afine.
 */
export const SUBJECT_NOTE_KINDS = ['exam', 'assignment', 'notice', 'note'] as const;

export type SubjectNoteKind = (typeof SUBJECT_NOTE_KINDS)[number];

export const SUBJECT_NOTE_KIND_LABEL: Readonly<Record<SubjectNoteKind, string>> = {
  exam: 'Entra en examen',
  assignment: 'Entrega',
  notice: 'Aviso',
  note: 'Apunte',
};

/** Orden de lectura: primero lo que puede costarte una nota. */
export const SUBJECT_NOTE_KIND_WEIGHT: Readonly<Record<SubjectNoteKind, number>> = {
  exam: 0,
  assignment: 1,
  notice: 2,
  note: 3,
};

export const SUBJECT_NOTE_MAX_LENGTH = 4000;

export const isSubjectNoteKind = (value: unknown): value is SubjectNoteKind =>
  typeof value === 'string' && (SUBJECT_NOTE_KINDS as readonly string[]).includes(value);

export const parseSubjectNoteKind = (value: unknown): Result<SubjectNoteKind> =>
  isSubjectNoteKind(value)
    ? ok(value)
    : err(
        DomainErrors.validation('Tipo de nota no valido.', {
          field: 'kind',
          details: { received: value, allowed: SUBJECT_NOTE_KINDS },
        }),
      );

export interface CreateSubjectNoteInput {
  readonly id: SubjectNoteId;
  readonly userId: UserId;
  readonly subjectId: SubjectId;
  readonly body: string;
  readonly now: IsoDateTime;
  readonly kind?: SubjectNoteKind;
  readonly isPinned?: boolean;
  readonly position?: number;
}

export const createSubjectNote = (input: CreateSubjectNoteInput): Result<SubjectNote> => {
  const body = normalizeBody(input.body);
  const bodyError = validateBody(body);
  if (bodyError !== null) return err(bodyError);

  const kind = input.kind ?? 'note';
  if (!isSubjectNoteKind(kind)) {
    return err(
      DomainErrors.validation('Tipo de nota no valido.', {
        field: 'kind',
        details: { received: input.kind },
      }),
    );
  }

  return ok({
    id: input.id,
    userId: input.userId,
    subjectId: input.subjectId,
    kind,
    body,
    isPinned: input.isPinned ?? false,
    position: input.position ?? 0,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
  } satisfies SubjectNote);
};

export interface UpdateSubjectNotePatch {
  readonly body?: string;
  readonly kind?: SubjectNoteKind;
  readonly isPinned?: boolean;
  readonly position?: number;
}

export const updateSubjectNote = (
  note: SubjectNote,
  patch: UpdateSubjectNotePatch,
  now: IsoDateTime,
): Result<SubjectNote> => {
  const rebuilt = createSubjectNote({
    id: note.id,
    userId: note.userId,
    subjectId: note.subjectId,
    body: patch.body ?? note.body,
    now,
    kind: patch.kind ?? note.kind,
    isPinned: patch.isPinned ?? note.isPinned,
    position: patch.position ?? note.position,
  });

  if (!rebuilt.ok) return rebuilt;

  return ok({
    ...rebuilt.value,
    createdAt: note.createdAt,
    deletedAt: note.deletedAt,
    updatedAt: now,
  });
};

export const softDeleteSubjectNote = (note: SubjectNote, now: IsoDateTime): SubjectNote => ({
  ...note,
  deletedAt: now,
  updatedAt: now,
});

export const togglePinned = (note: SubjectNote, now: IsoDateTime): SubjectNote => ({
  ...note,
  isPinned: !note.isPinned,
  updatedAt: now,
});

/**
 * Orden de lectura de las notas de una materia.
 *
 * Destacadas arriba; despues por tipo, que lo que entra en el examen importa mas que un
 * apunte suelto; y a igualdad, la mas reciente primero. La fecha desempata al final y no
 * al principio a proposito: una nota vieja sobre el parcial sigue siendo lo primero que
 * hay que leer.
 */
export const bySubjectNoteOrder = (a: SubjectNote, b: SubjectNote): number =>
  Number(b.isPinned) - Number(a.isPinned) ||
  SUBJECT_NOTE_KIND_WEIGHT[a.kind] - SUBJECT_NOTE_KIND_WEIGHT[b.kind] ||
  Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
  a.id.localeCompare(b.id);

/** Primera linea de la nota, para listarla sin desplegarla. */
export const summarizeNote = (note: SubjectNote, maxLength = 80): string => {
  const [firstLine = ''] = note.body.split('\n');
  return firstLine.length <= maxLength ? firstLine : `${firstLine.slice(0, maxLength - 1)}…`;
};

// ---------------------------------------------------------------------------
// Auxiliares privados
// ---------------------------------------------------------------------------

/**
 * Se respetan los saltos de linea y se colapsa el resto.
 *
 * Una nota se pega desde el chat del grupo o se dicta al telefono, y ahi los saltos SI
 * significan algo -son los puntos de una lista-. Colapsarlos como se hace con el titulo
 * de una tarea convertiria tres avisos en un parrafo ilegible.
 */
const normalizeBody = (value: string): string =>
  value
    .replace(/\r\n?/gu, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

const validateBody = (body: string): DomainError | null => {
  if (body.length === 0) {
    return DomainErrors.validation('La nota no puede estar vacia.', { field: 'body' });
  }

  if (body.length > SUBJECT_NOTE_MAX_LENGTH) {
    return DomainErrors.validation(
      `La nota no puede pasar de ${String(SUBJECT_NOTE_MAX_LENGTH)} caracteres.`,
      { field: 'body', details: { length: body.length } },
    );
  }

  return null;
};
