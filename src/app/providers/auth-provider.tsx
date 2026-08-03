import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import type { AuthSession } from '../../application/ports/services';
import type { CurrentUser } from '../../application/ports/repositories';
import type { UserId } from '../../domain/shared/branded';

import { AdoptLocalDataUseCase } from '../../application/use-cases/sync/adopt-local-data';
import { brandId } from '../../domain/shared/branded';
import { getContainer } from '../../infrastructure/di/container';
import { isOk } from '../../domain/shared/result';
import { LOCAL_USER_ID } from '../../infrastructure/auth/local-auth-service';
import { SeedDefaultCategoriesUseCase } from '../../application/use-cases/category/category-commands';

interface AuthContextValue {
  readonly user: CurrentUser | null;
  readonly session: AuthSession | null;
  readonly isLoading: boolean;
  readonly isCloudEnabled: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Fuente unica de verdad de la sesion.
 *
 * Ademas de exponer el usuario a la interfaz, hace dos cosas imprescindibles al
 * cambiar la sesion: inyectar el usuario en el contenedor -de donde lo leen todos los
 * casos de uso- y arrancar o parar el motor de sincronizacion. Sin lo primero, cada
 * escritura se guardaria con `userId` nulo y RLS la rechazaria al subirla.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const container = getContainer();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const applySession = (next: AuthSession | null) => {
      if (cancelled) return;

      setSession(next);
      container.setCurrentUser(next?.user ?? null);

      if (next === null) {
        container.sync.stopRealtime();
        return;
      }

      // Primer arranque de una cuenta nueva: sembrar categorias para no empezar en blanco.
      void new SeedDefaultCategoriesUseCase(container.context).execute();

      container.sync.startRealtime();

      /**
       * ANTES de sincronizar hay que adoptar lo que se creo sin cuenta.
       *
       * El orden importa y no es negociable: si se sincroniza primero, esas filas viajan
       * con el usuario ficticio, RLS las rechaza y -al subirse en un solo lote por
       * tabla- se cae la tabla entera. Adoptando antes, salen ya con el dueño correcto.
       *
       * Encadenado y no en paralelo por lo mismo: `sync()` tiene que ver la cola ya
       * reescrita.
       */
      void new AdoptLocalDataUseCase(container.context)
        .execute({ previousUserId: brandId<UserId>(LOCAL_USER_ID) })
        .then((adopted) => {
          if (isOk(adopted) && adopted.value.tareas > 0) {
            toast.success(
              `Se subieron ${String(adopted.value.tareas)} tareas de este dispositivo`,
              {
                description: 'Las habias creado antes de entrar con tu cuenta.',
              },
            );
          }
        })
        .finally(() => {
          void container.sync.sync();
        });
    };

    void (async () => {
      const result = await container.auth.getSession();
      applySession(isOk(result) ? result.value : null);
      if (!cancelled) setIsLoading(false);
    })();

    const unsubscribe = container.auth.onAuthStateChange(applySession);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [container]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      isLoading,
      isCloudEnabled: container.isCloudEnabled,
    }),
    [session, isLoading, container.isCloudEnabled],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
};

export const useAuth = (): AuthContextValue => {
  const context = use(AuthContext);

  if (context === null) {
    throw new Error('useAuth tiene que usarse dentro de <AuthProvider>.');
  }

  return context;
};
