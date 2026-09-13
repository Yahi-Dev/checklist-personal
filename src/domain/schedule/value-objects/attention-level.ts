import type { Result } from '../../shared/result';
import { DomainErrors } from '../../shared/domain-error';
import { err, ok } from '../../shared/result';

/**
 * Cuanta atencion pide una materia.
 *
 * No es prioridad. La prioridad de una tarea dice en que orden hacerla; esto dice cuanto
 * vigilar una asignatura entera durante el cuatrimestre, que es una pregunta distinta y
 * con otro ritmo: la prioridad cambia cada dia, esto cambia tres veces por semestre.
 * Reusar `Priority` habria mezclado las dos en la cabeza del usuario y en el codigo.
 *
 * Cuatro niveles, y el que parece sobrar es el que mas trabaja. `relaxed` no destaca
 * nada: APAGA. En una pantalla con seis materias, bajar el volumen de las dos que van
 * solas es lo que hace visible la que va mal, y sale mas barato -en tinta y en ruido- que
 * pintar tres de rojo.
 */
export const ATTENTION_LEVELS = ['critical', 'watch', 'normal', 'relaxed'] as const;

export type AttentionLevel = (typeof ATTENTION_LEVELS)[number];

export const DEFAULT_ATTENTION: AttentionLevel = 'normal';

export const ATTENTION_LABEL: Readonly<Record<AttentionLevel, string>> = {
  critical: 'Critica',
  watch: 'Ojo',
  normal: 'Normal',
  relaxed: 'Tranquila',
};

/** Lo que significa cada nivel, para que el selector no obligue a adivinar. */
export const ATTENTION_HINT: Readonly<Record<AttentionLevel, string>> = {
  critical: 'La que puede costarte el cuatrimestre',
  watch: 'Hay que vigilarla',
  normal: 'Sin marca',
  relaxed: 'Esta va sola',
};

/**
 * Para ordenar: primero lo que mas pide. Es el orden en que conviene mirar una lista de
 * materias cuando no caben todas en la pantalla.
 */
export const ATTENTION_WEIGHT: Readonly<Record<AttentionLevel, number>> = {
  critical: 0,
  watch: 1,
  normal: 2,
  relaxed: 3,
};

export const isAttentionLevel = (value: unknown): value is AttentionLevel =>
  typeof value === 'string' && (ATTENTION_LEVELS as readonly string[]).includes(value);

export const parseAttentionLevel = (value: unknown): Result<AttentionLevel> =>
  isAttentionLevel(value)
    ? ok(value)
    : err(
        DomainErrors.validation('Nivel de atencion no valido.', {
          field: 'attention',
          details: { received: value, allowed: ATTENTION_LEVELS },
        }),
      );
