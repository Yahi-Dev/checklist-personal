import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { useState, type ReactNode } from 'react';

import { AuthProvider } from './auth-provider';
import { SyncProvider } from './sync-provider';
import { ThemeProvider } from './theme-provider';
import { usePreferences } from '../../shared/stores/preferences-store';

/**
 * Composicion de proveedores.
 *
 * El orden importa: `Sync` necesita saber quien es el usuario, asi que va DENTRO de
 * `Auth`. Un orden distinto arrancaria el motor de sincronizacion sin `userId` y las
 * subidas se rechazarian.
 */
export const AppProviders = ({ children }: { children: ReactNode }) => {
  /**
   * El cliente se crea con `useState` y no como constante de modulo: en desarrollo con
   * React Strict Mode, un cliente de modulo sobrevive a los remontajes y conserva cache
   * de la sesion anterior tras cerrar sesion.
   */
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Los datos vienen de IndexedDB via useLiveQuery, que ya es reactivo.
            // React Query solo se usa para lo que si es asincrono y remoto.
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={400} skipDelayDuration={200}>
          <AuthProvider>
            <SyncProvider>
              {children}
              <AppToaster />
            </SyncProvider>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

/**
 * Avisos emergentes.
 *
 * Es la pieza que hace posible el "deshacer" al completar una tarea: en vez de pedir
 * confirmacion antes de cada accion -que interrumpe- se ejecuta al momento y se ofrece
 * revertir durante unos segundos. Menos friccion y ningun cambio irreversible.
 */
const AppToaster = () => {
  const theme = usePreferences((state) => state.theme);

  return (
    <Toaster
      position="bottom-center"
      theme={theme}
      closeButton
      richColors={false}
      duration={5000}
      // Deja hueco sobre la barra de navegacion movil y sobre el indicador del iPhone.
      offset="calc(5rem + env(safe-area-inset-bottom, 0px))"
      mobileOffset="calc(5rem + env(safe-area-inset-bottom, 0px))"
      toastOptions={{
        classNames: {
          toast: 'group rounded-xl border border-line bg-panel text-ink shadow-overlay text-sm',
          description: 'text-ink-soft',
          actionButton: 'bg-brand-600 text-white rounded-lg px-2.5 py-1 text-xs font-medium',
          cancelButton: 'bg-sunken text-ink-soft rounded-lg px-2.5 py-1 text-xs',
        },
      }}
    />
  );
};
