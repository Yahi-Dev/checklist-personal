import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';

import { AppProviders } from './providers/app-providers';
import { AppRouter } from './router/app-router';
import { Button } from '../shared/ui/button';
import { desktopBridge } from '../shared/desktop-bridge';
import { getContainer } from '../infrastructure/di/container';
import { isInTodayViewSpec } from '../domain/task/task-specifications';
import { useAllTasks } from '../shared/hooks/use-live-query';
import { usePreferences } from '../shared/stores/preferences-store';

/**
 * Raiz de la aplicacion.
 */
export const App = () => (
  <AppErrorBoundary>
    <AppProviders>
      <DesktopIntegration />
      <AppRouter />
    </AppProviders>
  </AppErrorBoundary>
);

/**
 * Puentes con el escritorio: contador en el icono y eventos del proceso principal.
 *
 * Va como componente sin interfaz porque necesita los hooks de datos. Se monta dentro
 * de los proveedores para que `useAllTasks` tenga la base disponible.
 */
const DesktopIntegration = () => {
  const tasks = useAllTasks();
  const showBadge = usePreferences((state) => state.showBadgeCount);
  const container = getContainer();

  // Contador de la barra de tareas con lo que toca hoy.
  useEffect(() => {
    const bridge = desktopBridge();
    if (bridge === null || tasks === undefined) return;

    const count = showBadge
      ? tasks.filter((task) => isInTodayViewSpec(new Date()).isSatisfiedBy(task)).length
      : 0;

    void bridge.window.setBadge({ count });
  }, [tasks, showBadge]);

  // Navegacion disparada desde el proceso principal: al pulsar una notificacion o al
  // usar el menu de la bandeja del sistema.
  useEffect(() => {
    const bridge = desktopBridge();
    if (bridge === null) return;

    const unsubscribeNavigate = bridge.on.navigate((route) => {
      window.location.hash = route.startsWith('#') ? route : `#${route}`;
    });

    const unsubscribeNotification = bridge.on.notificationClicked((taskId) => {
      window.location.hash = `#/hoy?tarea=${taskId}`;
    });

    return () => {
      unsubscribeNavigate();
      unsubscribeNotification();
    };
  }, []);

  // Reconstruye los recordatorios al arrancar: los temporizadores no sobreviven a un
  // cierre de la app, asi que hay que volver a programarlos desde los datos.
  useEffect(() => {
    void container.context.reminders.rebuildAll();
  }, [container]);

  return null;
};

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Ultima red de seguridad.
 *
 * Sin esto, un fallo al renderizar deja una pantalla en blanco sin explicacion ni
 * salida. Aqui al menos se ve que paso y hay un boton para recargar. Los datos siguen
 * a salvo en IndexedDB: un error de interfaz nunca los toca.
 */
class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app] fallo al renderizar', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-ink">Algo se rompio</h1>
          <p className="max-w-sm text-sm text-balance text-ink-soft">
            Tus tareas estan a salvo en este dispositivo. Recarga para volver a intentarlo.
          </p>
        </div>

        <pre className="max-w-md overflow-auto rounded-lg bg-sunken p-3 text-left text-xs text-ink-muted">
          {this.state.error.message}
        </pre>

        <Button variant="primary" onClick={() => window.location.reload()}>
          Recargar
        </Button>
      </div>
    );
  }
}
