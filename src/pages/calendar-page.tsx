import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { Task } from '../domain/task/task';

import { Button } from '../shared/ui/button';
import { cn } from '../shared/lib/cn';
import { formatMonthYear, monthGridOf, toDateKey, weekDaysOf } from '../shared/lib/date-format';
import { PageContent, PageHeader } from '../shared/ui/layout';
import { QuickCaptureBar } from '../features/quick-capture/quick-capture-bar';
import { SegmentedGroup, SegmentedItem } from '../shared/ui/form-controls';
import { TaskDetailSheet } from '../features/task-detail/task-detail-sheet';
import { TaskDot } from '../features/task-list/task-item';
import { TaskList } from '../features/task-list/task-list';
import { useAllTasks } from '../shared/hooks/use-live-query';

/**
 * Vista de calendario en mes o semana.
 *
 * Al pulsar un dia se abre debajo su lista, y la caja de captura rapida queda anclada
 * a ese dia: escribir ahi crea la tarea CON esa fecha ya puesta. Sin eso, planificar la
 * semana obligaria a abrir el selector de fecha una vez por tarea.
 */

const WEEKDAY_HEADERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

export const CalendarPage = () => {
  const tasks = useAllTasks();
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [view, setView] = useState<'month' | 'week'>('month');
  const [selected, setSelected] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const today = useMemo(() => new Date(), []);

  /** Indice dia -> tareas. Se calcula una vez por cambio de datos, no por celda. */
  const tasksByDay = useMemo(() => {
    const index = new Map<string, Task[]>();
    if (tasks === undefined) return index;

    for (const task of tasks) {
      if (task.dueAt === null || task.deletedAt !== null) continue;

      const key = toDateKey(new Date(task.dueAt));
      const bucket = index.get(key);
      if (bucket === undefined) index.set(key, [task]);
      else bucket.push(task);
    }

    return index;
  }, [tasks]);

  const days = useMemo(
    () => (view === 'month' ? monthGridOf(cursor) : weekDaysOf(cursor)),
    [cursor, view],
  );

  const shift = (direction: -1 | 1) => {
    const next = new Date(cursor);
    if (view === 'month') next.setMonth(next.getMonth() + direction);
    else next.setDate(next.getDate() + direction * 7);
    setCursor(next);
  };

  const goToToday = () => {
    setCursor(new Date());
    setSelectedDay(new Date());
  };

  const selectedKey = toDateKey(selectedDay);
  const selectedTasks = tasksByDay.get(selectedKey) ?? [];

  // Medianoche local del dia elegido, en ISO: lo que se pasa a la captura rapida.
  const selectedDayIso = useMemo(() => {
    const date = new Date(selectedDay);
    date.setHours(9, 0, 0, 0);
    return date.toISOString();
  }, [selectedDay]);

  const liveSelected = useMemo(
    () => (selected === null ? null : (tasks?.find((task) => task.id === selected.id) ?? selected)),
    [tasks, selected],
  );

  return (
    <>
      <PageHeader
        title="Calendario"
        subtitle={formatMonthYear(cursor)}
        actions={
          <>
            <Button variant="ghost" size="icon-sm" onClick={() => shift(-1)} aria-label="Anterior">
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={goToToday}>
              Hoy
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => shift(1)} aria-label="Siguiente">
              <ChevronRight className="size-4" />
            </Button>
          </>
        }
      >
        <SegmentedGroup
          type="single"
          value={view}
          onValueChange={(value) => {
            if (value === 'month' || value === 'week') setView(value);
          }}
        >
          <SegmentedItem value="month">Mes</SegmentedItem>
          <SegmentedItem value="week">Semana</SegmentedItem>
        </SegmentedGroup>
      </PageHeader>

      <PageContent>
        <div className="rounded-card border border-line bg-panel p-2 shadow-soft">
          <div className="grid grid-cols-7 gap-1 pb-1">
            {WEEKDAY_HEADERS.map((label, index) => (
              <div
                key={`${label}-${index}`}
                className="py-1 text-center text-[11px] font-semibold text-ink-muted uppercase"
              >
                {label}
              </div>
            ))}
          </div>

          <div className={cn('grid grid-cols-7 gap-1')}>
            {days.map((day) => {
              const key = toDateKey(day);
              const dayTasks = tasksByDay.get(key) ?? [];
              const pending = dayTasks.filter((task) => task.status === 'pending');
              const isCurrentMonth = view === 'week' || day.getMonth() === cursor.getMonth();
              const isToday = key === toDateKey(today);
              const isSelected = key === selectedKey;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    'flex aspect-square flex-col items-center gap-1 rounded-lg p-1 pt-1.5',
                    'transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
                    view === 'week' && 'aspect-auto min-h-20',
                    !isCurrentMonth && 'opacity-35',
                    isSelected ? 'bg-brand-600 text-white' : 'hover:bg-hover',
                  )}
                  aria-label={`${day.getDate()}, ${pending.length} pendientes`}
                  aria-pressed={isSelected}
                >
                  <span
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full text-xs tabular-nums',
                      isToday &&
                        !isSelected &&
                        'bg-brand-100 font-bold text-brand-700 dark:bg-brand-900 dark:text-brand-200',
                      isSelected && 'font-bold',
                      !isToday && !isSelected && 'text-ink-soft',
                    )}
                  >
                    {day.getDate()}
                  </span>

                  {/* Hasta tres puntos y luego un contador: cuatro puntos ya no se
                      distinguen de un vistazo y ocupan mas de lo que informan. */}
                  <span className="flex flex-wrap items-center justify-center gap-0.5">
                    {pending.slice(0, 3).map((task) => (
                      <TaskDot key={task.id} task={task} />
                    ))}
                    {pending.length > 3 && (
                      <span
                        className={cn(
                          'text-[9px] font-bold tabular-nums',
                          isSelected ? 'text-white' : 'text-ink-muted',
                        )}
                      >
                        +{pending.length - 3}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <section className="mt-5 space-y-3">
          <h2 className="px-1 text-sm font-semibold text-ink">
            {new Intl.DateTimeFormat('es-DO', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            }).format(selectedDay)}
          </h2>

          <QuickCaptureBar
            defaultDueAt={selectedDayIso}
            placeholder="Añadir tarea para este dia..."
          />

          <TaskList
            tasks={selectedTasks}
            sortMode="due-asc"
            showCompleted
            onOpenTask={(task) => {
              setSelected(task);
              setDetailOpen(true);
            }}
            emptyTitle="Dia libre"
            emptyDescription="Nada programado para esta fecha."
          />
        </section>
      </PageContent>

      <TaskDetailSheet task={liveSelected} open={detailOpen} onOpenChange={setDetailOpen} />
    </>
  );
};
