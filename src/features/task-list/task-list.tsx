import { CheckCircle2, ChevronRight } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';

import type { SortMode } from '../../domain/task/task-sorting';
import type { Task } from '../../domain/task/task';

import { cn } from '../../shared/lib/cn';
import { EmptyState } from '../../shared/ui/feedback';
import { sortTasks } from '../../domain/task/task-sorting';
import { TaskItem } from './task-item';
import { useCategoryIndex, useTagIndex } from '../../shared/hooks/use-live-query';
import { useNow } from '../../shared/hooks/use-now';

/**
 * Lista de tareas con agrupacion opcional y seccion plegable de completadas.
 *
 * Las completadas van al final y plegadas. Aparecen -no se ocultan- porque ver lo que
 * ya hiciste es parte de la sensacion de avance, pero plegadas para que no compitan
 * por atencion con lo que falta.
 */

export interface TaskListProps {
  tasks: readonly Task[];
  sortMode?: SortMode;
  /** Agrupa por categoria, con las tareas sin categoria al final. */
  groupByCategory?: boolean;
  showCompleted?: boolean;
  hideDueDate?: boolean;
  onOpenTask?: (task: Task) => void;
  onStartFocus?: (task: Task) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  className?: string;
}

export const TaskList = ({
  tasks,
  sortMode = 'smart',
  groupByCategory = false,
  showCompleted = false,
  hideDueDate = false,
  onOpenTask,
  onStartFocus,
  emptyTitle = 'Nada por aqui',
  emptyDescription = 'Cuando añadas tareas apareceran en esta lista.',
  emptyAction,
  className,
}: TaskListProps) => {
  const categories = useCategoryIndex();
  const tagIndex = useTagIndex();
  const [completedOpen, setCompletedOpen] = useState(false);

  /* Un solo reloj para toda la lista, no uno por fila: asi las cincuenta tareas
     comparten el mismo instante de referencia y se repintan a la vez. */
  const now = useNow();

  const { pending, completed } = useMemo(() => {
    const alive = tasks.filter((task) => task.deletedAt === null);
    return {
      pending: sortTasks(
        alive.filter((task) => task.status === 'pending'),
        sortMode,
      ),
      completed: alive
        .filter((task) => task.status === 'completed')
        .sort((a, b) => Date.parse(b.completedAt ?? '') - Date.parse(a.completedAt ?? '')),
    };
  }, [tasks, sortMode]);

  const groups = useMemo(() => {
    if (!groupByCategory) return null;

    const buckets = new Map<string, Task[]>();

    for (const task of pending) {
      const key = task.categoryId ?? '__none__';
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [task]);
      else bucket.push(task);
    }

    // Las de "sin categoria" siempre al final: es un cajon de sastre, no una categoria.
    return [...buckets.entries()].sort(([a], [b]) => {
      if (a === '__none__') return 1;
      if (b === '__none__') return -1;
      return (
        (categories.get(a)?.position ?? 0) - (categories.get(b)?.position ?? 0) ||
        (categories.get(a)?.name ?? '').localeCompare(categories.get(b)?.name ?? '', 'es')
      );
    });
  }, [pending, groupByCategory, categories]);

  const tagsOf = (task: Task) =>
    task.tagIds.map((id) => tagIndex.get(id as string)).filter((tag) => tag !== undefined);

  if (pending.length === 0 && (completed.length === 0 || !showCompleted)) {
    return (
      <EmptyState
        icon={<CheckCircle2 />}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  /* Entrada escalonada: cada fila arranca 35 ms despues de la anterior, con tope,
     para que una lista larga no tarde un segundo en aparecer. El contador corre a
     traves de los grupos, asi la cascada es continua y no reinicia por seccion. */
  let entranceOrder = 0;

  const renderTask = (task: Task) => (
    <TaskItem
      key={task.id}
      task={task}
      category={task.categoryId === null ? undefined : categories.get(task.categoryId)}
      tags={tagsOf(task)}
      now={now}
      entranceDelayMs={Math.min(entranceOrder++ * 35, 320)}
      onOpen={onOpenTask}
      onStartFocus={onStartFocus}
      hideDueDate={hideDueDate}
    />
  );

  return (
    <div className={cn('space-y-2', className)}>
      {groups === null
        ? pending.map(renderTask)
        : groups.map(([categoryId, groupTasks]) => (
            <Fragment key={categoryId}>
              <div className="flex items-center gap-2 px-1 pt-3 pb-1 first:pt-0">
                {categoryId !== '__none__' && (
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: categories.get(categoryId)?.color ?? '#94a3b8' }}
                    aria-hidden="true"
                  />
                )}
                <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  {categoryId === '__none__'
                    ? 'Sin categoria'
                    : (categories.get(categoryId)?.name ?? 'Categoria')}
                </h2>
                <span className="text-xs text-ink-muted tabular-nums">{groupTasks.length}</span>
              </div>
              {groupTasks.map(renderTask)}
            </Fragment>
          ))}

      {showCompleted && completed.length > 0 && (
        <section className="pt-4">
          <button
            type="button"
            onClick={() => setCompletedOpen((open) => !open)}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-lg px-1 py-2',
              'text-xs font-semibold tracking-wide text-ink-muted uppercase',
              'transition-colors hover:text-ink-soft',
            )}
            aria-expanded={completedOpen}
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform', completedOpen && 'rotate-90')}
            />
            Completadas
            <span className="tabular-nums">{completed.length}</span>
          </button>

          {completedOpen && (
            <div className="animate-fade-in space-y-2 pt-1">{completed.map(renderTask)}</div>
          )}
        </section>
      )}
    </div>
  );
};
