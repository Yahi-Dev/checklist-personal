import { CalendarRange, Inbox } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { Task } from '../domain/task/task';

import { EmptyState, TaskListSkeleton } from '../shared/ui/feedback';
import { formatDueDate } from '../shared/lib/date-format';
import { groupTasksByDueDate } from '../domain/task/task-sorting';
import { isPendingSpec } from '../domain/task/task-specifications';
import { PageContent, PageHeader } from '../shared/ui/layout';
import { QuickCaptureBar } from '../features/quick-capture/quick-capture-bar';
import { startOfLocalDay } from '../domain/shared/clock';
import { TaskDetailSheet } from '../features/task-detail/task-detail-sheet';
import { TaskList } from '../features/task-list/task-list';
import { useAllTasks } from '../shared/hooks/use-live-query';
import { useNavigate } from 'react-router-dom';

/**
 * Lo que viene: tareas futuras agrupadas por dia, mas un cajon de "sin fecha".
 *
 * El bloque sin fecha va al final pero SE MUESTRA. Una tarea sin fecha no aparece en
 * Hoy ni en el calendario: si tampoco saliera aqui, no existiria en ninguna pantalla y
 * seria un agujero por donde se pierden cosas.
 */
export const UpcomingPage = () => {
  const tasks = useAllTasks();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const now = useMemo(() => new Date(), []);

  const { byDay, undated } = useMemo(() => {
    if (tasks === undefined) return { byDay: [] as [string, Task[]][], undated: [] as Task[] };

    const pendingSpec = isPendingSpec();
    const tomorrow = startOfLocalDay(now).getTime() + 86_400_000;

    const future = tasks.filter(
      (task) =>
        pendingSpec.isSatisfiedBy(task) &&
        task.dueAt !== null &&
        Date.parse(task.dueAt) >= tomorrow,
    );

    const withoutDate = tasks.filter(
      (task) => pendingSpec.isSatisfiedBy(task) && task.dueAt === null,
    );

    const grouped = [...groupTasksByDueDate(future).entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );

    return { byDay: grouped, undated: withoutDate };
  }, [tasks, now]);

  const openTask = (task: Task) => {
    setSelected(task);
    setDetailOpen(true);
  };

  const liveSelected = useMemo(
    () => (selected === null ? null : (tasks?.find((task) => task.id === selected.id) ?? selected)),
    [tasks, selected],
  );

  const isEmpty = byDay.length === 0 && undated.length === 0;

  return (
    <>
      <PageHeader title="Proximas" subtitle="Todo lo que viene por delante">
        <QuickCaptureBar />
      </PageHeader>

      <PageContent>
        {tasks === undefined ? (
          <TaskListSkeleton />
        ) : isEmpty ? (
          <EmptyState
            icon={<CalendarRange />}
            title="No hay nada programado"
            description="Cuando pongas fecha a una tarea, aparecera aqui ordenada por dia."
          />
        ) : (
          <div className="space-y-6">
            {byDay.map(([dayKey, dayTasks]) => (
              <section key={dayKey} className="space-y-2">
                <h2 className="sticky top-[calc(env(safe-area-inset-top,0px)+7.5rem)] z-10 px-1 text-sm font-semibold text-ink-soft">
                  {formatDueDate(`${dayKey}T12:00:00.000Z`, { isAllDay: true, now })}
                  <span className="ml-2 text-xs font-normal text-ink-muted tabular-nums">
                    {dayTasks.length}
                  </span>
                </h2>
                <TaskList
                  tasks={dayTasks}
                  sortMode="due-asc"
                  hideDueDate={dayTasks.every((task) => task.isAllDay)}
                  onOpenTask={openTask}
                  onStartFocus={(task) => void navigate(`/enfoque?tarea=${task.id}`)}
                />
              </section>
            ))}

            {undated.length > 0 && (
              <section className="space-y-2">
                <h2 className="flex items-center gap-2 px-1 text-sm font-semibold text-ink-soft">
                  <Inbox className="size-4" />
                  Sin fecha
                  <span className="text-xs font-normal text-ink-muted tabular-nums">
                    {undated.length}
                  </span>
                </h2>
                <TaskList tasks={undated} sortMode="priority" onOpenTask={openTask} />
              </section>
            )}
          </div>
        )}
      </PageContent>

      <TaskDetailSheet task={liveSelected} open={detailOpen} onOpenChange={setDetailOpen} />
    </>
  );
};
