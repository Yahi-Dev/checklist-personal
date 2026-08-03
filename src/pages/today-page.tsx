import { AlarmClock, Filter, ListFilter, PartyPopper, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { Task } from '../domain/task/task';

import { Badge } from '../shared/ui/feedback';
import { Button } from '../shared/ui/button';
import { cn } from '../shared/lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../shared/ui/overlays';
import { EmptyState, TaskListSkeleton } from '../shared/ui/feedback';
import {
  isDueOnDaySpec,
  isOverdueSpec,
  isPendingSpec,
  wasCompletedOnSpec,
} from '../domain/task/task-specifications';
import { PageContent, PageHeader } from '../shared/ui/layout';
import { QuickCaptureBar } from '../features/quick-capture/quick-capture-bar';
import { SORT_MODE_LABEL, SORT_MODES } from '../domain/task/task-sorting';
import { SyncIndicator } from '../widgets/sync-indicator/sync-indicator';
import { TaskDetailSheet } from '../features/task-detail/task-detail-sheet';
import { TaskList } from '../features/task-list/task-list';
import { useAllTasks } from '../shared/hooks/use-live-query';
import { useNavigate } from 'react-router-dom';
import { usePreferences } from '../shared/stores/preferences-store';

/**
 * La vista de Hoy: la pantalla de inicio y la unica que se abre veinte veces al dia.
 *
 * Lo ATRASADO va arriba y separado. Es la decision que define esta pantalla: una
 * tarea vencida escondida entre las de hoy se convierte en una tarea que no existe.
 * Separandola, la pregunta "¿que se me paso?" se responde sin buscar.
 */
export const TodayPage = () => {
  const tasks = useAllTasks();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const sortMode = usePreferences((state) => state.sortMode);
  const setSortMode = usePreferences((state) => state.setSortMode);
  const showCompleted = usePreferences((state) => state.showCompleted);
  const toggleShowCompleted = usePreferences((state) => state.toggleShowCompleted);
  const groupByCategory = usePreferences((state) => state.groupByCategory);
  const toggleGroupByCategory = usePreferences((state) => state.toggleGroupByCategory);

  const now = useMemo(() => new Date(), []);

  const { overdue, today, completedToday } = useMemo(() => {
    if (tasks === undefined) return { overdue: [], today: [], completedToday: [] };

    const overdueSpec = isOverdueSpec(now.toISOString());
    const todaySpec = isDueOnDaySpec(now);
    const pendingSpec = isPendingSpec();
    const completedTodaySpec = wasCompletedOnSpec(now);

    const overdueTasks: Task[] = [];
    const todayTasks: Task[] = [];
    const doneToday: Task[] = [];

    for (const task of tasks) {
      if (task.status === 'completed') {
        if (completedTodaySpec.isSatisfiedBy(task)) doneToday.push(task);
        continue;
      }

      if (!pendingSpec.isSatisfiedBy(task)) continue;

      // Lo atrasado gana a lo de hoy: una tarea de esta mañana ya pasada cuenta como
      // atrasada, no como pendiente del dia, y tiene que salir en el bloque de arriba.
      if (overdueSpec.isSatisfiedBy(task)) overdueTasks.push(task);
      else if (todaySpec.isSatisfiedBy(task)) todayTasks.push(task);
    }

    return { overdue: overdueTasks, today: todayTasks, completedToday: doneToday };
  }, [tasks, now]);

  const openTask = (task: Task) => {
    setSelected(task);
    setDetailOpen(true);
  };

  const startFocus = (task: Task) => {
    void navigate(`/enfoque?tarea=${task.id}`);
  };

  // La hoja lee la version viva de la tarea: si el motor de sincronizacion la actualiza
  // mientras esta abierta, se ve el cambio en vez de un dato congelado.
  const liveSelected = useMemo(
    () => (selected === null ? null : (tasks?.find((task) => task.id === selected.id) ?? selected)),
    [tasks, selected],
  );

  const pendingCount = overdue.length + today.length;

  return (
    <>
      <PageHeader
        title="Hoy"
        subtitle={new Intl.DateTimeFormat('es-DO', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        }).format(now)}
        actions={
          <>
            <div className="hidden lg:block">
              <SyncIndicator compact />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Opciones de la lista">
                  <ListFilter className="size-4.5" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
                {SORT_MODES.filter((mode) => mode !== 'manual').map((mode) => (
                  <DropdownMenuItem
                    key={mode}
                    onSelect={() => setSortMode(mode)}
                    className={cn(sortMode === mode && 'bg-hover font-medium')}
                  >
                    {SORT_MODE_LABEL[mode]}
                  </DropdownMenuItem>
                ))}

                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={toggleShowCompleted}>
                  <Filter />
                  {showCompleted ? 'Ocultar completadas' : 'Ver completadas'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleGroupByCategory}>
                  <Filter />
                  {groupByCategory ? 'No agrupar' : 'Agrupar por categoria'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        <QuickCaptureBar />
      </PageHeader>

      <PageContent>
        {tasks === undefined ? (
          <TaskListSkeleton />
        ) : pendingCount === 0 ? (
          <EmptyState
            icon={completedToday.length > 0 ? <PartyPopper /> : <Sparkles />}
            title={
              completedToday.length > 0
                ? `Dia despejado. ${completedToday.length} ${completedToday.length === 1 ? 'tarea completada' : 'tareas completadas'}.`
                : 'Nada pendiente para hoy'
            }
            description="Escribe arriba para apuntar algo. Prueba con: reunion mañana 10am !alta"
          />
        ) : (
          <div className="space-y-6">
            {overdue.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <AlarmClock className="size-4 text-danger" />
                  <h2 className="text-sm font-semibold text-danger">Se te paso</h2>
                  <Badge variant="danger" size="sm">
                    {overdue.length}
                  </Badge>
                </div>

                <TaskList
                  tasks={overdue}
                  sortMode="due-asc"
                  onOpenTask={openTask}
                  onStartFocus={startFocus}
                />
              </section>
            )}

            <section className="space-y-2">
              {overdue.length > 0 && (
                <h2 className="px-1 text-sm font-semibold text-ink-soft">Para hoy</h2>
              )}

              <TaskList
                tasks={today}
                sortMode={sortMode}
                groupByCategory={groupByCategory}
                showCompleted={false}
                onOpenTask={openTask}
                onStartFocus={startFocus}
                emptyTitle="Nada mas para hoy"
                emptyDescription="Solo queda lo de arriba."
              />
            </section>

            {showCompleted && completedToday.length > 0 && (
              <TaskList tasks={completedToday} showCompleted onOpenTask={openTask} emptyTitle="" />
            )}
          </div>
        )}
      </PageContent>

      <TaskDetailSheet task={liveSelected} open={detailOpen} onOpenChange={setDetailOpen} />
    </>
  );
};
