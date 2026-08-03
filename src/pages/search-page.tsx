import { Flag, Search, SlidersHorizontal, Star, X } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';

import type { Task } from '../domain/task/task';

import { buildTaskFilter } from '../domain/task/task-specifications';
import { Button } from '../shared/ui/button';
import { cn } from '../shared/lib/cn';
import { EmptyState } from '../shared/ui/feedback';
import { Input } from '../shared/ui/form-controls';
import { PageContent, PageHeader } from '../shared/ui/layout';
import { PRIORITIES, PRIORITY_LABEL } from '../domain/task/value-objects/priority';
import { TaskDetailSheet } from '../features/task-detail/task-detail-sheet';
import { TaskList } from '../features/task-list/task-list';
import { useAllTasks, useCategories, useTags } from '../shared/hooks/use-live-query';
import { useFilters } from '../shared/stores/filter-store';

/**
 * Busqueda y filtros combinados.
 *
 * El texto se difiere con `useDeferredValue`: React sigue pintando cada pulsacion en
 * el campo mientras recalcula la lista con menos prioridad. Con cientos de tareas eso
 * es la diferencia entre escribir con fluidez y escribir a tirones.
 */
export const SearchPage = () => {
  const tasks = useAllTasks();
  const categories = useCategories() ?? [];
  const tags = useTags() ?? [];

  const filters = useFilters();
  const deferredQuery = useDeferredValue(filters.query);

  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const results = useMemo(() => {
    if (tasks === undefined) return [];

    const specification = buildTaskFilter({
      query: deferredQuery,
      categoryIds: filters.categoryIds,
      tagIds: filters.tagIds,
      priorities: filters.priorities,
      onlyImportant: filters.onlyImportant,
      onlyOverdue: filters.onlyOverdue,
    });

    return tasks.filter((task) => specification.isSatisfiedBy(task));
  }, [
    tasks,
    deferredQuery,
    filters.categoryIds,
    filters.tagIds,
    filters.priorities,
    filters.onlyImportant,
    filters.onlyOverdue,
  ]);

  const hasFilters = filters.hasActiveFilters();
  const activeCount =
    filters.categoryIds.length +
    filters.tagIds.length +
    filters.priorities.length +
    (filters.onlyImportant ? 1 : 0) +
    (filters.onlyOverdue ? 1 : 0);

  const liveSelected = useMemo(
    () => (selected === null ? null : (tasks?.find((task) => task.id === selected.id) ?? selected)),
    [tasks, selected],
  );

  return (
    <>
      <PageHeader
        title="Buscar"
        actions={
          <Button
            variant={showFilters || activeCount > 0 ? 'primary' : 'ghost'}
            size="icon"
            onClick={() => setShowFilters((open) => !open)}
            aria-label="Filtros"
            aria-expanded={showFilters}
          >
            <SlidersHorizontal className="size-4.5" />
            {activeCount > 0 && (
              <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white">
                {activeCount}
              </span>
            )}
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              value={filters.query}
              onChange={(event) => filters.setQuery(event.target.value)}
              placeholder="Buscar en titulos, notas y subtareas..."
              className="pr-9 pl-9"
              type="search"
              autoFocus
              aria-label="Buscar tareas"
            />
            {filters.query.length > 0 && (
              <button
                type="button"
                onClick={() => filters.setQuery('')}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-ink-muted hover:text-ink"
                aria-label="Limpiar busqueda"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {showFilters && (
            <div className="animate-fade-in space-y-3 rounded-xl border border-line bg-panel p-3">
              <FilterRow label="Prioridad">
                {PRIORITIES.map((priority) => (
                  <Chip
                    key={priority}
                    active={filters.priorities.includes(priority)}
                    onClick={() => filters.togglePriority(priority)}
                  >
                    <Flag className="size-3" />
                    {PRIORITY_LABEL[priority]}
                  </Chip>
                ))}
                <Chip
                  active={filters.onlyImportant}
                  onClick={() => filters.setOnlyImportant(!filters.onlyImportant)}
                >
                  <Star className="size-3" />
                  Destacadas
                </Chip>
                <Chip
                  active={filters.onlyOverdue}
                  onClick={() => filters.setOnlyOverdue(!filters.onlyOverdue)}
                >
                  Atrasadas
                </Chip>
              </FilterRow>

              {categories.length > 0 && (
                <FilterRow label="Categoria">
                  {categories.map((category) => (
                    <Chip
                      key={category.id}
                      active={filters.categoryIds.includes(category.id)}
                      onClick={() => filters.toggleCategory(category.id)}
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

              {tags.length > 0 && (
                <FilterRow label="Etiquetas">
                  {tags.map((tag) => (
                    <Chip
                      key={tag.id}
                      active={filters.tagIds.includes(tag.id)}
                      onClick={() => filters.toggleTag(tag.id)}
                    >
                      {tag.name}
                    </Chip>
                  ))}
                </FilterRow>
              )}

              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={filters.clear}>
                  <X className="size-4" />
                  Limpiar filtros
                </Button>
              )}
            </div>
          )}
        </div>
      </PageHeader>

      <PageContent>
        {!hasFilters ? (
          <EmptyState
            icon={<Search />}
            title="Busca entre todas tus tareas"
            description="Escribe arriba o abre los filtros para acotar por categoria, etiqueta o prioridad."
          />
        ) : (
          <>
            <p className="px-1 pb-2 text-xs text-ink-muted">
              {results.length} {results.length === 1 ? 'resultado' : 'resultados'}
            </p>

            <TaskList
              tasks={results}
              sortMode="smart"
              showCompleted
              showArchived
              onOpenTask={(task) => {
                setSelected(task);
                setDetailOpen(true);
              }}
              emptyTitle="Sin resultados"
              emptyDescription="Prueba con otras palabras o quita algun filtro."
              emptyAction={
                <Button variant="secondary" size="sm" onClick={filters.clear}>
                  Limpiar filtros
                </Button>
              }
            />
          </>
        )}
      </PageContent>

      <TaskDetailSheet task={liveSelected} open={detailOpen} onOpenChange={setDetailOpen} />
    </>
  );
};

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
      active
        ? 'border-transparent bg-brand-600 text-white'
        : 'border-line text-ink-soft hover:bg-hover',
    )}
  >
    {children}
  </button>
);
