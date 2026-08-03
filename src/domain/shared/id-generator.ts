/**
 * Puerto de generacion de identificadores.
 *
 * Los ids se generan en el CLIENTE, no en la base de datos. Es un requisito del
 * modelo offline-first: creas una tarea sin señal en el metro, la app necesita un id
 * estable ya mismo para enlazar subtareas y adjuntos, y ese mismo id debe seguir
 * siendo valido cuando la fila llegue a Postgres horas despues.
 *
 * UUID v4 hace esa colision practicamente imposible sin coordinacion central.
 */
import type { Brand } from './branded';
import { brandId } from './branded';

export interface IdGenerator {
  next<T extends Brand<string, string>>(): T;
  /** El valor crudo, para cuando no hay un tipo branded que aplicar. */
  raw(): string;
}

export class UuidGenerator implements IdGenerator {
  next<T extends Brand<string, string>>(): T {
    return brandId<T>(this.raw());
  }

  raw(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return fallbackUuidV4();
  }
}

/** Generador secuencial y predecible: hace legibles los snapshots de las pruebas. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = '00000000-0000-4000-8000') {}

  next<T extends Brand<string, string>>(): T {
    return brandId<T>(this.raw());
  }

  raw(): string {
    this.counter += 1;
    return `${this.prefix}-${String(this.counter).padStart(12, '0')}`;
  }
}

/**
 * Respaldo para entornos sin `crypto.randomUUID` (WebViews viejos, algun test runner).
 * Usa `getRandomValues` cuando existe; solo cae a Math.random como ultimo recurso.
 */
const fallbackUuidV4 = (): string => {
  const bytes = new Uint8Array(16);

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  // Fija version (4) y variante (RFC 4122) segun el estandar.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
};
