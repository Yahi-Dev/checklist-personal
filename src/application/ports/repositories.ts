import type { Category } from '../../domain/category/category';
import type {
  CategoryId,
  FocusSessionId,
  TagId,
  TaskId,
  UserId,
} from '../../domain/shared/branded';
import type { FocusSession } from '../../domain/focus/focus-session';
import type { IsoDateTime } from '../../domain/task/value-objects/iso-date-time';
import type { Result } from '../../domain/shared/result';
import type { Tag } from '../../domain/tag/tag';
import type { Task } from '../../domain/task/task';

/**
 * Puertos de persistencia (patron Repository).
 *
 * La capa de aplicacion depende de estas INTERFACES, nunca de Dexie ni de Supabase.
 * Es la inversion de dependencias que permite ejecutar todos los casos de uso contra
 * repositorios en memoria en los tests, sin navegador ni red de por medio.
 *
 * Todos devuelven `Result` en vez de lanzar: quedarse sin conexion es un estado
 * normal de esta app, no una excepcion.
 */

export interface TaskQuery {
  readonly includeDeleted?: boolean;
  readonly statuses?: readonly Task['status'][];
  readonly categoryId?: CategoryId | null;
  readonly updatedSince?: IsoDateTime;
  readonly limit?: number;
}

export interface TaskRepository {
  findById(id: TaskId): Promise<Result<Task | null>>;
  findAll(query?: TaskQuery): Promise<Result<Task[]>>;
  /** Todas las instancias de una serie recurrente. */
  findBySeries(seriesId: TaskId): Promise<Result<Task[]>>;
  save(task: Task): Promise<Result<Task>>;
  saveMany(tasks: readonly Task[]): Promise<Result<Task[]>>;
  /**
   * Borrado FISICO. Solo lo usa el motor de sincronizacion al purgar lapidas ya
   * confirmadas por el servidor. La app siempre borra en logico con `deletedAt`.
   */
  hardDelete(id: TaskId): Promise<Result<void>>;
  countByStatus(): Promise<Result<Record<Task['status'], number>>>;
}

export interface CategoryRepository {
  findById(id: CategoryId): Promise<Result<Category | null>>;
  findAll(options?: { includeDeleted?: boolean }): Promise<Result<Category[]>>;
  save(category: Category): Promise<Result<Category>>;
  saveMany(categories: readonly Category[]): Promise<Result<Category[]>>;
  hardDelete(id: CategoryId): Promise<Result<void>>;
}

export interface TagRepository {
  findById(id: TagId): Promise<Result<Tag | null>>;
  findBySlug(slug: string): Promise<Result<Tag | null>>;
  findAll(options?: { includeDeleted?: boolean }): Promise<Result<Tag[]>>;
  save(tag: Tag): Promise<Result<Tag>>;
  saveMany(tags: readonly Tag[]): Promise<Result<Tag[]>>;
  hardDelete(id: TagId): Promise<Result<void>>;
}

export interface FocusSessionRepository {
  findById(id: FocusSessionId): Promise<Result<FocusSession | null>>;
  findAll(options?: { since?: IsoDateTime; limit?: number }): Promise<Result<FocusSession[]>>;
  findActive(): Promise<Result<FocusSession | null>>;
  save(session: FocusSession): Promise<Result<FocusSession>>;
  saveMany(sessions: readonly FocusSession[]): Promise<Result<FocusSession[]>>;
}

/** Unidad de trabajo: agrupa varias escrituras en una sola transaccion local. */
export interface UnitOfWork {
  run<T>(work: () => Promise<Result<T>>): Promise<Result<T>>;
}

/** Todo lo que una operacion necesita saber del usuario en sesion. */
export interface CurrentUser {
  readonly id: UserId;
  readonly email: string;
  readonly displayName: string | null;
}
