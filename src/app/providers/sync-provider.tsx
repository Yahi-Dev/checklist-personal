import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { SyncState } from '../../application/ports/services';

import { appConfig } from '../../shared/config/app-config';
import { getContainer } from '../../infrastructure/di/container';
import { useAuth } from './auth-provider';
import { usePendingOutboxCount } from '../../shared/hooks/use-live-query';

interface SyncContextValue {
  readonly state: SyncState;
  readonly syncNow: () => void;
  readonly fullResync: () => Promise<void>;
  readonly isOnline: boolean;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/**
 * Decide CUANDO sincronizar.
 *
 * El motor sabe COMO; aqui estan los disparadores, y estan elegidos para cubrir los
 * momentos en que de verdad importa:
 *
 *   - Vuelve la conexion   -> sube lo que se acumulo sin señal.
 *   - La pestaña se activa -> el caso mas frecuente: dejas el telefono, vuelves a la
 *                             computadora y quieres ver lo que marcaste alla.
 *   - Cada N minutos       -> red de seguridad por si Realtime perdio algun evento.
 *   - Antes de cerrar      -> ultimo intento de vaciar la cola.
 *
 * No se sincroniza en cada escritura: eso convertiria una racha de cinco tareas
 * seguidas en cinco viajes a la red. La cola ya garantiza que nada se pierde mientras
 * tanto.
 */
export const SyncProvider = ({ children }: { children: ReactNode }) => {
  const container = getContainer();
  const { user } = useAuth();

  const [state, setState] = useState<SyncState>(container.sync.getState());
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => container.sync.subscribe(setState), [container]);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      void container.sync.sync();
    };
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [container]);

  useEffect(() => {
    if (user === null) return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') void container.sync.sync();
    };

    document.addEventListener('visibilitychange', onVisible);

    const interval = window.setInterval(
      () => void container.sync.sync(),
      Math.max(1, appConfig.sync.intervalMinutes) * 60_000,
    );

    // `pagehide` y no `beforeunload`: en iOS `beforeunload` no se dispara de forma
    // fiable al cambiar de app, y ese es justo el momento en que hay que vaciar la cola.
    const onLeaving = () => void container.sync.sync();
    window.addEventListener('pagehide', onLeaving);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onLeaving);
      window.clearInterval(interval);
    };
  }, [container, user]);

  /**
   * Sincronizar poco despues de escribir.
   *
   * Faltaba, y era la diferencia entre una app que se siente conectada y una que parece
   * rota: se creaba una tarea, se abria Supabase, no habia nada, y la explicacion -"en
   * cinco minutos aparece"- no la sabe nadie desde fuera.
   *
   * Con un respiro de dos segundos, no en cada escritura: apuntar cinco tareas seguidas
   * es UN viaje a la red, no cinco. El contador de la cola es una consulta viva, asi que
   * cada escritura reinicia la espera sola.
   *
   * No entra en bucle: al vaciarse la cola el contador baja a cero y esta rama sale
   * antes de programar nada. Si la subida falla, el contador no cambia y tampoco se
   * reprograma; de reintentar ya se encargan el intervalo y los demas disparadores.
   */
  const pending = usePendingOutboxCount();

  useEffect(() => {
    if (user === null || pending === 0) return;

    const timer = window.setTimeout(() => void container.sync.sync(), 2000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [container, user, pending]);

  const value = useMemo<SyncContextValue>(
    () => ({
      state,
      isOnline,
      syncNow: () => void container.sync.sync(),
      fullResync: async () => {
        await container.sync.fullResync();
      },
    }),
    [state, isOnline, container],
  );

  return <SyncContext value={value}>{children}</SyncContext>;
};

export const useSync = (): SyncContextValue => {
  const context = use(SyncContext);

  if (context === null) {
    throw new Error('useSync tiene que usarse dentro de <SyncProvider>.');
  }

  return context;
};
