import type { BackupFile } from './backup-schema';
import type { Category } from '../../../domain/category/category';
import type { FocusSession } from '../../../domain/focus/focus-session';
import type { Result } from '../../../domain/shared/result';
import type { Tag } from '../../../domain/tag/tag';
import type { Task } from '../../../domain/task/task';
import type { UseCase, UseCaseContext } from '../use-case';

import { BACKUP_FORMAT_ID, BACKUP_VERSION, backupFileSchema } from './backup-schema';
import { DomainErrors } from '../../../domain/shared/domain-error';
import { err, isErr, ok } from '../../../domain/shared/result';

export interface ExportBackupResult {
  readonly fileName: string;
  readonly contents: string;
  readonly counts: {
    readonly tasks: number;
    readonly categories: number;
    readonly tags: number;
    readonly focusSessions: number;
  };
}

/**
 * Vuelca todos los datos locales a un JSON descargable.
 *
 * Aunque la app sea personal, esto es la unica salida real: sin exportacion, los
 * datos quedan rehenes de que Supabase siga existiendo y de que la cuenta gratuita no
 * se suspenda por inactividad. El formato es JSON plano y documentado a proposito.
 */
export class ExportBackupUseCase implements UseCase<
  { format?: 'json' | 'csv' },
  ExportBackupResult
> {
  constructor(private readonly context: UseCaseContext) {}

  async execute({ format = 'json' }: { format?: 'json' | 'csv' } = {}): Promise<
    Result<ExportBackupResult>
  > {
    const [tasks, categories, tags, focusSessions] = await Promise.all([
      this.context.tasks.findAll({ includeDeleted: true }),
      this.context.categories.findAll({ includeDeleted: true }),
      this.context.tags.findAll({ includeDeleted: true }),
      this.context.focusSessions.findAll(),
    ]);

    if (isErr(tasks)) return tasks;
    if (isErr(categories)) return categories;
    if (isErr(tags)) return tags;
    if (isErr(focusSessions)) return focusSessions;

    const now = this.context.clock.now();
    const stamp = now.toISOString().slice(0, 10);

    const counts = {
      tasks: tasks.value.length,
      categories: categories.value.length,
      tags: tags.value.length,
      focusSessions: focusSessions.value.length,
    };

    if (format === 'csv') {
      return ok({
        fileName: `checklist-personal-${stamp}.csv`,
        contents: tasksToCsv(tasks.value, categories.value),
        counts,
      });
    }

    const backup: BackupFile = {
      format: BACKUP_FORMAT_ID,
      version: BACKUP_VERSION,
      exportedAt: now.toISOString(),
      appVersion: __APP_VERSION__,
      /* Doble conversion a proposito: el dominio usa arrays `readonly` y tipos
         "branded" para los ids, y el esquema del respaldo trabaja con `string` y
         arrays mutables. Los datos son identicos en tiempo de ejecucion; lo unico que
         cambia es cuanto sabe de ellos el compilador. */
      data: {
        tasks: tasks.value as unknown as BackupFile['data']['tasks'],
        categories: categories.value,
        tags: tags.value,
        focusSessions: focusSessions.value,
      },
    };

    return ok({
      fileName: `checklist-personal-${stamp}.json`,
      contents: JSON.stringify(backup, null, 2),
      counts,
    });
  }
}

export interface ImportBackupCommand {
  readonly contents: string;
  /**
   * `merge`   -> conserva lo local y solo trae lo que sea mas reciente (por defecto).
   * `replace` -> escribe todo lo del archivo encima de lo local.
   */
  readonly strategy?: 'merge' | 'replace';
}

export interface ImportBackupResult {
  readonly imported: { tasks: number; categories: number; tags: number; focusSessions: number };
  readonly skipped: number;
}

/**
 * Restaura un respaldo.
 *
 * En modo `merge` se resuelve por `updatedAt`: gana la version mas reciente. Es la
 * misma regla que usa el motor de sincronizacion, asi que importar en un dispositivo
 * y sincronizar despues no puede producir un estado distinto al de importar en el otro.
 */
export class ImportBackupUseCase implements UseCase<ImportBackupCommand, ImportBackupResult> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: ImportBackupCommand): Promise<Result<ImportBackupResult>> {
    const user = this.context.currentUser();
    if (user === null) {
      return err(DomainErrors.unauthenticated('Necesitas iniciar sesion para importar.'));
    }

    let raw: unknown;
    try {
      raw = JSON.parse(command.contents);
    } catch {
      return err(DomainErrors.validation('El archivo no es un JSON valido.', { field: 'file' }));
    }

    const parsed = backupFileSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        DomainErrors.validation('El archivo no tiene el formato de respaldo esperado.', {
          field: 'file',
          details: { issues: parsed.error.issues.slice(0, 5) },
        }),
      );
    }

    const strategy = command.strategy ?? 'merge';

    // Se reasigna el userId: un respaldo hecho con otra cuenta debe poder restaurarse,
    // y sin esto las politicas RLS de Supabase rechazarian cada fila al sincronizar.
    const stamp = (entity: { userId: string }) => ({ ...entity, userId: user.id });

    const incomingTasks = parsed.data.data.tasks.map(stamp) as unknown as Task[];
    const incomingCategories = parsed.data.data.categories.map(stamp) as unknown as Category[];
    const incomingTags = parsed.data.data.tags.map(stamp) as unknown as Tag[];
    const incomingSessions = parsed.data.data.focusSessions.map(stamp) as unknown as FocusSession[];

    let skipped = 0;

    const tasksToWrite =
      strategy === 'replace'
        ? incomingTasks
        : await this.filterNewer(incomingTasks, async (id) => {
            const found = await this.context.tasks.findById(id as Task['id']);
            return isErr(found) ? null : found.value;
          }).then((result) => {
            skipped += incomingTasks.length - result.length;
            return result;
          });

    const categoriesToWrite =
      strategy === 'replace'
        ? incomingCategories
        : await this.filterNewer(incomingCategories, async (id) => {
            const found = await this.context.categories.findById(id as Category['id']);
            return isErr(found) ? null : found.value;
          });

    const tagsToWrite =
      strategy === 'replace'
        ? incomingTags
        : await this.filterNewer(incomingTags, async (id) => {
            const found = await this.context.tags.findById(id as Tag['id']);
            return isErr(found) ? null : found.value;
          });

    const savedCategories = await this.context.categories.saveMany(categoriesToWrite);
    if (isErr(savedCategories)) return savedCategories;

    const savedTags = await this.context.tags.saveMany(tagsToWrite);
    if (isErr(savedTags)) return savedTags;

    const savedTasks = await this.context.tasks.saveMany(tasksToWrite);
    if (isErr(savedTasks)) return savedTasks;

    const savedSessions = await this.context.focusSessions.saveMany(incomingSessions);
    if (isErr(savedSessions)) return savedSessions;

    await this.context.reminders.rebuildAll();

    return ok({
      imported: {
        tasks: tasksToWrite.length,
        categories: categoriesToWrite.length,
        tags: tagsToWrite.length,
        focusSessions: incomingSessions.length,
      },
      skipped,
    });
  }

  /** Deja pasar solo las entidades cuyo `updatedAt` gana a la copia local. */
  private async filterNewer<T extends { id: string; updatedAt: string }>(
    incoming: readonly T[],
    lookup: (id: string) => Promise<{ updatedAt: string } | null>,
  ): Promise<T[]> {
    const winners: T[] = [];

    for (const entity of incoming) {
      const local = await lookup(entity.id);
      if (local === null || Date.parse(entity.updatedAt) > Date.parse(local.updatedAt)) {
        winners.push(entity);
      }
    }

    return winners;
  }
}

/** CSV con las columnas que de verdad sirven en una hoja de calculo. */
const tasksToCsv = (tasks: readonly Task[], categories: readonly Category[]): string => {
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));

  const headers = [
    'id',
    'titulo',
    'notas',
    'estado',
    'prioridad',
    'importante',
    'categoria',
    'vence',
    'completada',
    'subtareas_total',
    'subtareas_hechas',
    'pospuesta_veces',
    'creada',
  ];

  const rows = tasks
    .filter((task) => task.deletedAt === null)
    .map((task) => [
      task.id,
      task.title,
      task.notes ?? '',
      task.status,
      task.priority,
      task.isImportant ? 'si' : 'no',
      task.categoryId === null ? '' : (categoryName.get(task.categoryId) ?? ''),
      task.dueAt ?? '',
      task.completedAt ?? '',
      String(task.subtasks.length),
      String(task.subtasks.filter((subtask) => subtask.isDone).length),
      String(task.snoozeCount),
      task.createdAt,
    ]);

  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
};

/**
 * Escapa una celda segun RFC 4180 y neutraliza la inyeccion de formulas.
 * Una tarea titulada `=SUM(A1:A9)` se ejecutaria como formula al abrir el CSV en Excel;
 * el apostrofe delante la deja como texto.
 */
const escapeCsvCell = (value: string): string => {
  const guarded = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/gu, '""')}"`;
};
