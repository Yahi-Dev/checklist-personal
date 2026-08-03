import type { Result } from '../../shared/result';
import { DomainErrors } from '../../shared/domain-error';
import { err, ok } from '../../shared/result';

export const TITLE_MIN_LENGTH = 1;
export const TITLE_MAX_LENGTH = 500;

/**
 * Normaliza y valida el titulo de una tarea.
 *
 * Colapsa los espacios internos porque un titulo pegado desde otra app suele traer
 * saltos de linea y tabulaciones que rompen el layout de la lista, y porque dos
 * titulos que se ven identicos deben comparar igual al buscar duplicados.
 */
export const createTaskTitle = (raw: string): Result<string> => {
  const normalized = raw.replace(/\s+/gu, ' ').trim();

  if (normalized.length < TITLE_MIN_LENGTH) {
    return err(DomainErrors.validation('El titulo no puede estar vacio.', { field: 'title' }));
  }

  if (normalized.length > TITLE_MAX_LENGTH) {
    return err(
      DomainErrors.validation(`El titulo no puede pasar de ${TITLE_MAX_LENGTH} caracteres.`, {
        field: 'title',
        details: { length: normalized.length },
      }),
    );
  }

  return ok(normalized);
};

/** Para busqueda insensible a mayusculas y acentos: "accion" encuentra "Acción". */
export const normalizeForSearch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
