import type { Priority } from '../task/value-objects/priority';
import type { Result } from '../shared/result';
import type { TaskId } from '../shared/branded';

import { brandId } from '../shared/branded';
import { DomainErrors } from '../shared/domain-error';
import { err, ok } from '../shared/result';
import { isPriority } from '../task/value-objects/priority';

/**
 * El plan que propone el asistente.
 *
 * DECISION CENTRAL DEL MODULO: el asistente no escribe en la base de datos. Propone,
 * y quien aplica es el cliente pasando por los mismos casos de uso que un toque del
 * usuario. Tres consecuencias, y ninguna es accesoria:
 *
 *   - Las invariantes del dominio siguen valiendo. Un plan que pretenda posponer al
 *     pasado se rechaza igual que si lo pidiera un boton.
 *   - Sigue funcionando sin conexion y se sincroniza por la cola de siempre. Si el
 *     servidor escribiera en Postgres, el dispositivo no se enteraria hasta la
 *     siguiente bajada y el estado local quedaria mintiendo un rato.
 *   - Deshacer sigue existiendo, porque el camino de escritura es el mismo de siempre.
 *
 * Por eso este archivo describe una PROPUESTA (datos inertes), no una orden.
 */

/** Momentos a los que el asistente puede proponer posponer. Deliberadamente pocos. */
export const POSTPONE_TARGETS = [
  'esta-noche',
  'manana',
  'fin-de-semana',
  'semana-que-viene',
] as const;

export type PostponeTarget = (typeof POSTPONE_TARGETS)[number];

export const POSTPONE_TARGET_LABEL: Readonly<Record<PostponeTarget, string>> = {
  'esta-noche': 'esta noche',
  manana: 'mañana',
  'fin-de-semana': 'el fin de semana',
  'semana-que-viene': 'la semana que viene',
};

/** Un paso del orden propuesto. La posicion en el array ES el orden. */
export interface PlanStep {
  readonly taskId: TaskId;
  /** Cuanto calcula el asistente que lleva. `null` si no se atrevio a estimar. */
  readonly minutos: number | null;
  /** El motivo, en una linea. Es lo que hace revisable el plan. */
  readonly porque: string;
}

export type PlanAdjustment =
  | { readonly kind: 'prioridad'; readonly taskId: TaskId; readonly prioridad: Priority }
  | { readonly kind: 'destacar'; readonly taskId: TaskId; readonly destacada: boolean }
  | { readonly kind: 'posponer'; readonly taskId: TaskId; readonly hasta: PostponeTarget };

export interface AdvisorPlan {
  /** Una o dos frases: la logica del plan, no la lista repetida. */
  readonly resumen: string;
  readonly pasos: readonly PlanStep[];
  readonly ajustes: readonly PlanAdjustment[];
  /**
   * Referencias que apuntaban a tareas inexistentes y se descartaron. Se cuentan y se
   * enseñan: si el modelo se inventa una tarea, el usuario tiene que verlo, no
   * encontrarse un plan mas corto sin explicacion.
   */
  readonly descartadas: number;
}

/** Tope de pasos. Un plan de treinta pasos no es un plan, es la lista otra vez. */
export const MAX_PLAN_STEPS = 12;

/**
 * Valida lo que devolvio el modelo contra las tareas que existen de verdad.
 *
 * Esta funcion es la frontera de confianza. La salida de una herramienta llega con el
 * esquema respetado, pero NADA garantiza que los identificadores existan: un id
 * inventado que llegara hasta el caso de uso reventaria el plan a medio aplicar,
 * dejando la mitad de los cambios escritos. Aqui se filtra antes de que eso pase.
 */
export const parseAdvisorPlan = (
  raw: unknown,
  knownTaskIds: ReadonlySet<string>,
): Result<AdvisorPlan> => {
  if (!isRecord(raw)) {
    return err(DomainErrors.validation('El asistente devolvio un plan con formato invalido.'));
  }

  const resumen = typeof raw.resumen === 'string' ? raw.resumen.trim() : '';

  const rawSteps = Array.isArray(raw.pasos) ? raw.pasos : [];
  const rawAdjustments = Array.isArray(raw.ajustes) ? raw.ajustes : [];

  let dropped = 0;
  const seen = new Set<string>();
  const pasos: PlanStep[] = [];

  for (const item of rawSteps) {
    if (!isRecord(item) || typeof item.taskId !== 'string') {
      dropped += 1;
      continue;
    }

    // Un id repetido colocaria la misma tarea en dos posiciones del orden.
    if (!knownTaskIds.has(item.taskId) || seen.has(item.taskId)) {
      dropped += 1;
      continue;
    }

    seen.add(item.taskId);
    pasos.push({
      taskId: brandId<TaskId>(item.taskId),
      minutos: readPositiveInt(item.minutos),
      porque: typeof item.porque === 'string' ? item.porque.trim() : '',
    });

    if (pasos.length === MAX_PLAN_STEPS) break;
  }

  const ajustes: PlanAdjustment[] = [];

  for (const item of rawAdjustments) {
    const adjustment = parseAdjustment(item, knownTaskIds);
    if (adjustment === null) {
      dropped += 1;
      continue;
    }
    ajustes.push(adjustment);
  }

  if (pasos.length === 0 && ajustes.length === 0) {
    return err(
      DomainErrors.validation(
        'El plan no hacia referencia a ninguna tarea existente. Vuelve a preguntar.',
      ),
    );
  }

  return ok({ resumen, pasos, ajustes, descartadas: dropped });
};

/** `true` cuando aplicar el plan escribe algo. Un plan solo de lectura no se aplica. */
export const planHasChanges = (plan: AdvisorPlan): boolean =>
  plan.pasos.length > 0 || plan.ajustes.length > 0;

// ---------------------------------------------------------------------------
// Auxiliares privados
// ---------------------------------------------------------------------------

const parseAdjustment = (
  raw: unknown,
  knownTaskIds: ReadonlySet<string>,
): PlanAdjustment | null => {
  if (!isRecord(raw) || typeof raw.taskId !== 'string' || !knownTaskIds.has(raw.taskId)) {
    return null;
  }

  const taskId = brandId<TaskId>(raw.taskId);

  switch (raw.tipo) {
    case 'prioridad':
      return isPriority(raw.valor) ? { kind: 'prioridad', taskId, prioridad: raw.valor } : null;

    case 'destacar':
      return typeof raw.valor === 'boolean'
        ? { kind: 'destacar', taskId, destacada: raw.valor }
        : null;

    case 'posponer':
      return isPostponeTarget(raw.valor) ? { kind: 'posponer', taskId, hasta: raw.valor } : null;

    default:
      return null;
  }
};

const isPostponeTarget = (value: unknown): value is PostponeTarget =>
  typeof value === 'string' && (POSTPONE_TARGETS as readonly string[]).includes(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readPositiveInt = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
};
