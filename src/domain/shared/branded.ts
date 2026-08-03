/**
 * Tipos "branded": strings que el compilador distingue entre si.
 *
 * Sin esto, `TaskId` y `CategoryId` son ambos `string` y nada impide pasar uno
 * donde va el otro. Con el brand, ese error se cae en compilacion y no en runtime.
 * En tiempo de ejecucion siguen siendo strings normales, asi que serializan gratis.
 */

declare const brand: unique symbol;

export type Brand<T, TBrand extends string> = T & { readonly [brand]: TBrand };

export type UserId = Brand<string, 'UserId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type SubtaskId = Brand<string, 'SubtaskId'>;
export type CategoryId = Brand<string, 'CategoryId'>;
export type TagId = Brand<string, 'TagId'>;
export type AttachmentId = Brand<string, 'AttachmentId'>;
export type FocusSessionId = Brand<string, 'FocusSessionId'>;

/**
 * Marca un string ya validado como identificador tipado.
 * Solo debe usarse en fronteras donde el origen del dato es de confianza:
 * generadores de id, mapeadores de persistencia y fabricas del dominio.
 */
export const brandId = <T extends Brand<string, string>>(value: string): T => value as T;

/** Formato UUID v4 tal y como lo emite `crypto.randomUUID()` y `gen_random_uuid()`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);
