import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { AuthSession } from '../../application/ports/services';
import type { CurrentUser } from '../../application/ports/repositories';

import { getContainer } from '../../infrastructure/di/container';
import { isOk } from '../../domain/shared/result';
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
      void container.sync.sync();
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
