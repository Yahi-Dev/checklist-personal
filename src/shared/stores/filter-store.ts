import { create } from 'zustand';

import type { CategoryId, TagId } from '../../domain/shared/branded';
import type { Priority } from '../../domain/task/value-objects/priority';

/**
 * Filtros activos de la vista de lista.
 *
 * Estado EFIMERO: no se persiste. Volver a abrir la app con los filtros de anteayer
 * puestos hace que la vista de Hoy parezca vacia y es una fuente clasica de "la app
 * perdio mis tareas".
 */
export interface FilterState {
  query: string;
  categoryIds: CategoryId[];
  tagIds: TagId[];
  priorities: Priority[];
  onlyImportant: boolean;
  onlyOverdue: boolean;

  setQuery: (query: string) => void;
  toggleCategory: (id: CategoryId) => void;
  toggleTag: (id: TagId) => void;
  togglePriority: (priority: Priority) => void;
  setOnlyImportant: (value: boolean) => void;
  setOnlyOverdue: (value: boolean) => void;
  clear: () => void;
  /** `true` si hay algun filtro puesto: la interfaz muestra el boton de limpiar. */
  hasActiveFilters: () => boolean;
}

const toggle = <T>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

const EMPTY = {
  query: '',
  categoryIds: [] as CategoryId[],
  tagIds: [] as TagId[],
  priorities: [] as Priority[],
  onlyImportant: false,
  onlyOverdue: false,
};

export const useFilters = create<FilterState>()((set, get) => ({
  ...EMPTY,

  setQuery: (query) => set({ query }),
  toggleCategory: (id) => set((state) => ({ categoryIds: toggle(state.categoryIds, id) })),
  toggleTag: (id) => set((state) => ({ tagIds: toggle(state.tagIds, id) })),
  togglePriority: (priority) =>
    set((state) => ({ priorities: toggle(state.priorities, priority) })),
  setOnlyImportant: (onlyImportant) => set({ onlyImportant }),
  setOnlyOverdue: (onlyOverdue) => set({ onlyOverdue }),
  clear: () => set(EMPTY),

  hasActiveFilters: () => {
    const state = get();
    return (
      state.query.trim().length > 0 ||
      state.categoryIds.length > 0 ||
      state.tagIds.length > 0 ||
      state.priorities.length > 0 ||
      state.onlyImportant ||
      state.onlyOverdue
    );
  },
}));
