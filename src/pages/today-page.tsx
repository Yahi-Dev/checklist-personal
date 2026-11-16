import {
  AlarmClock,
  Filter,
  ListFilter,
  PartyPopper,
  Search,
  SearchX,
  Sparkles,
  X,
} from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';

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
import { Input } from '../shared/ui/form-controls';
import { PageContent, PageHeader } from '../shared/ui/layout';
import { NextClassStrip } from '../features/schedule/next-class-strip';
import { QuickCaptureBar } from '../features/quick-capture/quick-capture-bar';
import { SORT_MODE_LABEL, SORT_MODES } from '../domain/task/task-sorting';
import { SyncIndicator } from '../widgets/sync-indicator/sync-indicator';
import { TaskDetailSheet } from '../features/task-detail/task-detail-sheet';
import { TaskList } from '../features/task-list/task-list';
import { buildTodayView } from '../features/today/today-view';
import { useAllTasks } from '../shared/hooks/use-live-query';
import { useFilters } from '../shared/stores/filter-store';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useNow } from '../shared/hooks/use-now';
import { usePreferences } from '../shared/stores/preferences-store';

/**
 * La vista de Hoy: la pantalla de inicio y la unica que se abre veinte veces al dia.
 *
 * Lo ATRASADO va arriba y separado. Es la decision que define esta pantalla: una
 * tarea vencida escondida entre las de hoy se convierte en una tarea que no existe.
 * Separandola, la pregunta "¿que se me paso?" se responde sin buscar.
 *
 * Lo completado hoy va al final y plegado, SIEMPRE. Antes dependia de "Ver completadas",
 * que empieza apagada y se guarda por dispositivo: en un telefono nuevo, o con el
 * almacenamiento borrado, lo hecho hoy desaparecia de la pantalla sin explicacion.
 *
 * La lupa filtra lo que ya esta en Hoy. Tambien es la puerta a Buscar en el movil y en
 * ventanas estrechas, donde la barra lateral -el unico sitio que la enlazaba- no existe.
 */
export const TodayPage = () => {
  const tasks = useAllTasks();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selected, setSelected] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  /**
   * `#/hoy?tarea=<id>` abre esa tarea directamente. Es a donde apuntan las
   * notificaciones de recordatorio: pulsar el aviso tiene que llevar A LA TAREA, no a
   * la lista para que la busques entre veinte.
   */
  const requestedTaskId = searchParams.get('tarea');

  const sortMode = usePreferences((state) => state.sortMode);
  const setSortMode = usePreferences((state) => state.setSortMode);
  const groupByCategory = usePreferences((state) => state.groupByCategory);
  const toggleGroupByCategory = usePreferences((state) => state.toggleGroupByCategory);

  /* El reloj avanza: la ventana de escritorio pasa dias abierta, y con un `new Date()`
     congelado al montar, despues de medianoche "completadas hoy" seguia siendo ayer. */
  const nowMs = useNow();
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim().length > 0;
  const setSearchQuery = useFilters((state) => state.setQuery);

  const { overdue, today, completedToday } = useMemo(
    () =>
      tasks === undefined
        ? { overdue: [], today: [], completedToday: [] }
        : buildTodayView(tasks, now, deferredQuery),
    [tasks, now, deferredQuery],
  );

  const closeSearch = () => {
    setQuery('');
    setSearchOpen(false);
  };

  /** A Buscar con el mismo texto: lo que no esta en Hoy puede estar en cualquier otra parte. */
  const searchEverywhere = () => {
    setSearchQuery(query);
    void navigate('/buscar');
  };

  const openTask = (task: Task) => {
    setSelected(task);
    setDetailOpen(true);
  };

  const startFocus = (task: Task) => {
    void navigate(`/enfoque?tarea=${task.id}`);
  };

  // La hoja lee la version viva de la tarea: si el motor de sincronizacion la actualiza
  // mientras esta abierta, se ve el cambio en vez de un dato congelado.
  //
  // La tarea pedida por la URL se resuelve aqui tambien, como estado DERIVADO. Abrirla
  // con un efecto obligaria a un `setState` durante el montaje, y ademas dejaria un
  // fotograma con la lista sin la hoja encima.
  const liveSelected = useMemo(() => {
    if (selected !== null) return tasks?.find((task) => task.id === selected.id) ?? selected;
    if (requestedTaskId !== null) return tasks?.find((task) => task.id === requestedTaskId) ?? null;
    return null;
  }, [tasks, selected, requestedTaskId]);

  const isDetailOpen = detailOpen || (requestedTaskId !== null && liveSelected !== null);

  const closeDetail = (open: boolean) => {
    setDetailOpen(open);
    // Al cerrar hay que soltar tambien el parametro: si no, la hoja se reabriria sola en
    // el siguiente render porque la URL sigue pidiendo esa tarea.
    if (!open && requestedTaskId !== null) setSearchParams({}, { replace: true });
  };

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

            <Button
              variant={searchOpen || query.length > 0 ? 'primary' : 'ghost'}
              size="icon"
              aria-label="Buscar en Hoy"
              aria-expanded={searchOpen}
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            >
              <Search className="size-4.5" />
            </Button>

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

        {searchOpen && (
          <div className="mt-3 animate-fade-in space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeSearch();
                }}
                placeholder="Filtrar las tareas de hoy..."
                className="pr-9 pl-9"
                type="search"
                autoFocus
                aria-label="Filtrar las tareas de hoy"
              />
              {query.length > 0 && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-ink-muted hover:text-ink"
                  aria-label="Limpiar busqueda"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={searchEverywhere}
              className="px-1 text-xs font-medium text-brand-600 underline-offset-4 hover:underline dark:text-brand-400"
            >
              Buscar en todas las tareas
            </button>
          </div>
        )}
      </PageHeader>

      <PageContent>
        {/* Fuera del `if` de las tareas y ANTES que el: la proxima clase se enseña
            tambien -sobre todo- el dia que no hay nada pendiente, que es justo cuando esta
            pantalla se queda vacia. */}
        <div className="mb-4">
          <NextClassStrip />
        </div>

        {tasks === undefined ? (
          <TaskListSkeleton />
        ) : searching && pendingCount === 0 && completedToday.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title={`Nada de hoy coincide con «${deferredQuery.trim()}»`}
            description="Puede estar en otro dia, o ya completada antes de hoy."
            action={
              <Button variant="secondary" onClick={searchEverywhere}>
                <Search className="size-4" />
                Buscar en todas las tareas
              </Button>
            }
          />
        ) : pendingCount === 0 ? (
          <>
            <EmptyState
              icon={completedToday.length > 0 ? <PartyPopper /> : <Sparkles />}
              title={
                completedToday.length > 0
                  ? `Dia despejado. ${completedToday.length} ${completedToday.length === 1 ? 'tarea completada' : 'tareas completadas'}.`
                  : 'Nada pendiente para hoy'
              }
              description={
                searching
                  ? undefined
                  : 'Escribe arriba para apuntar algo. Prueba con: reunion mañana 10am !alta'
              }
            />
            <CompletedToday tasks={completedToday} onOpenTask={openTask} />
          </>
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

            <CompletedToday tasks={completedToday} onOpenTask={openTask} />
          </div>
        )}
      </PageContent>

      <TaskDetailSheet task={liveSelected} open={isDetailOpen} onOpenChange={closeDetail} />
    </>
  );
};

/** Lo completado hoy: al final y plegado, como en el resto de listas. */
const CompletedToday = ({
  tasks,
  onOpenTask,
}: {
  tasks: readonly Task[];
  onOpenTask: (task: Task) => void;
}) =>
  tasks.length === 0 ? null : (
    <TaskList tasks={tasks} showCompleted onOpenTask={onOpenTask} emptyTitle="" />
  );
