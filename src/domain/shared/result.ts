/**
 * Result: el tipo de retorno para toda operacion que puede fallar de forma esperada.
 *
 * El dominio nunca lanza excepciones para errores de negocio. Un titulo vacio o una
 * fecha invalida no son eventos excepcionales: son resultados legitimos que quien
 * llama debe manejar. Las excepciones quedan reservadas para bugs de programacion.
 *
 * Esto hace que la firma de cada funcion sea honesta sobre como puede fallar, y que
 * el compilador obligue a manejar el caso de error antes de tocar el valor.
 */
import type { DomainError } from './domain-error';

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E = DomainError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;

/** Transforma el valor de exito; propaga el error sin tocarlo. */
export const map = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
  result.ok ? ok(fn(result.value)) : result;

/** Transforma el error; propaga el exito sin tocarlo. */
export const mapErr = <T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> =>
  result.ok ? result : err(fn(result.error));

/** Encadena operaciones que a su vez pueden fallar, sin anidar Results. */
export const flatMap = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> => (result.ok ? fn(result.value) : result);

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback;

export const unwrapOrElse = <T, E>(result: Result<T, E>, fn: (error: E) => T): T =>
  result.ok ? result.value : fn(result.error);

/**
 * Extrae el valor asumiendo exito. Usar SOLO donde el exito ya esta garantizado
 * (por ejemplo, tras validar en un test o al reconstruir datos ya persistidos).
 * Si falla es un bug, y por eso lanza.
 */
export const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.ok) return result.value;
  throw new Error(`Se llamo a unwrap() sobre un Result fallido: ${JSON.stringify(result.error)}`);
};

/**
 * Convierte una lista de Results en un Result de lista.
 * Corta en el primer error (fail-fast), que es lo que quieres al validar un agregado.
 */
export const collect = <T, E>(results: readonly Result<T, E>[]): Result<T[], E> => {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
};

/** Envuelve codigo que puede lanzar (APIs de terceros) y lo trae al mundo de Result. */
export const fromThrowable = <T, E>(fn: () => T, onThrow: (cause: unknown) => E): Result<T, E> => {
  try {
    return ok(fn());
  } catch (cause) {
    return err(onThrow(cause));
  }
};

/** Version asincrona de fromThrowable. */
export const fromPromise = async <T, E>(
  promise: Promise<T>,
  onReject: (cause: unknown) => E,
): Promise<Result<T, E>> => {
  try {
    return ok(await promise);
  } catch (cause) {
    return err(onReject(cause));
  }
};
