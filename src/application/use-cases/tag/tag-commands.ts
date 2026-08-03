import type { Result } from '../../../domain/shared/result';
import type { Tag } from '../../../domain/tag/tag';
import type { TagId } from '../../../domain/shared/branded';
import type { UseCase, UseCaseContext } from '../use-case';

import { createTag, renameTag, softDeleteTag, toTagSlug } from '../../../domain/tag/tag';
import { DomainErrors } from '../../../domain/shared/domain-error';
import { err, isErr, ok } from '../../../domain/shared/result';

/**
 * Devuelve la etiqueta con ese nombre, creandola si no existe.
 *
 * El "get or create" vive junto porque de otro modo el mismo cheque de duplicados
 * tendria que repetirse en la captura rapida, en el editor de tareas y en el panel de
 * etiquetas, con el riesgo de que uno de los tres se olvide de normalizar el slug y
 * acabe habiendo "Urgente" y "urgente" como etiquetas distintas.
 */
export class EnsureTagUseCase implements UseCase<{ name: string; color?: string }, Tag> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: { name: string; color?: string }): Promise<Result<Tag>> {
    const user = this.context.currentUser();
    if (user === null) {
      return err(DomainErrors.unauthenticated('Necesitas iniciar sesion para hacer esto.'));
    }

    const slug = toTagSlug(command.name);
    const existing = await this.context.tags.findBySlug(slug);
    if (isErr(existing)) return existing;

    if (existing.value !== null && existing.value.deletedAt === null) {
      return ok(existing.value);
    }

    const created = createTag({
      id: this.context.ids.next<TagId>(),
      userId: user.id,
      name: command.name,
      now: this.context.clock.now().toISOString(),
      ...(command.color === undefined ? {} : { color: command.color }),
    });

    if (isErr(created)) return created;
    return this.context.tags.save(created.value);
  }
}

export class RenameTagUseCase implements UseCase<{ tagId: TagId; name: string }, Tag> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: { tagId: TagId; name: string }): Promise<Result<Tag>> {
    const found = await this.context.tags.findById(command.tagId);
    if (isErr(found)) return found;
    if (found.value === null) return err(DomainErrors.notFound('No encontramos esa etiqueta.'));

    const renamed = renameTag(found.value, command.name, this.context.clock.now().toISOString());
    if (isErr(renamed)) return renamed;

    return this.context.tags.save(renamed.value);
  }
}

/** Borra la etiqueta y la quita de todas las tareas que la llevaban. */
export class DeleteTagUseCase implements UseCase<{ tagId: TagId }, Tag> {
  constructor(private readonly context: UseCaseContext) {}

  async execute({ tagId }: { tagId: TagId }): Promise<Result<Tag>> {
    const found = await this.context.tags.findById(tagId);
    if (isErr(found)) return found;
    if (found.value === null) return err(DomainErrors.notFound('No encontramos esa etiqueta.'));

    const now = this.context.clock.now().toISOString();

    const tasks = await this.context.tasks.findAll();
    if (isErr(tasks)) return tasks;

    const affected = tasks.value
      .filter((task) => task.tagIds.includes(tagId))
      .map((task) => ({
        ...task,
        tagIds: task.tagIds.filter((id) => id !== tagId),
        updatedAt: now,
      }));

    if (affected.length > 0) {
      const saved = await this.context.tasks.saveMany(affected);
      if (isErr(saved)) return saved;
    }

    return this.context.tags.save(softDeleteTag(found.value, now));
  }
}
