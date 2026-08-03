import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { FocusSettings } from '../../domain/focus/focus-session';
import type { SortMode } from '../../domain/task/task-sorting';

import { DEFAULT_FOCUS_SETTINGS } from '../../domain/focus/focus-session';

/**
 * Preferencias del usuario, persistidas en localStorage.
 *
 * NO van a la base de datos ni se sincronizan a proposito: son ajustes de ESTE
 * dispositivo. El tema oscuro que quieres en la computadora por la noche no tiene por
 * que ser el del telefono, y sincronizarlos produciria cambios sorpresa a media tarde.
 *
 * localStorage y no IndexedDB porque hace falta leerlas de forma SINCRONA en el primer
 * render: el tema tiene que aplicarse antes de pintar o se ve un destello blanco.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

export interface PreferencesState {
  theme: ThemeMode;
  /** Ordenacion por defecto de las listas. */
  sortMode: SortMode;
  /** Mostrar las completadas dentro de la lista, en gris. */
  showCompleted: boolean;
  /** Agrupar por categoria en las vistas de lista. */
  groupByCategory: boolean;
  /** Numero de tareas de hoy en el icono de la barra de tareas. */
  showBadgeCount: boolean;
  focusSettings: FocusSettings;
  /** Ya se pidio permiso de notificaciones: no volver a preguntar sin motivo. */
  notificationsRequested: boolean;
  /** Se cerro el aviso de "añade la app a la pantalla de inicio". */
  installPromptDismissed: boolean;
  /** Minutos de antelacion del recordatorio automatico al poner una hora. */
  defaultReminderLeadMinutes: number;

  setTheme: (theme: ThemeMode) => void;
  setSortMode: (mode: SortMode) => void;
  toggleShowCompleted: () => void;
  toggleGroupByCategory: () => void;
  setShowBadgeCount: (value: boolean) => void;
  setFocusSettings: (settings: Partial<FocusSettings>) => void;
  markNotificationsRequested: () => void;
  dismissInstallPrompt: () => void;
  setDefaultReminderLead: (minutes: number) => void;
  reset: () => void;
}

const INITIAL = {
  theme: 'system' as ThemeMode,
  sortMode: 'smart' as SortMode,
  showCompleted: false,
  groupByCategory: false,
  showBadgeCount: true,
  focusSettings: DEFAULT_FOCUS_SETTINGS,
  notificationsRequested: false,
  installPromptDismissed: false,
  defaultReminderLeadMinutes: 10,
};

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      ...INITIAL,

      setTheme: (theme) => set({ theme }),
      setSortMode: (sortMode) => set({ sortMode }),
      toggleShowCompleted: () => set((state) => ({ showCompleted: !state.showCompleted })),
      toggleGroupByCategory: () => set((state) => ({ groupByCategory: !state.groupByCategory })),
      setShowBadgeCount: (showBadgeCount) => set({ showBadgeCount }),

      setFocusSettings: (settings) =>
        set((state) => ({ focusSettings: { ...state.focusSettings, ...settings } })),

      markNotificationsRequested: () => set({ notificationsRequested: true }),
      dismissInstallPrompt: () => set({ installPromptDismissed: true }),
      setDefaultReminderLead: (defaultReminderLeadMinutes) => set({ defaultReminderLeadMinutes }),

      reset: () => set(INITIAL),
    }),
    {
      name: 'checklist-personal.preferences',
      version: 1,
      /**
       * Al añadir un ajuste nuevo, las preferencias ya guardadas no lo tienen. Sin
       * este merge, `focusSettings.focusMinutes` llegaria como `undefined` y el
       * temporizador arrancaria en NaN.
       */
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<PreferencesState>),
        focusSettings: {
          ...DEFAULT_FOCUS_SETTINGS,
          ...((persisted as Partial<PreferencesState>)?.focusSettings ?? {}),
        },
      }),
    },
  ),
);
