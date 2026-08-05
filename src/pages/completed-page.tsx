import { CalendarCheck, Flag, SlidersHorizontal, Star, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { CategoryId } from '../domain/shared/branded';
import type { Priority } from '../domain/task/value-objects/priority';
import type { RangePreset } from '../features/completed/completed-range';
import type { Task } from '../domain/task/task';

import { Button } from '../shared/ui/button';
import { buildTaskFilter } from '../domain/task/task-specifications';
import { cn } from '../shared/lib/cn';
import { CompletionLogList } from '../features/completed/completion-log-list';
import { describeRange, RANGE_PRESETS, resolveRange } from '../features/completed/completed-range';
import { EmptyState } from '../shared/ui/feedback';
import { groupByCompletionDay } from '../domain/task/completion-log';
import { Input } from '../shared/ui/form-controls';
import { PageContent, PageHeader } from '../shared/ui/layout';
import { PRIORITIES, PRIORITY_LABEL } from '../domain/task/value-objects/priority';
import { TaskDetailSheet } from '../features/task-detail/task-detail-sheet';
import { useAllTasks, useCategories } from '../shared/hooks/use-live-query';

/**
 * El historial de lo terminado.
 *
 * QUE PREGUNTA RESUELVE, Y POR QUE NO LA RESOLVIA NINGUNA PANTALLA.
 *
 * "¿Que hice el martes?" no tenia respuesta en la app. Las estadisticas dan el NUMERO de
 * completadas por dia -una barra, un total, una racha- pero no dicen cuales, y un numero
 * no sirve para pasar un reporte, justificar una semana ni recordar donde se quedo uno.
 * Buscar tampoco: filtra por vencimiento, que es cuando algo TOCABA, no cuando se hizo.
 *
 * La diferencia entre esas dos fechas es justo lo que hace falta aqui. Una tarea que
 * vencia el lunes y se cerro el viernes pertenece al viernes en este historial, y al lunes
 * en cualquier vista de agenda. Por eso el filtro por fecha de completado es un criterio
 * propio y no una variante del que ya habia.
 *
 * Se agrupa por el dia LOCAL en que se completo, del mas reciente al mas antiguo.
 */
export const CompletedPage = () => {
  const tasks = useAllTasks();
  const categories = useCategories() ?? [];

  const [preset, setPreset] = useState<RangePreset>('semana');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [categoryIds, setCategoryIds] = useState<readonly CategoryId[]>([]);
  const [priorities, setPriorities] = useState<readonly Priority[]>([]);
  const [onlyImportant, setOnlyImportant] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const [selected, setSelected] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const range = useMemo(() => resolveRange(preset, custom), [preset, custom]);

  const days = useMemo(() => {
    if (tasks === undefined) return [];

    /**
     * Se filtra por `completedAt` y NO por `status`.
     *
     * Archivar una tarea terminada la saca de "completada", pero no deja de ser algo que
     * se hizo ese dia: excluirla vaciaria el historial de cualquiera que ordene archivando
     * lo que ya cerro, que es precisamente quien mas mira esta pantalla.
     */
    const specification = buildTaskFilter({
      ...(range.from === null ? {} : { completedFrom: range.from }),
      ...(range.to === null ? {} : { completedTo: range.to }),
      ...(categoryIds.length > 0 ? { categoryIds } : {}),
      ...(priorities.length > 0 ? { priorities } : {}),
      onlyImportant,
    });

    const done = tasks.filter(
      (task) => task.completedAt !== null && specification.isSatisfiedBy(task),
    );

    return groupByCompletionDay(done);
  }, [tasks, range, categoryIds, priorities, onlyImportant]);

  const total = days.reduce((sum, day) => sum + day.tasks.length, 0);
  const activeFilters = categoryIds.length + priorities.length + (onlyImportant ? 1 : 0);

  const liveSelected = useMemo(
    () => (selected === null ? null : (tasks?.find((task) => task.id === selected.id) ?? selected)),
    [tasks, selected],
  );

  const clearFilters = () => {
    setCategoryIds([]);
    setPriorities([]);
    setOnlyImportant(false);
  };

  /* Generico y no dos funciones casi iguales: la firma obliga a que el valor y la lista
     sean del mismo tipo, asi que no se puede meter una prioridad en las categorias. */
  const toggle = <T,>(value: T, current: readonly T[], set: (next: readonly T[]) => void) => {
    set(current.includes(value) ? current.filter((it) => it !== value) : [...current, value]);
  };

  return (
    <>
      <PageHeader
        title="Completadas"
        subtitle={
          total === 0
            ? 'Nada terminado en este periodo'
            : `${String(total)} ${total === 1 ? 'tarea' : 'tareas'} · ${describeRange(preset, range)}`
        }
        actions={
          <Button
            variant={showFilters || activeFilters > 0 ? 'primary' : 'ghost'}
            size="icon"
            onClick={() => {
              setShowFilters((open) => !open);
            }}
            aria-label="Filtros"
            aria-expanded={showFilters}
          >
            <SlidersHorizontal className="size-4.5" />
            {activeFilters > 0 && (
              <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white">
                {activeFilters}
              </span>
            )}
          </Button>
        }
      >
        <div className="space-y-3">
          {/* Los periodos son el filtro PRINCIPAL, asi que van siempre visibles y no
              escondidos tras el panel: es lo que se toca en cada visita. */}
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Periodo">
            {RANGE_PRESETS.map((option) => (
              <Chip
                key={option.id}
                active={preset === option.id}
                onClick={() => {
                  setPreset(option.id);
                }}
              >
                {option.label}
              </Chip>
            ))}
          </div>

          {preset === 'personalizado' && (
            <div className="flex animate-fade-in flex-wrap items-end gap-3">
              <DayField
                label="Desde"
                value={custom.from}
                onChange={(from) => {
                  setCustom((it) => ({ ...it, from }));
                }}
              />
              <DayField
                label="Hasta"
                value={custom.to}
                onChange={(to) => {
                  setCustom((it) => ({ ...it, to }));
                }}
              />
            </div>
          )}

          {showFilters && (
            <div className="animate-fade-in space-y-3 rounded-xl border border-line bg-panel p-3">
              <FilterRow label="Prioridad">
                {PRIORITIES.map((priority) => (
                  <Chip
                    key={priority}
                    active={priorities.includes(priority)}
                    onClick={() => {
                      toggle(priority, priorities, setPriorities);
                    }}
                  >
                    <Flag className="size-3" />
                    {PRIORITY_LABEL[priority]}
                  </Chip>
                ))}
                <Chip
                  active={onlyImportant}
                  onClick={() => {
                    setOnlyImportant((it) => !it);
                  }}
                >
                  <Star className="size-3" />
                  Destacadas
                </Chip>
              </FilterRow>

              {categories.length > 0 && (
                <FilterRow label="Categoria">
                  {categories.map((category) => (
                    <Chip
                      key={category.id}
                      active={categoryIds.includes(category.id)}
                      onClick={() => {
                        toggle(category.id, categoryIds, setCategoryIds);
                      }}
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: category.color }}
                      />
                      {category.name}
                    </Chip>
                  ))}
                </FilterRow>
              )}

              {activeFilters > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="size-4" />
                  Limpiar filtros
                </Button>
              )}
            </div>
          )}
        </div>
      </PageHeader>

      <PageContent>
        {preset === 'personalizado' && range.from === null && range.to === null ? (
          <EmptyState
            icon={<CalendarCheck />}
            title="Elige las fechas"
            description="Indica desde cuando, hasta cuando, o las dos."
          />
        ) : (
          <CompletionLogList
            days={days}
            onOpenTask={(task) => {
              setSelected(task);
              setDetailOpen(true);
            }}
            emptyTitle="Nada terminado en este periodo"
            emptyDescription={
              activeFilters > 0
                ? 'Prueba con otro periodo o quita algun filtro.'
                : 'Cambia el periodo para mirar mas atras.'
            }
            emptyAction={
              activeFilters > 0 ? (
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              ) : undefined
            }
          />
        )}
      </PageContent>

      <TaskDetailSheet task={liveSelected} open={detailOpen} onOpenChange={setDetailOpen} />
    </>
  );
};

// ---------------------------------------------------------------------------

const DayField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => (
  <label className="flex flex-col gap-1">
    <span className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{label}</span>
    <Input
      type="date"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      className="w-auto"
    />
  </label>
);

const FilterRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <span className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{label}</span>
    <div className="flex flex-wrap gap-1.5">{children}</div>
  </div>
);

const Chip = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1',
      'text-xs font-medium transition-colors',
      'focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
      active ? 'border-transparent bg-brand-600 text-white' : 'border-line text-ink-soft hover:bg-hover',
    )}
  >
    {children}
  </button>
);
