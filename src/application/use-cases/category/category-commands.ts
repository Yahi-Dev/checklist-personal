import type { Category } from '../../../domain/category/category';
import type { CategoryId } from '../../../domain/shared/branded';
import type { Result } from '../../../domain/shared/result';
import type { UseCase, UseCaseContext } from '../use-case';

import { DomainErrors } from '../../../domain/shared/domain-error';
import {
  DEFAULT_CATEGORIES,
  createCategory,
  softDeleteCategory,
  updateCategory,
} from '../../../domain/category/category';
import { err, isErr, ok } from '../../../domain/shared/result';
import { normalizeForSearch } from '../../../domain/task/value-objects/task-title';

export interface CreateCategoryCommand {
  readonly name: string;
  readonly color?: string;
  readonly icon?: string;
}

export class CreateCategoryUseCase implements UseCase<CreateCategoryCommand, Category> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: CreateCategoryCommand): Promise<Result<Category>> {
    const user = this.context.currentUser();
    if (user === null) {
      return err(DomainErrors.unauthenticated('Necesitas iniciar sesion para hacer esto.'));
    }

    const existing = await this.context.categories.findAll();
    if (isErr(existing)) return existing;

    const needle = normalizeForSearch(command.name);
    const duplicate = existing.value.some(
      (category) => category.deletedAt === null && normalizeForSearch(category.name) === needle,
    );

    if (duplicate) {
      return err(
        DomainErrors.conflict('Ya tienes una categoria con ese nombre.', { field: 'name' }),
      );
    }

    const created = createCategory({
      id: this.context.ids.next<CategoryId>(),
      userId: user.id,
      name: command.name,
      now: this.context.clock.now().toISOString(),
      ...(command.color === undefined ? {} : { color: command.color }),
      ...(command.icon === undefined ? {} : { icon: command.icon }),
      position: existing.value.length,
    });

    if (isErr(created)) return created;
    return this.context.categories.save(created.value);
  }
}

export interface UpdateCategoryCommand {
  readonly categoryId: CategoryId;
  readonly name?: string;
  readonly color?: string;
  readonly icon?: string;
  readonly position?: number;
}

export class UpdateCategoryUseCase implements UseCase<UpdateCategoryCommand, Category> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: UpdateCategoryCommand): Promise<Result<Category>> {
    const found = await this.context.categories.findById(command.categoryId);
    if (isErr(found)) return found;
    if (found.value === null) return err(DomainErrors.notFound('No encontramos esa categoria.'));

    const { categoryId: _id, ...patch } = command;

    /**
     * RENOMBRAR TAMBIEN TIENE QUE COMPROBAR EL DUPLICADO.
     *
     * Crear ya lo comprobaba; renombrar no, y el servidor tiene un indice unico por
     * (usuario, nombre). Bastaba escribir en "Cursos" un nombre que ya existia -"Trabajo"-
     * para producir una fila que la app aceptaba y el servidor rechazaba siempre. Como las
     * categorias se suben antes que las tareas, esa unica fila arrastraba consigo el resto
     * de la cola.
     *
     * Se compara normalizando -sin acentos ni mayusculas-, igual que al crear: el indice
     * del servidor no distingue "Cursos" de "cursos" y la app tampoco debe hacerlo.
     */
    if (patch.name !== undefined) {
      const siblings = await this.context.categories.findAll();
      if (isErr(siblings)) return siblings;

      const needle = normalizeForSearch(patch.name);
      const duplicate = siblings.value.some(
        (category) =>
          category.id !== command.categoryId &&
          category.deletedAt === null &&
          normalizeForSearch(category.name) === needle,
      );

      if (duplicate) {
        return err(
          DomainErrors.conflict('Ya tienes una categoria con ese nombre.', { field: 'name' }),
        );
      }
    }

    const updated = updateCategory(found.value, patch, this.context.clock.now().toISOString());
    if (isErr(updated)) return updated;

    return this.context.categories.save(updated.value);
  }
}

/**
 * Borra una categoria y desasigna las tareas que la usaban.
 *
 * Se hace en la aplicacion y no con un `ON DELETE SET NULL` de Postgres porque la
 * escritura tiene que ocurrir tambien en la copia local: si solo la hiciera el
 * servidor, el dispositivo sin conexion seguiria mostrando tareas apuntando a una
 * categoria fantasma hasta la siguiente sincronizacion.
 */
export class DeleteCategoryUseCase implements UseCase<{ categoryId: CategoryId }, Category> {
  constructor(private readonly context: UseCaseContext) {}

  async execute({ categoryId }: { categoryId: CategoryId }): Promise<Result<Category>> {
    const found = await this.context.categories.findById(categoryId);
    if (isErr(found)) return found;
    if (found.value === null) return err(DomainErrors.notFound('No encontramos esa categoria.'));

    const now = this.context.clock.now().toISOString();

    const tasks = await this.context.tasks.findAll({ categoryId });
    if (isErr(tasks)) return tasks;

    const orphaned = tasks.value
      .filter((task) => task.categoryId === categoryId)
      .map((task) => ({ ...task, categoryId: null, updatedAt: now }));

    if (orphaned.length > 0) {
      const saved = await this.context.tasks.saveMany(orphaned);
      if (isErr(saved)) return saved;
    }

    return this.context.categories.save(softDeleteCategory(found.value, now));
  }
}

/**
 * Siembra las categorias iniciales en el primer arranque.
 * Es idempotente: si ya hay alguna, no hace nada.
 */
export class SeedDefaultCategoriesUseCase implements UseCase<void, Category[]> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(): Promise<Result<Category[]>> {
    const user = this.context.currentUser();
    if (user === null) {
      return err(DomainErrors.unauthenticated('Necesitas iniciar sesion para hacer esto.'));
    }

    const existing = await this.context.categories.findAll();
    if (isErr(existing)) return existing;
    if (existing.value.length > 0) return ok([]);

    const now = this.context.clock.now().toISOString();
    const categories: Category[] = [];

    for (const [index, seed] of DEFAULT_CATEGORIES.entries()) {
      const created = createCategory({
        id: this.context.ids.next<CategoryId>(),
        userId: user.id,
        name: seed.name,
        color: seed.color,
        icon: seed.icon,
        position: index,
        now,
      });

      if (isErr(created)) return created;
      categories.push(created.value);
    }

    return this.context.categories.saveMany(categories);
  }
}
