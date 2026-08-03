import type { CategoryId, TagId } from '../../../domain/shared/branded';
import type { ParsedQuickCapture } from '../../parsing/quick-capture-parser';
import type { Result } from '../../../domain/shared/result';
import type { Task } from '../../../domain/task/task';
import type { UseCase, UseCaseContext } from '../use-case';

import { CreateTaskUseCase } from './task-commands';
import { createCategory } from '../../../domain/category/category';
import { createTag, toTagSlug } from '../../../domain/tag/tag';
import { DomainErrors } from '../../../domain/shared/domain-error';
import { err, isErr } from '../../../domain/shared/result';
import { normalizeForSearch } from '../../../domain/task/value-objects/task-title';
import { parseQuickCapture } from '../../parsing/quick-capture-parser';

export interface QuickCaptureCommand {
  /** La frase tal cual la escribio el usuario. */
  readonly text: string;
  /** Categoria de la vista actual, si el texto no menciona ninguna. */
  readonly fallbackCategoryId?: CategoryId | null;
}

export interface QuickCaptureResult {
  readonly task: Task;
  /** Que entendio el parser: la UI lo usa para confirmar visualmente. */
  readonly parsed: ParsedQuickCapture;
  readonly createdCategory: boolean;
  readonly createdTags: readonly string[];
}

/**
 * Crea una tarea a partir de una sola frase.
 *
 * "Comprar leche mañana a las 6pm #compras !alta" produce la tarea, le pone fecha y
 * hora, prioridad alta y la etiqueta, creando la etiqueta si no existia. Esta es la
 * ruta principal de captura: cualquier otra cosa es demasiada friccion para apuntar
 * algo que se te acaba de ocurrir.
 */
export class QuickCaptureTaskUseCase implements UseCase<QuickCaptureCommand, QuickCaptureResult> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: QuickCaptureCommand): Promise<Result<QuickCaptureResult>> {
    const user = this.context.currentUser();
    if (user === null) {
      return err(DomainErrors.unauthenticated('Necesitas iniciar sesion para hacer esto.'));
    }

    if (command.text.trim().length === 0) {
      return err(DomainErrors.validation('Escribe algo primero.', { field: 'title' }));
    }

    const parsed = parseQuickCapture(command.text, this.context.clock.now());

    const category = await this.resolveCategory(parsed.categoryName);
    if (isErr(category)) return category;

    const tags = await this.resolveTags(parsed.tagNames);
    if (isErr(tags)) return tags;

    const created = await new CreateTaskUseCase(this.context).execute({
      title: parsed.title,
      dueAt: parsed.dueAt,
      isAllDay: parsed.isAllDay,
      priority: parsed.priority ?? 'medium',
      isImportant: parsed.isImportant,
      recurrence: parsed.recurrence,
      categoryId: category.value.id ?? command.fallbackCategoryId ?? null,
      tagIds: tags.value.ids,
      // Con hora explicita se avisa 10 minutos antes; sin hora, no se avisa a ciegas.
      reminderAt:
        parsed.dueAt !== null && !parsed.isAllDay
          ? new Date(Date.parse(parsed.dueAt) - 10 * 60_000).toISOString()
          : null,
    });

    if (isErr(created)) return created;

    return {
      ok: true,
      value: {
        task: created.value,
        parsed,
        createdCategory: category.value.created,
        createdTags: tags.value.created,
      },
    };
  }

  /**
   * Busca la categoria por nombre, ignorando mayusculas y acentos. Si no existe, la
   * crea: escribir "@finanzas" y que la app conteste "esa categoria no existe" seria
   * exactamente el tipo de friccion que este flujo intenta eliminar.
   */
  private async resolveCategory(
    name: string | null,
  ): Promise<Result<{ id: CategoryId | null; created: boolean }>> {
    if (name === null) return { ok: true, value: { id: null, created: false } };

    const existing = await this.context.categories.findAll();
    if (isErr(existing)) return existing;

    const needle = normalizeForSearch(name);
    const match = existing.value.find(
      (category) => category.deletedAt === null && normalizeForSearch(category.name) === needle,
    );

    if (match !== undefined) return { ok: true, value: { id: match.id, created: false } };

    const user = this.context.currentUser();
    if (user === null) {
      return err(DomainErrors.unauthenticated('Necesitas iniciar sesion para hacer esto.'));
    }

    const created = createCategory({
      id: this.context.ids.next<CategoryId>(),
      userId: user.id,
      name,
      now: this.context.clock.now().toISOString(),
      position: existing.value.length,
    });

    if (isErr(created)) return created;

    const saved = await this.context.categories.save(created.value);
    if (isErr(saved)) return saved;

    return { ok: true, value: { id: saved.value.id, created: true } };
  }

  private async resolveTags(
    names: readonly string[],
  ): Promise<Result<{ ids: TagId[]; created: string[] }>> {
    if (names.length === 0) return { ok: true, value: { ids: [], created: [] } };

    const user = this.context.currentUser();
    if (user === null) {
      return err(DomainErrors.unauthenticated('Necesitas iniciar sesion para hacer esto.'));
    }

    const existing = await this.context.tags.findAll();
    if (isErr(existing)) return existing;

    const bySlug = new Map(
      existing.value.filter((tag) => tag.deletedAt === null).map((tag) => [tag.slug, tag]),
    );

    const ids: TagId[] = [];
    const created: string[] = [];
    const now = this.context.clock.now().toISOString();

    for (const name of names) {
      const slug = toTagSlug(name);
      const match = bySlug.get(slug);

      if (match !== undefined) {
        ids.push(match.id);
        continue;
      }

      const tag = createTag({ id: this.context.ids.next<TagId>(), userId: user.id, name, now });
      if (isErr(tag)) return tag;

      const saved = await this.context.tags.save(tag.value);
      if (isErr(saved)) return saved;

      bySlug.set(slug, saved.value);
      ids.push(saved.value.id);
      created.push(saved.value.name);
    }

    return { ok: true, value: { ids, created } };
  }
}

/** Vista previa sin persistir nada: alimenta el resaltado en vivo del campo de captura. */
export const previewQuickCapture = (text: string, now: Date = new Date()): ParsedQuickCapture =>
  parseQuickCapture(text, now);
