import type { AppDatabase } from './database';
import type { OutboxEntry, SyncableEntity } from './records';

/**
 * La cola de salida (patron Outbox / Transactional Outbox).
 *
 * Cada escritura local deja aqui una anotacion de "esto hay que subirlo". La anotacion
 * se escribe en la MISMA transaccion de IndexedDB que el dato, asi que no existe la
 * ventana en la que el dato se guarda pero el aviso de subirlo se pierde.
 *
 * Se guarda la foto completa de la entidad y no un diff porque la resolucion de
 * conflictos es "gana el `updatedAt` mas reciente" a nivel de fila: enviar la fila
 * entera hace que reproducir la cola sea idempotente, y reintentar despues de un
 * fallo de red no puede corromper nada.
 */
export class Outbox {
  /** Tras 10 intentos fallidos la entrada se marca como envenenada y deja de bloquear. */
  private static readonly MAX_ATTEMPTS = 10;

  constructor(private readonly database: AppDatabase) {}

  /**
   * Encola una operacion, colapsando la anterior de la misma entidad si la habia.
   *
   * Editar el titulo de una tarea seis veces sin conexion debe producir UNA subida con
   * el estado final, no seis. Sin este colapso, una tarde sin señal genera cientos de
   * peticiones redundantes al recuperar la conexion.
   */
  async enqueue(
    entity: SyncableEntity,
    entityId: string,
    operation: OutboxEntry['operation'],
    payload: unknown,
    updatedAt: string,
  ): Promise<void> {
    const existing = await this.database.outbox
      .where('[entity+entityId]')
      .equals([entity, entityId])
      .toArray();

    if (existing.length > 0) {
      await this.database.outbox.bulkDelete(
        existing.map((entry) => entry.seq).filter((seq): seq is number => seq !== undefined),
      );
    }

    await this.database.outbox.add({
      entity,
      entityId,
      operation,
      payload,
      updatedAt,
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
    });
  }

  /** Encola varias entidades del mismo tipo de una vez. */
  async enqueueMany(
    entity: SyncableEntity,
    items: readonly { id: string; updatedAt: string; payload: unknown }[],
  ): Promise<void> {
    for (const item of items) {
      await this.enqueue(entity, item.id, 'upsert', item.payload, item.updatedAt);
    }
  }

  /** Las entradas pendientes en orden de encolado, saltando las envenenadas. */
  async pending(limit = 500): Promise<OutboxEntry[]> {
    const entries = await this.database.outbox.orderBy('seq').limit(limit).toArray();
    return entries.filter((entry) => entry.attempts < Outbox.MAX_ATTEMPTS);
  }

  async count(): Promise<number> {
    return this.database.outbox.count();
  }

  /** Quita las entradas ya confirmadas por el servidor. */
  async acknowledge(sequences: readonly number[]): Promise<void> {
    if (sequences.length === 0) return;
    await this.database.outbox.bulkDelete([...sequences]);
  }

  /** Suma un intento fallido y anota el motivo, para poder diagnosticarlo despues. */
  async recordFailure(sequences: readonly number[], message: string): Promise<void> {
    await this.database.transaction('rw', this.database.outbox, async () => {
      for (const seq of sequences) {
        const entry = await this.database.outbox.get(seq);
        if (entry === undefined) continue;

        await this.database.outbox.update(seq, {
          attempts: entry.attempts + 1,
          lastError: message.slice(0, 500),
        });
      }
    });
  }

  /** Entradas que agotaron los reintentos: necesitan intervencion del usuario. */
  async poisoned(): Promise<OutboxEntry[]> {
    const entries = await this.database.outbox.toArray();
    return entries.filter((entry) => entry.attempts >= Outbox.MAX_ATTEMPTS);
  }

  /** Devuelve a la cola las entradas envenenadas. Lo dispara el boton "Reintentar". */
  async retryPoisoned(): Promise<number> {
    const stuck = await this.poisoned();

    await this.database.transaction('rw', this.database.outbox, async () => {
      for (const entry of stuck) {
        if (entry.seq === undefined) continue;
        await this.database.outbox.update(entry.seq, { attempts: 0, lastError: null });
      }
    });

    return stuck.length;
  }

  async clear(): Promise<void> {
    await this.database.outbox.clear();
  }
}
