import { createHashRouter, Navigate, RouterProvider, useRouteError } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';

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

const AssistantPage = lazy(() =>
  import('../../pages/assistant-page').then((module) => ({ default: module.AssistantPage })),
);
const UpcomingPage = lazy(() =>
  import('../../pages/upcoming-page').then((module) => ({ default: module.UpcomingPage })),
);
const CalendarPage = lazy(() =>
  import('../../pages/calendar-page').then((module) => ({ default: module.CalendarPage })),
);
const SearchPage = lazy(() =>
  import('../../pages/search-page').then((module) => ({ default: module.SearchPage })),
);
const CompletedPage = lazy(() =>
  import('../../pages/completed-page').then((module) => ({ default: module.CompletedPage })),
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

/**
 * Reconoce el fallo de "el trozo de JavaScript que pedia ya no existe".
 *
 * Cada navegador lo redacta a su manera y ninguno expone un codigo, asi que hay que ir
 * por el texto. Es fragil por naturaleza, pero el precio de no acertar es solo enseñar
 * el error en vez de recargar; nunca hace nada peor.
 */
const isStaleChunkError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);

  return /importing a module script failed|dynamically imported module|chunkloaderror|failed to fetch/i.test(
    message,
  );
};

/** Marca en la pestaña que ya se intento recargar, para no entrar en bucle. */
const RELOAD_ATTEMPT_KEY = 'checklist.recarga-por-version-vieja';

/**
 * Que hacer cuando una pantalla no se puede ni cargar.
 *
 * El caso real que motiva esto: la app instalada en el movil quedo con codigo viejo tras
 * un despliegue, pidio un archivo que ya no existia y react-router enseño su pantalla de
 * error de fabrica -en ingles, hablandole al desarrollador y sin salida-. Para el usuario
 * eso es una app rota sin nada que pulsar.
 *
 * Ante ese fallo concreto se recarga UNA vez y sola: al recargar entra el index.html
 * nuevo con los archivos nuevos, que es exactamente la cura. La marca en `sessionStorage`
 * evita el bucle infinito si la recarga no arregla nada, y ahi si se enseña algo con lo
 * que el usuario pueda seguir.
 */
const RouteErrorBoundary = () => {
  const error = useRouteError();
  const stale = isStaleChunkError(error);

  const alreadyTried =
    typeof sessionStorage === 'undefined'
      ? true
      : sessionStorage.getItem(RELOAD_ATTEMPT_KEY) !== null;

  useEffect(() => {
    if (!stale || alreadyTried) return;

    sessionStorage.setItem(RELOAD_ATTEMPT_KEY, '1');
    globalThis.location.reload();
  }, [stale, alreadyTried]);

  if (stale && !alreadyTried) {
    return (
      <PageContent>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Spinner className="size-6 text-brand-500" />
          <p className="text-sm text-ink-soft">Actualizando a la version nueva…</p>
        </div>
      </PageContent>
    );
  }

  return (
    <PageContent>
      <EmptyState
        title={stale ? 'Hay que recargar la app' : 'Algo se rompio en esta pantalla'}
        description={
          stale
            ? 'Tu copia se quedo en una version anterior. Cierra la app del todo y vuelve a abrirla; si sigue igual, quitala de la pantalla de inicio y añadela otra vez.'
            : 'El resto de la app sigue funcionando. Si se repite, recarga.'
        }
        action={
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={() => {
                sessionStorage.removeItem(RELOAD_ATTEMPT_KEY);
                globalThis.location.reload();
              }}
            >
              Recargar
            </Button>
            <Button asChild variant="secondary">
              <a href="#/hoy">Ir a Hoy</a>
            </Button>
          </div>
        }
      />
    </PageContent>
  );
};

const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    // Sin esto, cualquier fallo al cargar una pantalla acaba en la pantalla de error de
    // fabrica de react-router, que le habla al desarrollador y no ofrece salida alguna.
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <Navigate to="/hoy" replace /> },
      { path: 'hoy', element: <TodayPage /> },
      { path: 'proximas', element: withSuspense(<UpcomingPage />) },
      { path: 'calendario', element: withSuspense(<CalendarPage />) },
      { path: 'asistente', element: withSuspense(<AssistantPage />) },
      { path: 'buscar', element: withSuspense(<SearchPage />) },
      { path: 'completadas', element: withSuspense(<CompletedPage />) },
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
      <div className="flex min-h-dvh items-center justify-center">
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
