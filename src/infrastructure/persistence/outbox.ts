import Dexie from 'dexie';

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

  /**
   * Las entradas que aun se reintentan, en orden de encolado.
   *
   * El limite se aplica DESPUES de descartar las atascadas, no antes. Al reves -que es
   * como estaba- unas pocas entradas rechazadas a la cabeza de la cola llenaban la pagina
   * y se filtraban al salir, dejando la pagina vacia: el dispositivo dejaba de subir
   * cualquier cosa nueva mientras esas entradas siguieran ahi, que es para siempre.
   */
  async pending(limit = 500): Promise<OutboxEntry[]> {
    const alive = await this.database.outbox
      .where('[attempts+seq]')
      // El tope es [MAX, minKey] y NO [MAX, maxKey]: en un indice compuesto la clave real
      // de una entrada agotada es [10, 317], que es MENOR que [10, maxKey] y por tanto
      // caeria dentro del rango. Justo las que habia que dejar fuera.
      .between([0, Dexie.minKey], [Outbox.MAX_ATTEMPTS, Dexie.minKey], true, false)
      .sortBy('seq');

    // El recorte se hace por `seq` -orden real de encolado- y no por el orden del indice,
    // que va primero por numero de intentos. Cortando por el indice, una racha larga de
    // entradas recien creadas dejaria fuera indefinidamente a las que fallaron una vez, y
    // esas son precisamente las que mas necesitan otra oportunidad.
    return alive.slice(0, limit);
  }

  /** Todo lo que hay en la cola, atascado incluido. */
  async count(): Promise<number> {
    return this.database.outbox.count();
  }

  /**
   * Solo lo que aun se va a reintentar solo.
   *
   * Se separa de `count()` porque son dos preguntas distintas y mezclarlas mentia: el
   * indicador decia "3 por subir" para siempre, sin bajar nunca de tres y sin explicar
   * por que. Lo atascado se cuenta aparte, y se enseña como lo que es -algo que necesita
   * una decision- en vez de disfrazarse de trabajo en curso.
   */
  async pendingCount(): Promise<number> {
    return this.database.outbox.where('attempts').below(Outbox.MAX_ATTEMPTS).count();
  }

  /**
   * Retira de la cola lo que ya quedo obsoleto porque gano la version del servidor.
   *
   * Sin esto, aceptar la fila remota dejaba viva la anotacion local con la foto ANTIGUA,
   * y esa foto se subia despues y revertia en el servidor -para todos los dispositivos-
   * la fecha o el completado que acababan de llegar. El dato correcto aparecia y se
   * deshacia solo unos minutos mas tarde, que es de los sintomas mas dificiles de creer.
   *
   * Se comprueba la marca de tiempo: si mientras tanto el usuario volvio a editar, esa
   * anotacion ya es mas nueva que la del servidor y tiene que subir.
   */
  async discardStale(
    entity: SyncableEntity,
    entityId: string,
    newerThan: string,
  ): Promise<boolean> {
    const existing = await this.database.outbox
      .where('[entity+entityId]')
      .equals([entity, entityId])
      .toArray();

    const stale = existing.filter(
      (entry) => entry.seq !== undefined && Date.parse(entry.updatedAt) <= Date.parse(newerThan),
    );

    if (stale.length === 0) return false;

    await this.database.outbox.bulkDelete(stale.map((entry) => entry.seq as number));
    return true;
  }

  /** Quita las entradas ya confirmadas por el servidor. */
  async acknowledge(sequences: readonly number[]): Promise<void> {
    if (sequences.length === 0) return;
    await this.database.outbox.bulkDelete([...sequences]);
  }

  /**
   * Suma un intento fallido a cada entrada CON SU PROPIO motivo.
   *
   * Es un mapa y no una lista con un mensaje comun porque antes lo era, y esa forma
   * obligaba a culpar por igual a todas las filas del lote cuando el servidor solo habia
   * rechazado una. Diez pasadas despues, las 499 inocentes quedaban descartadas junto a
   * la culpable y con un motivo que no era el suyo. Quien sube ya sabe distinguirlas;
   * el tipo del parametro es lo que le impide volver a mezclarlas.
   */
  async recordFailures(failures: ReadonlyMap<number, string>): Promise<void> {
    if (failures.size === 0) return;

    await this.database.transaction('rw', this.database.outbox, async () => {
      for (const [seq, message] of failures) {
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
    return this.database.outbox.where('attempts').aboveOrEqual(Outbox.MAX_ATTEMPTS).sortBy('seq');
  }

  /** Cuantas hay atascadas, sin traerse su contenido. */
  async poisonedCount(): Promise<number> {
    return this.database.outbox.where('attempts').aboveOrEqual(Outbox.MAX_ATTEMPTS).count();
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
