import { BarChart3, CalendarDays, CheckSquare, Inbox, Search, Settings, Timer } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useMemo } from 'react';

import { cn } from '../../shared/lib/cn';
import { isInTodayViewSpec } from '../../domain/task/task-specifications';
import { SyncIndicator } from '../sync-indicator/sync-indicator';
import { useAllTasks } from '../../shared/hooks/use-live-query';

/**
 * Estructura de navegacion.
 *
 * Dos formas segun el ancho: barra lateral en escritorio y barra inferior en el movil.
 * En el telefono la navegacion tiene que estar al alcance del pulgar, no arriba; y en
 * escritorio hay espacio de sobra a la izquierda que no vale la pena desperdiciar.
 *
 * El contador de la vista de Hoy se calcula con la MISMA specification que usa la
 * pantalla, asi que no puede decir "3" mientras la lista enseña cuatro tareas.
 */

interface NavigationEntry {
  to: string;
  label: string;
  icon: typeof Inbox;
  /** Si aparece en la barra inferior del movil (solo caben cinco). */
  primary: boolean;
}

const NAVIGATION: readonly NavigationEntry[] = [
  { to: '/hoy', label: 'Hoy', icon: CheckSquare, primary: true },
  { to: '/proximas', label: 'Proximas', icon: Inbox, primary: true },
  { to: '/calendario', label: 'Calendario', icon: CalendarDays, primary: true },
  { to: '/buscar', label: 'Buscar', icon: Search, primary: true },
  { to: '/enfoque', label: 'Enfoque', icon: Timer, primary: false },
  { to: '/estadisticas', label: 'Estadisticas', icon: BarChart3, primary: false },
  { to: '/ajustes', label: 'Ajustes', icon: Settings, primary: true },
];

export const AppShell = () => {
  const tasks = useAllTasks();
  const location = useLocation();

  const todayCount = useMemo(() => {
    if (tasks === undefined) return 0;
    const spec = isInTodayViewSpec(new Date());
    return tasks.filter((task) => spec.isSatisfiedBy(task)).length;
  }, [tasks]);

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* ---------------- Barra lateral (escritorio) ---------------- */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-panel lg:flex">
        <div className="drag-region flex items-center gap-2.5 px-5 pt-6 pb-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <CheckSquare className="size-4.5" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-semibold tracking-tight text-ink">Checklist</span>
        </div>

        <nav className="flex-1 space-y-0.5 px-3" aria-label="Navegacion principal">
          {NAVIGATION.map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                    : 'text-ink-soft hover:bg-hover hover:text-ink',
                )
              }
            >
              <entry.icon className="size-4.5 shrink-0" />
              <span className="flex-1">{entry.label}</span>
              {entry.to === '/hoy' && todayCount > 0 && (
                <span className="rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white tabular-nums">
                  {todayCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-line p-3">
          <SyncIndicator />
        </div>
      </aside>

      {/* ---------------- Contenido ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1">
          {/* `key` fuerza el remontaje al cambiar de ruta: reinicia el scroll y el
              estado interno de cada pantalla, en vez de arrastrarlo entre vistas. */}
          <Outlet key={location.pathname} />
        </main>
      </div>

      {/* ---------------- Barra inferior (movil) ---------------- */}
      <nav
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 backdrop-blur-lg',
          'pb-safe lg:hidden',
        )}
        aria-label="Navegacion principal"
      >
        <div className="flex items-stretch justify-around">
          {NAVIGATION.filter((entry) => entry.primary).map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              className={({ isActive }) =>
                cn(
                  'relative flex flex-1 flex-col items-center gap-0.5 py-2.5',
                  'text-[10px] font-medium transition-colors',
                  isActive ? 'text-brand-600 dark:text-brand-400' : 'text-ink-muted',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <entry.icon className="size-5.5" strokeWidth={isActive ? 2.4 : 2} />
                    {entry.to === '/hoy' && todayCount > 0 && (
                      <span
                        className={cn(
                          'absolute -top-1 -right-2 min-w-4 rounded-full bg-brand-600 px-1',
                          'text-[9px] leading-4 font-bold text-white tabular-nums',
                        )}
                      >
                        {todayCount > 99 ? '99+' : todayCount}
                      </span>
                    )}
                  </span>
                  {entry.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
};
