import type { Category } from '../../../domain/category/category';
import type { Result } from '../../../domain/shared/result';
import type { UseCase, UseCaseContext } from '../use-case';
import type { UserId } from '../../../domain/shared/branded';

import { DEFAULT_CATEGORIES } from '../../../domain/category/category';
import { DomainErrors } from '../../../domain/shared/domain-error';
import { err, isErr, ok } from '../../../domain/shared/result';

/**
 * Adopta los datos creados en MODO LOCAL cuando por fin hay una cuenta.
 *
 * EL AGUJERO QUE TAPA, porque costo un dia entero encontrarlo:
 *
 * Sin Supabase configurado, la app funciona igual contra IndexedDB y firma todo con un
 * usuario ficticio de id fijo. Es lo que permite usarla antes de crear ninguna cuenta, y
 * esta bien. Lo que faltaba era el puente: al iniciar sesion de verdad, aquellas filas
 * seguian marcadas con el usuario ficticio, RLS las rechazaba una por una y -como la
 * subida va en un solo lote por tabla- TODAS las tareas se quedaban en tierra. El
 * dispositivo mostraba diecinueve tareas y el servidor cero, sin un solo mensaje.
 *
 * Aqui se les cambia el dueño y se vuelven a encolar. La promesa implicita del modo
 * local -"empieza ya, que cuando crees la cuenta te llevas lo tuyo"- pasa a cumplirse.
 *
 * SOLO se adoptan las filas del usuario ficticio que se indique. Adoptar las de
 * cualquier otro id volcaria los datos de una cuenta en otra al cambiar de usuario, que
 * es un fallo bastante peor que el que se esta arreglando.
 */

export interface AdoptLocalDataCommand {
  /**
   * De quien se adoptan las filas. El id ficticio del modo local, o el de una sesion
   * anterior que dejo datos en este dispositivo.
   */
  readonly previousUserId: UserId;
}

export interface ForeignOwner {
  readonly userId: UserId;
  readonly tareas: number;
  readonly categorias: number;
  readonly etiquetas: number;
  /** Todo junto, que es lo que decide si hay algo que ofrecer. */
  readonly total: number;
}

/**
 * Busca datos de OTRO dueño en este dispositivo.
 *
 * Existe porque el caso real no fue el que se esperaba. Al cambiar de cuenta -o al
 * entrar con una distinta de la que creo las tareas- las filas viejas se quedan con el
 * dueño anterior, y el servidor las rechaza una por una con "new row violates row-level
 * security policy". La app seguia enseñandolas como si nada: diecinueve tareas en
 * pantalla, cero en la nube, y el motivo enterrado en la cola de salida.
 *
 * Detectarlo NO implica adoptarlo. Un dispositivo compartido puede tener datos de otra
 * persona, y volcarlos a la cuenta que entre ahora seria una fuga. Esto solo cuenta lo
 * que hay para que la interfaz pueda preguntar.
 */
export class FindForeignDataUseCase implements UseCase<void, ForeignOwner[]> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(): Promise<Result<ForeignOwner[]>> {
    const owner = this.context.currentUser();
    if (owner === null) return ok([]);

    const tasks = await this.context.tasks.findAll({ includeDeleted: true });
    if (isErr(tasks)) return tasks;

    const categories = await this.context.categories.findAll({ includeDeleted: true });
    if (isErr(categories)) return categories;

    const tags = await this.context.tags.findAll({ includeDeleted: true });
    if (isErr(tags)) return tags;

    /**
     * SE MIRAN LAS TRES TABLAS, NO SOLO LAS TAREAS.
     *
     * Contar unicamente tareas dejaba fuera el caso que de verdad se dio: una CATEGORIA
     * heredada de otra sesion, sin ninguna tarea detras. No se ofrecia adoptarla, asi que
     * se quedaba en la cola rechazada para siempre; y como las categorias se suben antes
     * que las tareas y un fallo cortaba la subida entera, esa unica fila invisible bastaba
     * para que el dispositivo no volviera a subir NADA.
     *
     * La subida ya no se corta asi, pero el aviso tiene que cubrir igualmente las tres:
     * una categoria ajena sigue siendo un cambio que nunca va a llegar a la nube, y el
     * usuario merece enterarse en vez de descubrirlo comparando dispositivos.
     */
    const counts = new Map<UserId, { tareas: number; categorias: number; etiquetas: number }>();

    const bump = (userId: UserId, field: 'tareas' | 'categorias' | 'etiquetas'): void => {
      if (userId === owner.id) return;
      const entry = counts.get(userId) ?? { tareas: 0, categorias: 0, etiquetas: 0 };
      counts.set(userId, { ...entry, [field]: entry[field] + 1 });
    };

    for (const task of tasks.value) bump(task.userId, 'tareas');
    for (const category of categories.value) bump(category.userId, 'categorias');
    for (const tag of tags.value) bump(tag.userId, 'etiquetas');

    return ok(
      [...counts].map(([userId, tally]) => ({
        userId,
        ...tally,
        total: tally.tareas + tally.categorias + tally.etiquetas,
      })),
    );
  }
}

export interface AdoptedDataSummary {
  readonly tareas: number;
  readonly categorias: number;
  readonly etiquetas: number;
  readonly sesiones: number;
  /** Categorias por defecto intactas que se descartaron en vez de duplicarse. */
  readonly categoriasDescartadas: number;
}

export class AdoptLocalDataUseCase implements UseCase<AdoptLocalDataCommand, AdoptedDataSummary> {
  constructor(private readonly context: UseCaseContext) {}

  async execute({ previousUserId }: AdoptLocalDataCommand): Promise<Result<AdoptedDataSummary>> {
    const owner = this.context.currentUser();
    if (owner === null) {
      return err(DomainErrors.unauthenticated('Hay que tener sesion para adoptar los datos.'));
    }

    // Adoptarse a uno mismo no tiene sentido y reencolaria todo sin motivo.
    if (owner.id === previousUserId) {
      return ok(EMPTY_SUMMARY);
    }

    const now = this.context.clock.now().toISOString();
    const isOrphan = <T extends { userId: UserId }>(row: T): boolean =>
      row.userId === previousUserId;

    // --- Tareas ---------------------------------------------------------
    const tasks = await this.context.tasks.findAll({ includeDeleted: true });
    if (isErr(tasks)) return tasks;

    const orphanTasks = tasks.value
      .filter(isOrphan)
      .map((task) => ({ ...task, userId: owner.id, updatedAt: now }));

    if (orphanTasks.length > 0) {
      const saved = await this.context.tasks.saveMany(orphanTasks);
      if (isErr(saved)) return saved;
    }

    // --- Categorias -----------------------------------------------------
    const categories = await this.context.categories.findAll({ includeDeleted: true });
    if (isErr(categories)) return categories;

    const usedCategoryIds = new Set(
      tasks.value.map((task) => task.categoryId).filter((id) => id !== null),
    );

    const orphanCategories = categories.value.filter(isOrphan);

    /**
     * Las categorias por defecto SIN TOCAR y sin ninguna tarea detras se tiran en vez de
     * adoptarse. El motivo es concreto: la primera vez que se entra en cualquier
     * dispositivo se siembran esas mismas cinco, asi que el servidor ya tiene una con el
     * mismo nombre. Como hay un indice unico por (usuario, nombre), adoptarlas insertaria
     * duplicados que revientan la subida entera de la tabla. Descartarlas no pierde nada:
     * vuelven solas en la primera bajada.
     */
    const discardable = orphanCategories.filter(
      (category) => isUntouchedDefault(category) && !usedCategoryIds.has(category.id),
    );
    const adoptable = orphanCategories.filter((category) => !discardable.includes(category));

    for (const category of discardable) {
      const removed = await this.context.categories.hardDelete(category.id);
      if (isErr(removed)) return removed;
    }

    if (adoptable.length > 0) {
      const saved = await this.context.categories.saveMany(
        adoptable.map((category) => ({ ...category, userId: owner.id, updatedAt: now })),
      );
      if (isErr(saved)) return saved;
    }

    // --- Etiquetas ------------------------------------------------------
    const tags = await this.context.tags.findAll({ includeDeleted: true });
    if (isErr(tags)) return tags;

    const orphanTags = tags.value
      .filter(isOrphan)
      .map((tag) => ({ ...tag, userId: owner.id, updatedAt: now }));

    if (orphanTags.length > 0) {
      const saved = await this.context.tags.saveMany(orphanTags);
      if (isErr(saved)) return saved;
    }

    // --- Sesiones de enfoque --------------------------------------------
    const sessions = await this.context.focusSessions.findAll();
    if (isErr(sessions)) return sessions;

    const orphanSessions = sessions.value.filter(isOrphan).map((session) => ({
      ...session,
      userId: owner.id,
    }));

    if (orphanSessions.length > 0) {
      const saved = await this.context.focusSessions.saveMany(orphanSessions);
      if (isErr(saved)) return saved;
    }

    return ok({
      tareas: orphanTasks.length,
      categorias: adoptable.length,
      etiquetas: orphanTags.length,
      sesiones: orphanSessions.length,
      categoriasDescartadas: discardable.length,
    });
  }
}

const EMPTY_SUMMARY: AdoptedDataSummary = {
  tareas: 0,
  categorias: 0,
  etiquetas: 0,
  sesiones: 0,
  categoriasDescartadas: 0,
};

/** `true` si es una de las cinco sembradas y nadie la ha cambiado. */
const isUntouchedDefault = (category: Category): boolean =>
  DEFAULT_CATEGORIES.some(
    (seed) =>
      seed.name === category.name && seed.color === category.color && seed.icon === category.icon,
  );
