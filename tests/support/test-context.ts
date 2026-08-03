import { vi } from 'vitest';

import type { Category } from '../../src/domain/category/category';
import type {
  CategoryId,
  FocusSessionId,
  TagId,
  TaskId,
  UserId,
} from '../../src/domain/shared/branded';
import type {
  CategoryRepository,
  CurrentUser,
  FocusSessionRepository,
  TagRepository,
  TaskQuery,
  TaskRepository,
} from '../../src/application/ports/repositories';
import type { FocusSession } from '../../src/domain/focus/focus-session';
import type { Result } from '../../src/domain/shared/result';
import type { Tag } from '../../src/domain/tag/tag';
import type { Task } from '../../src/domain/task/task';
import type { UseCaseContext } from '../../src/application/use-cases/use-case';

import { brandId } from '../../src/domain/shared/branded';
import { FixedClock } from '../../src/domain/shared/clock';
import { ok } from '../../src/domain/shared/result';
import { ReminderScheduler } from '../../src/application/services/reminder-scheduler';
import { SequentialIdGenerator } from '../../src/domain/shared/id-generator';

/**
 * Dobles en memoria para los puertos.
 *
 * Existen porque la capa de aplicacion depende de INTERFACES y no de Dexie: gracias a
 * eso, todos los casos de uso se pueden ejercitar sin navegador, sin IndexedDB y sin
 * red, en milisegundos. Si los casos de uso importaran Dexie directamente, cada prueba
 * de una regla de negocio necesitaria levantar una base de datos.
 */

export const TEST_USER: CurrentUser = {
  id: brandId<UserId>('00000000-0000-4000-8000-000000000001'),
  email: 'prueba@ejemplo.com',
  displayName: 'Prueba',
};

export class InMemoryTaskRepository implements TaskRepository {
  readonly items = new Map<string, Task>();

  async findById(id: TaskId): Promise<Result<Task | null>> {
    return ok(this.items.get(id) ?? null);
  }

  async findAll(query: TaskQuery = {}): Promise<Result<Task[]>> {
    let all = [...this.items.values()];

    if (query.includeDeleted !== true) {
      all = all.filter((task) => task.deletedAt === null);
    }
    if (query.statuses !== undefined && query.statuses.length > 0) {
      const allowed = new Set(query.statuses);
      all = all.filter((task) => allowed.has(task.status));
    }
    if (query.categoryId !== undefined) {
      all = all.filter((task) => task.categoryId === query.categoryId);
    }

    return ok(all);
  }

  async findBySeries(seriesId: TaskId): Promise<Result<Task[]>> {
    return ok([...this.items.values()].filter((task) => task.seriesId === seriesId));
  }

  async save(task: Task): Promise<Result<Task>> {
    this.items.set(task.id, task);
    return ok(task);
  }

  async saveMany(tasks: readonly Task[]): Promise<Result<Task[]>> {
    for (const task of tasks) this.items.set(task.id, task);
    return ok([...tasks]);
  }

  async hardDelete(id: TaskId): Promise<Result<void>> {
    this.items.delete(id);
    return ok(undefined);
  }

  async countByStatus(): Promise<Result<Record<Task['status'], number>>> {
    const counts = { pending: 0, completed: 0, archived: 0 };
    for (const task of this.items.values()) {
      if (task.deletedAt === null) counts[task.status] += 1;
    }
    return ok(counts);
  }
}

export class InMemoryCategoryRepository implements CategoryRepository {
  readonly items = new Map<string, Category>();

  async findById(id: CategoryId): Promise<Result<Category | null>> {
    return ok(this.items.get(id) ?? null);
  }

  async findAll(options: { includeDeleted?: boolean } = {}): Promise<Result<Category[]>> {
    const all = [...this.items.values()];
    return ok(
      options.includeDeleted === true ? all : all.filter((item) => item.deletedAt === null),
    );
  }

  async save(category: Category): Promise<Result<Category>> {
    this.items.set(category.id, category);
    return ok(category);
  }

  async saveMany(categories: readonly Category[]): Promise<Result<Category[]>> {
    for (const category of categories) this.items.set(category.id, category);
    return ok([...categories]);
  }

  async hardDelete(id: CategoryId): Promise<Result<void>> {
    this.items.delete(id);
    return ok(undefined);
  }
}

export class InMemoryTagRepository implements TagRepository {
  readonly items = new Map<string, Tag>();

  async findById(id: TagId): Promise<Result<Tag | null>> {
    return ok(this.items.get(id) ?? null);
  }

  async findBySlug(slug: string): Promise<Result<Tag | null>> {
    return ok([...this.items.values()].find((tag) => tag.slug === slug) ?? null);
  }

  async findAll(options: { includeDeleted?: boolean } = {}): Promise<Result<Tag[]>> {
    const all = [...this.items.values()];
    return ok(
      options.includeDeleted === true ? all : all.filter((item) => item.deletedAt === null),
    );
  }

  async save(tag: Tag): Promise<Result<Tag>> {
    this.items.set(tag.id, tag);
    return ok(tag);
  }

  async saveMany(tags: readonly Tag[]): Promise<Result<Tag[]>> {
    for (const tag of tags) this.items.set(tag.id, tag);
    return ok([...tags]);
  }

  async hardDelete(id: TagId): Promise<Result<void>> {
    this.items.delete(id);
    return ok(undefined);
  }
}

export class InMemoryFocusSessionRepository implements FocusSessionRepository {
  readonly items = new Map<string, FocusSession>();

  async findById(id: FocusSessionId): Promise<Result<FocusSession | null>> {
    return ok(this.items.get(id) ?? null);
  }

  async findAll(options: { since?: string; limit?: number } = {}): Promise<Result<FocusSession[]>> {
    let all = [...this.items.values()];
    if (options.since !== undefined) {
      all = all.filter((session) => Date.parse(session.startedAt) >= Date.parse(options.since!));
    }
    return ok(options.limit === undefined ? all : all.slice(0, options.limit));
  }

  async findActive(): Promise<Result<FocusSession | null>> {
    return ok([...this.items.values()].find((session) => session.endedAt === null) ?? null);
  }

  async save(session: FocusSession): Promise<Result<FocusSession>> {
    this.items.set(session.id, session);
    return ok(session);
  }

  async saveMany(sessions: readonly FocusSession[]): Promise<Result<FocusSession[]>> {
    for (const session of sessions) this.items.set(session.id, session);
    return ok([...sessions]);
  }
}

export interface TestHarness {
  readonly context: UseCaseContext;
  readonly tasks: InMemoryTaskRepository;
  readonly categories: InMemoryCategoryRepository;
  readonly tags: InMemoryTagRepository;
  readonly focusSessions: InMemoryFocusSessionRepository;
  readonly clock: FixedClock;
  readonly notifications: {
    schedule: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    cancelAll: ReturnType<typeof vi.fn>;
  };
}

/** Monta un contexto completo con reloj fijo e ids predecibles. */
export const createTestHarness = (
  now = new Date('2026-08-02T12:00:00.000Z'),
  user: CurrentUser | null = TEST_USER,
): TestHarness => {
  const clock = new FixedClock(now);
  const ids = new SequentialIdGenerator();

  const tasks = new InMemoryTaskRepository();
  const categories = new InMemoryCategoryRepository();
  const tags = new InMemoryTagRepository();
  const focusSessions = new InMemoryFocusSessionRepository();

  const notifications = {
    getPermission: vi.fn(async () => 'granted' as const),
    requestPermission: vi.fn(async () => 'granted' as const),
    schedule: vi.fn(async () => ok(undefined)),
    cancel: vi.fn(async () => ok(undefined)),
    cancelAll: vi.fn(async () => ok(undefined)),
    showNow: vi.fn(async () => ok(undefined)),
    registerForPush: vi.fn(async () => ok(null)),
    unregisterFromPush: vi.fn(async () => ok(undefined)),
  };

  const files = {
    upload: vi.fn(),
    remove: vi.fn(async () => ok(undefined)),
    createSignedUrl: vi.fn(async () => ok('https://example.test/firmada')),
  };

  const platform = {
    kind: 'web' as const,
    isDesktop: false,
    isStandalone: false,
    supportsNativeNotifications: true,
    supportsBackgroundGeolocation: false,
    openExternal: vi.fn(async () => undefined),
    saveFile: vi.fn(async () => ok(undefined)),
    pickFile: vi.fn(async () => ok(null)),
  };

  const context: UseCaseContext = {
    tasks,
    categories,
    tags,
    focusSessions,
    clock,
    ids,
    notifications: notifications as unknown as UseCaseContext['notifications'],
    reminders: new ReminderScheduler(
      notifications as unknown as UseCaseContext['notifications'],
      tasks,
      clock,
    ),
    files: files as unknown as UseCaseContext['files'],
    platform: platform as unknown as UseCaseContext['platform'],
    currentUser: () => user,
  };

  return { context, tasks, categories, tags, focusSessions, clock, notifications };
};
