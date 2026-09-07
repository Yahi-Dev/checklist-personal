import type { Result } from '../../shared/result';
import { DomainErrors } from '../../shared/domain-error';
import { err, ok } from '../../shared/result';

/**
 * Como se imparte una clase.
 *
 * La universidad imprime la modalidad con una redaccion que cambia de un cuatrimestre
 * a otro ("MODALIDAD:PRESENCIAL", "MODALIDAD:SEMIPRESENCIAL", "MODALIDAD:100% VIRTUAL
 * HIBRIDA [SINCRONICA/ASINCRONICA]"). Guardar ese texto tal cual convertiria cualquier
 * filtro o icono en una comparacion de cadenas frente a una lista que crece sola.
 *
 * Aqui se reduce a las tres formas que de verdad cambian lo que el usuario hace: ir al
 * aula, ir algunos dias, o no ir. El texto original no se pierde: viaja en el aula
 * (`ScheduleBlock.locationLabel`), que es donde el usuario lo va a mirar.
 */
export const CLASS_MODALITIES = ['presencial', 'semipresencial', 'virtual'] as const;

export type ClassModality = (typeof CLASS_MODALITIES)[number];

export const CLASS_MODALITY_LABEL: Readonly<Record<ClassModality, string>> = {
  presencial: 'Presencial',
  semipresencial: 'Semipresencial',
  virtual: 'Virtual',
};

export const isClassModality = (value: unknown): value is ClassModality =>
  typeof value === 'string' && (CLASS_MODALITIES as readonly string[]).includes(value);

export const parseClassModality = (value: unknown): Result<ClassModality> =>
  isClassModality(value)
    ? ok(value)
    : err(
        DomainErrors.validation('Modalidad de clase no valida.', {
          field: 'modality',
          details: { received: value, allowed: CLASS_MODALITIES },
        }),
      );
