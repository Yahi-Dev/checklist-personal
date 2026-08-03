import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import { lazy, Suspense } from 'react';

import { AppShell } from '../../widgets/app-shell/app-shell';
import { Button } from '../../shared/ui/button';
import { EmptyState, TaskListSkeleton } from '../../shared/ui/feedback';
import { LoginPage } from '../../pages/login-page';
import { PageContent } from '../../shared/ui/layout';
import { Spinner } from '../../shared/ui/button';
import { TodayPage } from '../../pages/today-page';
import { useAuth } from '../providers/auth-provider';

/**
 * Enrutado con hash (`#/hoy`).
 *
 * Elegido a proposito y no por comodidad: dentro de Electron la app se sirve por
 * `file://`, donde el enrutado por rutas normales de la History API no funciona. En
 * GitHub Pages tampoco hay servidor que reescriba las rutas, asi que recargar en
 * `/calendario` daria un 404. El hash resuelve las dos cosas con la misma solucion.
 *
 * Solo la pantalla de Hoy se carga de entrada. El resto llega por `lazy`: el arranque
 * es lo unico que el usuario espera mirando, y no tiene por que esperar a que
 * descarguen los graficos de estadisticas que quiza no abra hoy.
 */

const UpcomingPage = lazy(() =>
  import('../../pages/upcoming-page').then((module) => ({ default: module.UpcomingPage })),
);
const CalendarPage = lazy(() =>
  import('../../pages/calendar-page').then((module) => ({ default: module.CalendarPage })),
);
const SearchPage = lazy(() =>
  import('../../pages/search-page').then((module) => ({ default: module.SearchPage })),
);
const StatsPage = lazy(() =>
  import('../../pages/stats-page').then((module) => ({ default: module.StatsPage })),
);
const FocusPage = lazy(() =>
  import('../../pages/focus-page').then((module) => ({ default: module.FocusPage })),
);
const SettingsPage = lazy(() =>
  import('../../pages/settings-page').then((module) => ({ default: module.SettingsPage })),
);

const RouteFallback = () => (
  <PageContent>
    <TaskListSkeleton count={5} />
  </PageContent>
);

const withSuspense = (element: React.ReactNode) => (
  <Suspense fallback={<RouteFallback />}>{element}</Suspense>
);

const NotFoundPage = () => (
  <PageContent>
    <EmptyState
      title="Esta pagina no existe"
      description="Puede que el enlace este mal o que la pantalla se haya movido."
      action={
        <Button asChild variant="primary">
          <a href="#/hoy">Ir a Hoy</a>
        </Button>
      }
    />
  </PageContent>
);

const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/hoy" replace /> },
      { path: 'hoy', element: <TodayPage /> },
      { path: 'proximas', element: withSuspense(<UpcomingPage />) },
      { path: 'calendario', element: withSuspense(<CalendarPage />) },
      { path: 'buscar', element: withSuspense(<SearchPage />) },
      { path: 'enfoque', element: withSuspense(<FocusPage />) },
      { path: 'estadisticas', element: withSuspense(<StatsPage />) },
      { path: 'ajustes', element: withSuspense(<SettingsPage />) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export const AppRouter = () => {
  const { user, isLoading, isCloudEnabled } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas">
        <Spinner className="size-6 text-brand-500" />
      </div>
    );
  }

  // Sin nube no hay a quien autenticar: se entra directo en modo local.
  if (user === null && isCloudEnabled) {
    return <LoginPage />;
  }

  return <RouterProvider router={router} />;
};
