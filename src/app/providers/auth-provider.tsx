import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import type { AuthSession } from '../../application/ports/services';
import type { CurrentUser } from '../../application/ports/repositories';
import type { UserId } from '../../domain/shared/branded';

import type { AppContainer } from '../../infrastructure/di/container';

import {
  AdoptLocalDataUseCase,
  FindForeignDataUseCase,
} from '../../application/use-cases/sync/adopt-local-data';
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
 * Ofrece traerse las tareas que quedaron a nombre de otra sesion.
 *
 * SE PREGUNTA, NO SE HACE SOLO. Los datos del modo local no son de nadie y se adoptan
 * sin consultar, pero estos si tienen un dueño de verdad: en un equipo compartido,
 * volcarlos a la cuenta que entre ahora seria una fuga entre personas. La diferencia
 * entre ambos casos es la razon de que existan dos caminos.
 *
 * Sin este aviso, el sintoma es mudo y desconcertante: la app enseña las tareas, el
 * servidor las rechaza una a una con "violates row-level security policy", y el motivo
 * solo vive en la cola de salida, donde no lo ve nadie.
 */
const offerToClaimForeignData = async (container: AppContainer): Promise<void> => {
  const found = await new FindForeignDataUseCase(container.context).execute();
  if (!isOk(found)) return;

  for (const owner of found.value) {
    if (owner.total === 0) continue;

    // Se nombra lo que hay, no siempre "tareas": el caso real fue una categoria suelta,
    // y un aviso que hablara de tareas cuando no hay ninguna se lee como un error de la
    // app y se descarta sin leerlo.
    const partes = [
      owner.tareas > 0 && `${String(owner.tareas)} tareas`,
      owner.categorias > 0 && `${String(owner.categorias)} categorias`,
      owner.etiquetas > 0 && `${String(owner.etiquetas)} etiquetas`,
    ].filter((parte): parte is string => parte !== false);

    toast('Hay datos de otra sesion en este dispositivo', {
      duration: Number.POSITIVE_INFINITY,
      description: `${partes.join(', ')} se crearon con otra cuenta, y por eso no se estan subiendo.`,
      action: {
        label: 'Traermelas',
        onClick: () => {
          void new AdoptLocalDataUseCase(container.context)
            .execute({ previousUserId: owner.userId })
            .then((adopted) => {
              if (!isOk(adopted)) return;
              toast.success(`${String(adopted.value.tareas)} tareas ahora son tuyas`, {
                description: 'Se estan subiendo a la nube.',
              });
              void container.sync.sync();
            });
        },
      },
    });
  }
};

/**
 * Deja la cuenta lista al entrar. EL ORDEN ES LO IMPORTANTE DE ESTA FUNCION.
 *
 *   1. Adoptar lo creado sin cuenta.
 *   2. Sincronizar: subir eso y BAJAR lo que la cuenta ya tenga.
 *   3. Sembrar las categorias por defecto, solo si despues de bajar sigue sin haber ninguna.
 *   4. Ofrecer traerse lo que quedo a nombre de otra sesion.
 *
 * El paso 3 estaba el PRIMERO, y ahi es donde se rompia todo. Un dispositivo nuevo sembraba
 * sus cinco categorias -"Personal", "Trabajo"...- antes de bajar nada, sin saber que esa
 * cuenta ya tenia esas mismas cinco creadas en otro aparato, con los mismos nombres y otros
 * identificadores. El servidor tiene un indice unico por (usuario, nombre): las cinco filas
 * nuevas se rechazaban, se quedaban atascadas en la cola, y como las categorias se suben
 * antes que las tareas, arrastraban con ellas todo lo demas.
 *
 * De ahi el sintoma: instalabas la aplicacion de escritorio, entrabas con tu cuenta, y ese
 * aparato no volvia a subir nada nunca. Sembrar DESPUES de bajar convierte el paso 3 en lo
 * que siempre debio ser: algo que solo ocurre en una cuenta de verdad recien creada.
 *
 * Encadenado y no en paralelo, por lo mismo: cada paso necesita ver lo que hizo el anterior.
 */
const prepareAccount = async (container: AppContainer): Promise<void> => {
  const adopted = await new AdoptLocalDataUseCase(container.context).execute({
    previousUserId: brandId<UserId>(LOCAL_USER_ID),
  });

  if (isOk(adopted) && adopted.value.tareas > 0) {
    toast.success(`Se subieron ${String(adopted.value.tareas)} tareas de este dispositivo`, {
      description: 'Las habias creado antes de entrar con tu cuenta.',
    });
  }

  await container.sync.sync();
  await new SeedDefaultCategoriesUseCase(container.context).execute();
  await offerToClaimForeignData(container);
};

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

    /**
     * Para quien ya se hizo la preparacion de entrada.
     *
     * Hace falta porque `applySession` se llama MUCHAS veces por la misma sesion: una por
     * el `getSession()` inicial, otra por el `INITIAL_SESSION` que emite el propio cliente
     * de autenticacion al suscribirse, y otra en cada refresco de token -cada hora-. Sin
     * esta marca, cada una de ellas relanzaba la adopcion, la siembra y el aviso de datos
     * ajenos: trabajo repetido, avisos duplicados, y varias sincronizaciones pisandose.
     */
    let preparedFor: string | null = null;

    const applySession = (next: AuthSession | null) => {
      if (cancelled) return;

      setSession(next);
      container.setCurrentUser(next?.user ?? null);

      if (next === null) {
        container.sync.stopRealtime();
        preparedFor = null;
        return;
      }

      container.sync.startRealtime();

      if (preparedFor === next.user.id) return;
      preparedFor = next.user.id;
      void prepareAccount(container);
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
