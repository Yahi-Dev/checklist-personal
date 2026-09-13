import type { AttentionLevel } from './value-objects/attention-level';
import type { CalendarDate } from '../shared/clock';
import type { DomainError } from '../shared/domain-error';
import type { IsoDateTime } from '../task/value-objects/iso-date-time';
import type { Result } from '../shared/result';
import type { SubjectId, UserId } from '../shared/branded';
import { CATEGORY_COLORS } from '../category/category';
import { DEFAULT_ATTENTION, isAttentionLevel } from './value-objects/attention-level';
import { DomainErrors } from '../shared/domain-error';
import { err, ok } from '../shared/result';

/**
 * Una asignatura matriculada en un cuatrimestre concreto.
 *
 * La clave real de una asignatura NO es su nombre ni su codigo por separado: es
 * `(cuatrimestre, codigo, seccion)`. En el horario de la universidad aparece dos veces
 * "EGC270 FISICA GENERAL II", una con seccion `01` -la teoria- y otra con `01-01` -el
 * laboratorio-, con profesor, aula y dia distintos. Fundirlas perderia la mitad del
 * horario, y hacerlo por nombre las fundiria igual.
 *
 * Esa terna es tambien lo que permite volver a soltar el PDF del mismo cuatrimestre sin
 * duplicar nada y, sobre todo, sin perder el color que el usuario haya elegido: la
 * reconciliacion casa por clave natural y CONSERVA el id.
 *
 * El cuatrimestre vive aqui como tres campos (`termCode`, `startsOn`, `endsOn`) y no
 * como entidad propia. No es pereza: cada entidad sincronizable cuesta una tabla local,
 * una remota, un cursor, un mapeador y varios puntos del motor de sincronizacion que el
 * compilador no vigila. Un cuatrimestre que solo se lee no compra nada de eso. El dia
 * que haga falta -notas, indice academico- se promueve, y la migracion es aditiva.
 */
export interface Subject {
  readonly id: SubjectId;
  readonly userId: UserId;
  /** Codigo del plan de estudios, ej. `TI3210`. Siempre en mayusculas. */
  readonly code: string;
  readonly name: string;
  /** Seccion matriculada, ej. `01`, o `01-01` para el laboratorio de una teoria. */
  readonly section: string;
  readonly credits: number | null;
  /** Numero de empleado del profesor, tal y como lo imprime la universidad. */
  readonly teacherCode: string | null;
  readonly teacherName: string | null;
  readonly color: string;
  /**
   * Cuanta atencion pide. Solo cambia como se pinta, nunca el color: el color es
   * identidad -"la morada es Calculo"- y si ademas significara urgencia dejaria de
   * servir para las dos cosas.
   */
  readonly attention: AttentionLevel;
  /**
   * Faltas que admite antes de reprobar. `null` = sin limite.
   *
   * No hay valor por defecto a proposito: cada universidad y cada profesor tienen el
   * suyo, y un tope inventado que avise de mas es peor que no avisar -a la segunda vez
   * que se equivoca, el aviso deja de mirarse-.
   */
  readonly maxAbsences: number | null;
  /** Cuatrimestre tal y como lo nombra la universidad, ej. `2027-1`. */
  readonly termCode: string;
  readonly startsOn: CalendarDate | null;
  readonly endsOn: CalendarDate | null;
  readonly position: number;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly deletedAt: IsoDateTime | null;
}

export const SUBJECT_NAME_MAX_LENGTH = 160;
export const SUBJECT_CODE_MAX_LENGTH = 16;
export const SUBJECT_SECTION_MAX_LENGTH = 16;
export const TERM_CODE_MAX_LENGTH = 16;
export const MAX_SUBJECT_CREDITS = 30;

const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export interface CreateSubjectInput {
  readonly id: SubjectId;
  readonly userId: UserId;
  readonly code: string;
  readonly name: string;
  readonly termCode: string;
  readonly now: IsoDateTime;
  readonly section?: string;
  readonly credits?: number | null;
  readonly teacherCode?: string | null;
  readonly teacherName?: string | null;
  readonly color?: string;
  readonly attention?: AttentionLevel;
  readonly maxAbsences?: number | null;
  readonly startsOn?: CalendarDate | null;
  readonly endsOn?: CalendarDate | null;
  readonly position?: number;
}

export const createSubject = (input: CreateSubjectInput): Result<Subject> => {
  const code = normalizeCode(input.code);
  if (code.length === 0) {
    return err(DomainErrors.validation('La asignatura necesita un codigo.', { field: 'code' }));
  }
  if (code.length > SUBJECT_CODE_MAX_LENGTH) {
    return err(
      DomainErrors.validation(
        `El codigo no puede pasar de ${String(SUBJECT_CODE_MAX_LENGTH)} caracteres.`,
        { field: 'code' },
      ),
    );
  }

  const name = collapseSpaces(input.name);
  if (name.length === 0) {
    return err(DomainErrors.validation('La asignatura necesita un nombre.', { field: 'name' }));
  }
  if (name.length > SUBJECT_NAME_MAX_LENGTH) {
    return err(
      DomainErrors.validation(
        `El nombre no puede pasar de ${String(SUBJECT_NAME_MAX_LENGTH)} caracteres.`,
        { field: 'name' },
      ),
    );
  }

  const termCode = collapseSpaces(input.termCode);
  if (termCode.length === 0 || termCode.length > TERM_CODE_MAX_LENGTH) {
    return err(
      DomainErrors.validation('El cuatrimestre no tiene un formato valido.', {
        field: 'termCode',
        details: { received: input.termCode },
      }),
    );
  }

  const section = normalizeCode(input.section ?? '');
  if (section.length > SUBJECT_SECTION_MAX_LENGTH) {
    return err(
      DomainErrors.validation(
        `La seccion no puede pasar de ${String(SUBJECT_SECTION_MAX_LENGTH)} caracteres.`,
        { field: 'section' },
      ),
    );
  }

  const credits = input.credits ?? null;
  const creditsError = validateCredits(credits);
  if (creditsError !== null) return err(creditsError);

  const color = (input.color ?? colorForSubjectCode(code)).toLowerCase();
  if (!HEX_COLOR.test(color)) {
    return err(
      DomainErrors.validation('El color debe ir en formato hexadecimal, ej. #6366f1.', {
        field: 'color',
      }),
    );
  }

  const attention = input.attention ?? DEFAULT_ATTENTION;
  if (!isAttentionLevel(attention)) {
    return err(
      DomainErrors.validation('Nivel de atencion no valido.', {
        field: 'attention',
        details: { received: input.attention },
      }),
    );
  }

  const maxAbsences = input.maxAbsences ?? null;
  if (maxAbsences !== null && (!Number.isInteger(maxAbsences) || maxAbsences < 0)) {
    return err(
      DomainErrors.validation(
        'El limite de faltas tiene que ser un numero entero de 0 en adelante.',
        {
          field: 'maxAbsences',
          details: { received: maxAbsences },
        },
      ),
    );
  }

  const rangeError = validateRange(input.startsOn ?? null, input.endsOn ?? null);
  if (rangeError !== null) return err(rangeError);

  return ok({
    id: input.id,
    userId: input.userId,
    code,
    name,
    section,
    credits,
    teacherCode: emptyToNull(input.teacherCode),
    teacherName: emptyToNull(input.teacherName),
    color,
    attention,
    maxAbsences,
    termCode,
    startsOn: input.startsOn ?? null,
    endsOn: input.endsOn ?? null,
    position: input.position ?? 0,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
  } satisfies Subject);
};

export interface UpdateSubjectPatch {
  readonly code?: string;
  readonly name?: string;
  readonly section?: string;
  readonly credits?: number | null;
  readonly teacherCode?: string | null;
  readonly teacherName?: string | null;
  readonly color?: string;
  readonly attention?: AttentionLevel;
  readonly maxAbsences?: number | null;
  readonly startsOn?: CalendarDate | null;
  readonly endsOn?: CalendarDate | null;
  readonly position?: number;
}

/**
 * Se reconstruye con la misma fabrica en vez de validar campo a campo.
 *
 * Asi una regla nueva entra en un solo sitio y no hay forma de que crear y editar se
 * separen con el tiempo: el caso tipico es añadir un limite de longitud al crear y
 * descubrir meses despues que editando se lo salta cualquiera.
 */
export const updateSubject = (
  subject: Subject,
  patch: UpdateSubjectPatch,
  now: IsoDateTime,
): Result<Subject> => {
  const rebuilt = createSubject({
    id: subject.id,
    userId: subject.userId,
    code: patch.code ?? subject.code,
    name: patch.name ?? subject.name,
    termCode: subject.termCode,
    now,
    section: patch.section ?? subject.section,
    credits: patch.credits !== undefined ? patch.credits : subject.credits,
    teacherCode: patch.teacherCode !== undefined ? patch.teacherCode : subject.teacherCode,
    teacherName: patch.teacherName !== undefined ? patch.teacherName : subject.teacherName,
    color: patch.color ?? subject.color,
    /* Al reimportar el PDF nadie pasa `attention`, asi que se conserva sola. Es lo mismo
       que pasa con el color, y por el mismo motivo: no viene en el documento. */
    attention: patch.attention ?? subject.attention,
    maxAbsences: patch.maxAbsences !== undefined ? patch.maxAbsences : subject.maxAbsences,
    startsOn: patch.startsOn !== undefined ? patch.startsOn : subject.startsOn,
    endsOn: patch.endsOn !== undefined ? patch.endsOn : subject.endsOn,
    position: patch.position ?? subject.position,
  });

  if (!rebuilt.ok) return rebuilt;

  return ok({
    ...rebuilt.value,
    createdAt: subject.createdAt,
    deletedAt: subject.deletedAt,
    updatedAt: now,
  });
};

export const softDeleteSubject = (subject: Subject, now: IsoDateTime): Subject => ({
  ...subject,
  deletedAt: now,
  updatedAt: now,
});

export const restoreSubject = (subject: Subject, now: IsoDateTime): Subject => ({
  ...subject,
  deletedAt: null,
  updatedAt: now,
});

/**
 * Clave natural: lo que identifica a la misma asignatura entre dos importaciones.
 *
 * Sin ella, volver a soltar el PDF del cuatrimestre en curso crearia el horario entero
 * por segunda vez, porque los ids son UUID generados en el cliente y nunca coinciden.
 *
 * NORMALIZA sus tres partes con las mismas reglas que `createSubject`, y esto no es un
 * detalle: quien importa compara la clave de lo que viene en el PDF -texto crudo- contra
 * la de lo ya guardado -que paso por la fabrica y esta en mayusculas y sin espacios
 * dobles-. Construyendo la clave a mano en cada sitio, bastaba que un cuatrimestre
 * imprimiera " ti3210 " para que las dos claves no coincidieran y la asignatura se
 * duplicara en el segundo import, sin ningun error.
 */
export const subjectKeyFor = (termCode: string, code: string, section: string): string =>
  `${collapseSpaces(termCode)}|${normalizeCode(code)}|${normalizeCode(section)}`;

export const subjectNaturalKey = (
  subject: Pick<Subject, 'termCode' | 'code' | 'section'>,
): string => subjectKeyFor(subject.termCode, subject.code, subject.section);

/** `true` si la fecha dada cae dentro del cuatrimestre. Sin fechas se asume vigente. */
export const isTermActive = (subject: Subject, today: CalendarDate): boolean => {
  if (subject.startsOn !== null && today < subject.startsOn) return false;
  if (subject.endsOn !== null && today > subject.endsOn) return false;
  return true;
};

/** Cuatrimestres de mas nuevo a mas viejo: `2027-1` va antes que `2026-3`. */
export const compareTermCodesDesc = (a: string, b: string): number => b.localeCompare(a, 'es');

export const bySubjectOrder = (a: Subject, b: Subject): number =>
  a.position - b.position || a.code.localeCompare(b.code, 'es') || a.id.localeCompare(b.id);

/**
 * Color estable a partir del codigo.
 *
 * Se deriva del codigo y no del orden de llegada para que la misma asignatura conserve
 * su color al reimportar y entre dispositivos, sin sincronizar nada mas. Si el usuario
 * lo cambia a mano, la reconciliacion respeta el suyo porque conserva el id.
 */
export const colorForSubjectCode = (code: string): string => {
  let hash = 0;
  for (const char of normalizeCode(code)) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  }

  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length] ?? CATEGORY_COLORS[0];
};

// ---------------------------------------------------------------------------
// Auxiliares privados
// ---------------------------------------------------------------------------

const collapseSpaces = (value: string): string => value.replace(/\s+/gu, ' ').trim();

const normalizeCode = (value: string): string => collapseSpaces(value).toUpperCase();

const emptyToNull = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = collapseSpaces(value);
  return trimmed.length === 0 ? null : trimmed;
};

const validateCredits = (credits: number | null): DomainError | null => {
  if (credits === null) return null;

  if (!Number.isInteger(credits) || credits < 0 || credits > MAX_SUBJECT_CREDITS) {
    return DomainErrors.validation(
      `Los creditos tienen que ir entre 0 y ${String(MAX_SUBJECT_CREDITS)}.`,
      { field: 'credits', details: { received: credits } },
    );
  }

  return null;
};

const validateRange = (
  startsOn: CalendarDate | null,
  endsOn: CalendarDate | null,
): DomainError | null => {
  for (const [field, value] of [
    ['startsOn', startsOn],
    ['endsOn', endsOn],
  ] as const) {
    if (value !== null && !CALENDAR_DATE.test(value)) {
      return DomainErrors.validation('La fecha debe ir en formato AAAA-MM-DD.', {
        field,
        details: { received: value },
      });
    }
  }

  if (startsOn !== null && endsOn !== null && endsOn < startsOn) {
    return DomainErrors.validation('El cuatrimestre no puede terminar antes de empezar.', {
      field: 'endsOn',
    });
  }

  return null;
};
