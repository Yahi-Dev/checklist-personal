import type { AuthService, AuthSession } from '../../application/ports/services';
import type { Result } from '../../domain/shared/result';
import type { UserId } from '../../domain/shared/branded';

import { brandId } from '../../domain/shared/branded';
import { DomainErrors } from '../../domain/shared/domain-error';
import { err, ok } from '../../domain/shared/result';

/**
 * Sesion local, sin servidor.
 *
 * Se usa cuando no hay Supabase configurado. Permite abrir la app y usarla entera
 * contra IndexedDB antes de crear ninguna cuenta, en vez de recibir una pantalla de
 * login que no lleva a ningun sitio.
 *
 * El id es un UUID FIJO a proposito: si se generase uno nuevo en cada arranque, las
 * tareas guardadas ayer pertenecerian a un usuario distinto al de hoy y desaparecerian.
 */
/**
 * El dueño de todo lo creado sin cuenta.
 *
 * Se exporta porque al iniciar sesion de verdad hay que ir a buscar sus filas y
 * cambiarles el dueño; si no, se quedan para siempre en el dispositivo, rechazadas por
 * RLS en cada subida y sin que nadie lo diga.
 */
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';

export class LocalAuthService implements AuthService {
  private static readonly LOCAL_USER_ID = LOCAL_USER_ID;

  private readonly session: AuthSession = {
    user: {
      id: brandId<UserId>(LocalAuthService.LOCAL_USER_ID),
      email: 'local@dispositivo',
      displayName: 'Modo local',
    },
    accessToken: 'local',
    // Fecha lejana: esta sesion no caduca porque no hay nada que refrescar.
    expiresAt: '2999-12-31T23:59:59.000Z',
  };

  async getSession(): Promise<Result<AuthSession | null>> {
    return ok(this.session);
  }

  async signInWithPassword(): Promise<Result<AuthSession>> {
    return ok(this.session);
  }

  async signUpWithPassword(): Promise<Result<AuthSession | null>> {
    return ok(this.session);
  }

  async signInWithMagicLink(): Promise<Result<void>> {
    return err(
      DomainErrors.infrastructure(
        'Los enlaces de acceso necesitan Supabase configurado. Estas en modo local.',
      ),
    );
  }

  /** En modo local no hay sesion que cerrar: los datos son de este dispositivo. */
  async signOut(): Promise<Result<void>> {
    return ok(undefined);
  }

  onAuthStateChange(listener: (session: AuthSession | null) => void): () => void {
    listener(this.session);
    return () => undefined;
  }
}

/** Motor de sincronizacion inerte para el modo local. */
export class NullSyncService {
  private readonly state = {
    status: 'idle' as const,
    lastSyncedAt: null,
    pendingOperations: 0,
    lastError: null,
    blockedOperations: 0,
    blockedReason: null,
  };

  async sync(): Promise<Result<typeof this.state>> {
    return ok(this.state);
  }

  async fullResync(): Promise<Result<typeof this.state>> {
    return ok(this.state);
  }

  async retryBlocked(): Promise<Result<typeof this.state>> {
    return ok(this.state);
  }

  getState() {
    return this.state;
  }

  subscribe(listener: (state: typeof this.state) => void): () => void {
    listener(this.state);
    return () => undefined;
  }

  startRealtime(): void {
    /* No hay nada a lo que conectarse. */
  }

  stopRealtime(): void {
    /* No hay nada que desconectar. */
  }
}
