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
  /** El id ficticio del modo local. Nunca un usuario real. */
  readonly previousUserId: UserId;
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
