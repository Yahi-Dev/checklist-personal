import {
  BarChart3,
  CalendarCheck,
  CalendarDays,
  CheckSquare,
  Inbox,
  Search,
  Settings,
  Sparkles,
  Timer,
} from 'lucide-react';
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
 *
 * El fondo del shell es TRANSPARENTE a proposito: el color del lienzo lo pinta el
 * body, y la aurora ambiental (body::before) se transparenta por las zonas de
 * contenido. Un `bg-canvas` opaco aqui la taparia entera.
 */

interface NavigationEntry {
  to: string;
  label: string;
  icon: typeof Inbox;
  /** Si aparece en la barra inferior del movil (solo caben cinco). */
  primary: boolean;
}

/**
 * En la barra inferior del movil solo caben cinco destinos, asi que cada uno que entra
 * saca a otro. El asistente entra y el calendario pasa a la lateral: la pregunta "¿por
 * donde empiezo?" se hace varias veces al dia y desde el telefono, mientras que la
 * vista de mes se consulta de vez en cuando y casi siempre sentado.
 */
const NAVIGATION: readonly NavigationEntry[] = [
  { to: '/hoy', label: 'Hoy', icon: CheckSquare, primary: true },
  { to: '/asistente', label: 'Asistente', icon: Sparkles, primary: true },
  { to: '/proximas', label: 'Proximas', icon: Inbox, primary: true },
  { to: '/buscar', label: 'Buscar', icon: Search, primary: true },
  { to: '/calendario', label: 'Calendario', icon: CalendarDays, primary: false },
  // Secundaria y no en la barra inferior: se consulta -al cerrar la semana, al pasar un
  // reporte-, no se vive en ella. La barra movil solo tiene sitio para lo del dia a dia.
  { to: '/completadas', label: 'Completadas', icon: CalendarCheck, primary: false },
  { to: '/enfoque', label: 'Enfoque', icon: Timer, primary: false },
  { to: '/estadisticas', label: 'Estadisticas', icon: BarChart3, primary: false },
  { to: '/ajustes', label: 'Ajustes', icon: Settings, primary: true },
];

const PRIMARY_NAVIGATION = NAVIGATION.filter((entry) => entry.primary);

export const AppShell = () => {
  const tasks = useAllTasks();
  const location = useLocation();

  const todayCount = useMemo(() => {
    if (tasks === undefined) return 0;
    const spec = isInTodayViewSpec(new Date());
    return tasks.filter((task) => spec.isSatisfiedBy(task)).length;
  }, [tasks]);

  /**
   * Indice del destino activo en la barra inferior. Alimenta la pildora deslizante:
   * en vez de que cada pestaña encienda su propio fondo, UNA pildora viaja de un
   * destino al siguiente con un resorte. Es el detalle que hace la navegacion viva.
   * -1 cuando la ruta activa no esta en la barra (ej. /enfoque desde escritorio).
   */
  const activeMobileIndex = PRIMARY_NAVIGATION.findIndex((entry) =>
    location.pathname.startsWith(entry.to),
  );

  return (
    <div className="flex min-h-dvh">
      {/* ---------------- Barra lateral (escritorio) ---------------- */}
      {/* `sticky top-0 h-dvh`: la barra se queda quieta mientras el contenido pasa por
          debajo. Sin esto se desplaza con la pagina, y con una lista larga los destinos
          se van por arriba de la pantalla: la navegacion desaparece justo cuando mas se
          necesita, que es cuando hay mucho que mirar. La altura fija es lo que permite
          ademas que la lista de destinos tenga su propio scroll si algun dia no cabe. */}
      <aside
        className={cn(
          'hidden w-60 shrink-0 flex-col border-r border-line/70 bg-panel/70 backdrop-blur-xl',
          'sticky top-0 h-dvh lg:flex',
        )}
      >
        <div className="drag-region flex items-center gap-2.5 px-5 pt-6 pb-4">
          <div className="bg-brand-gradient flex size-8 items-center justify-center rounded-xl text-white shadow-soft">
            <CheckSquare className="size-4.5" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-semibold tracking-tight text-ink">Checklist</span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Navegacion principal">
          {NAVIGATION.map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium',
                  'transition-colors duration-200',
                  isActive
                    ? cn(
                        // Tinte crepuscular, no plano: celeste que muere en morado,
                        // como todos los remates de marca de la app.
                        'bg-linear-to-r from-brand-600/12 to-accent-600/8 text-brand-700',
                        'dark:from-brand-400/12 dark:to-accent-400/8 dark:text-brand-300',
                      )
                    : 'text-ink-soft hover:bg-hover hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* Testigo lateral del destino activo. */}
                  {isActive && (
                    <span
                      className="absolute top-1/2 left-0 h-4 w-1 -translate-y-1/2 animate-fade-in rounded-full bg-brand-500"
                      aria-hidden="true"
                    />
                  )}
                  <entry.icon className="size-4.5 shrink-0" />
                  <span className="flex-1">{entry.label}</span>
                  {entry.to === '/hoy' && todayCount > 0 && (
                    // `key` remonta el badge cuando cambia la cifra: el pop avisa del cambio.
                    <span
                      key={todayCount}
                      className="animate-pop rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white tabular-nums"
                    >
                      {todayCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-line/70 p-3">
          <SyncIndicator />
        </div>
      </aside>

      {/* ---------------- Contenido ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Columna flexible para que una pantalla pueda pedir la altura entera con
            `flex-1` (lo hace el asistente, que necesita anclar su compositor abajo).
            Las demas no declaran nada y se siguen apilando desde arriba igual. */}
        <main className="flex min-h-0 flex-1 flex-col">
          {/* `key` fuerza el remontaje al cambiar de ruta: reinicia el scroll y el
              estado interno de cada pantalla, en vez de arrastrarlo entre vistas. */}
          <Outlet key={location.pathname} />
        </main>
      </div>

      {/* ---------------- Barra inferior (movil) ---------------- */}
      <nav
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-panel/90 backdrop-blur-xl',
          'pb-safe lg:hidden',
        )}
        aria-label="Navegacion principal"
      >
        <div className="relative flex items-stretch justify-around">
          {/* La pildora deslizante. Ocupa exactamente un quinto y viaja por transform,
              que anima en el compositor sin relayout. Decorativa: los lectores de
              pantalla ya tienen aria-current en el NavLink activo. */}
          {activeMobileIndex >= 0 && (
            <span
              className="pointer-events-none absolute inset-y-0 left-0 transition-transform duration-300 ease-spring"
              style={{
                width: `${100 / PRIMARY_NAVIGATION.length}%`,
                transform: `translateX(${activeMobileIndex * 100}%)`,
              }}
              aria-hidden="true"
            >
              <span className="absolute inset-x-2 inset-y-1.5 rounded-2xl bg-linear-to-r from-brand-600/12 to-accent-600/10 dark:from-brand-400/15 dark:to-accent-400/12" />
            </span>
          )}

          {PRIMARY_NAVIGATION.map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              className={({ isActive }) =>
                cn(
                  'relative flex flex-1 flex-col items-center gap-0.5 py-2.5',
                  'text-[10px] font-medium transition-colors duration-200',
                  isActive ? 'text-brand-600 dark:text-brand-300' : 'text-ink-muted',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'relative transition-transform duration-300 ease-spring',
                      isActive && '-translate-y-px',
                    )}
                  >
                    <entry.icon className="size-5.5" strokeWidth={isActive ? 2.4 : 2} />
                    {entry.to === '/hoy' && todayCount > 0 && (
                      <span
                        key={todayCount}
                        className={cn(
                          'absolute -top-1 -right-2 min-w-4 animate-pop rounded-full bg-brand-600 px-1',
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
