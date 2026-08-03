import type { AppDatabase } from './database';
import type { Category } from '../../domain/category/category';
import type { CategoryId, FocusSessionId, TagId } from '../../domain/shared/branded';
import type {
  CategoryRepository,
  FocusSessionRepository,
  TagRepository,
} from '../../application/ports/repositories';
import type { FocusSession } from '../../domain/focus/focus-session';
import type { Outbox } from './outbox';
import type { Result } from '../../domain/shared/result';
import type { Tag } from '../../domain/tag/tag';

import { fromPromise, ok } from '../../domain/shared/result';
import { stripHints, withHints } from './records';
import { toDomainError } from '../../domain/shared/domain-error';

/**
 * Repositorios de categorias, etiquetas y sesiones de concentracion.
 *
 * Comparten archivo porque son casi identicos: unas decenas de filas cada uno, sin
 * consultas compuestas y con el mismo patron de escritura + encolado. Separarlos en
 * tres archivos de treinta lineas solo añadiria ruido para navegar.
 */

export class DexieCategoryRepository implements CategoryRepository {
  constructor(
    private readonly database: AppDatabase,
    private readonly outbox: Outbox,
  ) {}

  async findById(id: CategoryId): Promise<Result<Category | null>> {
    return fromPromise(
      this.database.categories
        .get(id)
        .then((record) => (record === undefined ? null : stripHints<Category>(record))),
      (cause) => toDomainError(cause, 'No se pudo leer la categoria.'),
    );
  }

  async findAll(options: { includeDeleted?: boolean } = {}): Promise<Result<Category[]>> {
    return fromPromise(
      (async () => {
        const records =
          options.includeDeleted === true
            ? await this.database.categories.toArray()
            : await this.database.categories.where('_deleted').equals(0).toArray();

        return records
          .map((record) => stripHints<Category>(record))
          .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'es'));
      })(),
      (cause) => toDomainError(cause, 'No se pudieron leer las categorias.'),
    );
  }

  async save(category: Category): Promise<Result<Category>> {
    return fromPromise(
      this.database.transaction(
        'rw',
        [this.database.categories, this.database.outbox],
        async () => {
          await this.database.categories.put(withHints(category, true));
          await this.outbox.enqueue(
            'category',
            category.id,
            'upsert',
            category,
            category.updatedAt,
          );
          return category;
        },
      ),
      (cause) => toDomainError(cause, 'No se pudo guardar la categoria.'),
    );
  }

  async saveMany(categories: readonly Category[]): Promise<Result<Category[]>> {
    if (categories.length === 0) return ok([]);

    return fromPromise(
      this.database.transaction(
        'rw',
        [this.database.categories, this.database.outbox],
        async () => {
          await this.database.categories.bulkPut(
            categories.map((category) => withHints(category, true)),
          );
          await this.outbox.enqueueMany(
            'category',
            categories.map((category) => ({
              id: category.id,
              updatedAt: category.updatedAt,
              payload: category,
            })),
          );
          return [...categories];
        },
      ),
      (cause) => toDomainError(cause, 'No se pudieron guardar las categorias.'),
    );
  }

  async hardDelete(id: CategoryId): Promise<Result<void>> {
    return fromPromise(this.database.categories.delete(id), (cause) =>
      toDomainError(cause, 'No se pudo borrar la categoria.'),
    );
  }
}

export class DexieTagRepository implements TagRepository {
  constructor(
    private readonly database: AppDatabase,
    private readonly outbox: Outbox,
  ) {}

  async findById(id: TagId): Promise<Result<Tag | null>> {
    return fromPromise(
      this.database.tags
        .get(id)
        .then((record) => (record === undefined ? null : stripHints<Tag>(record))),
      (cause) => toDomainError(cause, 'No se pudo leer la etiqueta.'),
    );
  }

  async findBySlug(slug: string): Promise<Result<Tag | null>> {
    return fromPromise(
      this.database.tags
        .where('slug')
        .equals(slug)
        .first()
        .then((record) => (record === undefined ? null : stripHints<Tag>(record))),
      (cause) => toDomainError(cause, 'No se pudo leer la etiqueta.'),
    );
  }

  async findAll(options: { includeDeleted?: boolean } = {}): Promise<Result<Tag[]>> {
    return fromPromise(
      (async () => {
        const records =
          options.includeDeleted === true
            ? await this.database.tags.toArray()
            : await this.database.tags.where('_deleted').equals(0).toArray();

        return records
          .map((record) => stripHints<Tag>(record))
          .sort((a, b) => a.name.localeCompare(b.name, 'es'));
      })(),
      (cause) => toDomainError(cause, 'No se pudieron leer las etiquetas.'),
    );
  }

  async save(tag: Tag): Promise<Result<Tag>> {
    return fromPromise(
      this.database.transaction('rw', [this.database.tags, this.database.outbox], async () => {
        await this.database.tags.put(withHints(tag, true));
        await this.outbox.enqueue('tag', tag.id, 'upsert', tag, tag.updatedAt);
        return tag;
      }),
      (cause) => toDomainError(cause, 'No se pudo guardar la etiqueta.'),
    );
  }

  async saveMany(tags: readonly Tag[]): Promise<Result<Tag[]>> {
    if (tags.length === 0) return ok([]);

    return fromPromise(
      this.database.transaction('rw', [this.database.tags, this.database.outbox], async () => {
        await this.database.tags.bulkPut(tags.map((tag) => withHints(tag, true)));
        await this.outbox.enqueueMany(
          'tag',
          tags.map((tag) => ({ id: tag.id, updatedAt: tag.updatedAt, payload: tag })),
        );
        return [...tags];
      }),
      (cause) => toDomainError(cause, 'No se pudieron guardar las etiquetas.'),
    );
  }

  async hardDelete(id: TagId): Promise<Result<void>> {
    return fromPromise(this.database.tags.delete(id), (cause) =>
      toDomainError(cause, 'No se pudo borrar la etiqueta.'),
    );
  }
}

export class DexieFocusSessionRepository implements FocusSessionRepository {
  constructor(
    private readonly database: AppDatabase,
    private readonly outbox: Outbox,
  ) {}

  async findById(id: FocusSessionId): Promise<Result<FocusSession | null>> {
    return fromPromise(
      this.database.focusSessions
        .get(id)
        .then((record) => (record === undefined ? null : stripHints<FocusSession>(record))),
      (cause) => toDomainError(cause, 'No se pudo leer la sesion.'),
    );
  }

  async findAll(options: { since?: string; limit?: number } = {}): Promise<Result<FocusSession[]>> {
    return fromPromise(
      (async () => {
        const records =
          options.since === undefined
            ? await this.database.focusSessions.toArray()
            : await this.database.focusSessions
                .where('startedAt')
                .aboveOrEqual(options.since)
                .toArray();

        const sessions = records
          .map((record) => stripHints<FocusSession>(record))
          .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

        return options.limit === undefined ? sessions : sessions.slice(0, options.limit);
      })(),
      (cause) => toDomainError(cause, 'No se pudieron leer las sesiones.'),
    );
  }

  /** La sesion abierta, si la hay. Solo puede haber una a la vez. */
  async findActive(): Promise<Result<FocusSession | null>> {
    return fromPromise(
      (async () => {
        const records = await this.database.focusSessions.toArray();
        const open = records
          .map((record) => stripHints<FocusSession>(record))
          .filter((session) => session.endedAt === null)
          .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

        return open[0] ?? null;
      })(),
      (cause) => toDomainError(cause, 'No se pudo leer la sesion activa.'),
    );
  }

  async save(session: FocusSession): Promise<Result<FocusSession>> {
    return fromPromise(
      this.database.transaction(
        'rw',
        [this.database.focusSessions, this.database.outbox],
        async () => {
          await this.database.focusSessions.put(withHints(session, true));
          await this.outbox.enqueue(
            'focusSession',
            session.id,
            'upsert',
            session,
            session.updatedAt,
          );
          return session;
        },
      ),
      (cause) => toDomainError(cause, 'No se pudo guardar la sesion.'),
    );
  }

  async saveMany(sessions: readonly FocusSession[]): Promise<Result<FocusSession[]>> {
    if (sessions.length === 0) return ok([]);

    return fromPromise(
      this.database.transaction(
        'rw',
        [this.database.focusSessions, this.database.outbox],
        async () => {
          await this.database.focusSessions.bulkPut(
            sessions.map((session) => withHints(session, true)),
          );
          await this.outbox.enqueueMany(
            'focusSession',
            sessions.map((session) => ({
              id: session.id,
              updatedAt: session.updatedAt,
              payload: session,
            })),
          );
          return [...sessions];
        },
      ),
      (cause) => toDomainError(cause, 'No se pudieron guardar las sesiones.'),
    );
  }
}
