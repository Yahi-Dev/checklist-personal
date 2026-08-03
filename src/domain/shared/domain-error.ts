/**
 * El vocabulario de errores del dominio.
 *
 * Es una union discriminada y no una jerarquia de clases Error a proposito: los
 * errores viajan por el motor de sincronizacion, se guardan en la cola de salida y
 * cruzan el puente de IPC de Electron. Todo eso exige objetos serializables con
 * `structuredClone`, y una subclase de Error pierde su prototipo al cruzar.
 */

export type DomainErrorCode =
  /** La entrada no cumple una regla de forma (largo, formato, rango). */
  | 'VALIDATION'
  /** Se pidio algo que no existe. */
  | 'NOT_FOUND'
  /** La operacion choca con el estado actual (ej. completar algo ya archivado). */
  | 'CONFLICT'
  /** El usuario autenticado no es dueño del recurso. */
  | 'FORBIDDEN'
  /** Se violaria una regla de negocio del agregado. */
  | 'INVARIANT'
  /** Fallo de red, base de datos o cualquier frontera de infraestructura. */
  | 'INFRASTRUCTURE'
  /** No hay sesion activa. */
  | 'UNAUTHENTICATED'
  /** Todo lo demas. */
  | 'UNKNOWN';

export interface DomainError {
  readonly code: DomainErrorCode;
  /** Mensaje apto para mostrarle al usuario, en español. */
  readonly message: string;
  /** Campo del formulario al que apunta el error, si aplica. */
  readonly field?: string;
  /** Contexto extra para depurar. Debe ser serializable. */
  readonly details?: Readonly<Record<string, unknown>>;
}

const build =
  (code: DomainErrorCode) =>
  (
    message: string,
    options?: { field?: string; details?: Readonly<Record<string, unknown>> },
  ): DomainError => ({
    code,
    message,
    ...(options?.field !== undefined ? { field: options.field } : {}),
    ...(options?.details !== undefined ? { details: options.details } : {}),
  });

export const DomainErrors = {
  validation: build('VALIDATION'),
  notFound: build('NOT_FOUND'),
  conflict: build('CONFLICT'),
  forbidden: build('FORBIDDEN'),
  invariant: build('INVARIANT'),
  infrastructure: build('INFRASTRUCTURE'),
  unauthenticated: build('UNAUTHENTICATED'),
  unknown: build('UNKNOWN'),
} as const;

/** Normaliza cualquier valor lanzado en un DomainError legible. */
export const toDomainError = (cause: unknown, fallbackMessage: string): DomainError => {
  if (isDomainError(cause)) return cause;

  if (cause instanceof Error) {
    return DomainErrors.unknown(fallbackMessage, {
      details: { name: cause.name, message: cause.message },
    });
  }

  return DomainErrors.unknown(fallbackMessage, { details: { cause: String(cause) } });
};

export const isDomainError = (value: unknown): value is DomainError =>
  typeof value === 'object' &&
  value !== null &&
  'code' in value &&
  'message' in value &&
  typeof (value as DomainError).message === 'string';
