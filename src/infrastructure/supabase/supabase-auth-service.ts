import type { AppSupabaseClient } from './client';
import type { AuthService, AuthSession } from '../../application/ports/services';
import type { Result } from '../../domain/shared/result';
import type { Session } from '@supabase/supabase-js';
import type { UserId } from '../../domain/shared/branded';

import { brandId } from '../../domain/shared/branded';
import { DomainErrors, toDomainError } from '../../domain/shared/domain-error';
import { err, ok } from '../../domain/shared/result';

/**
 * Autenticacion contra Supabase Auth.
 *
 * Traduce los errores de la libreria a `DomainError` en español: la app nunca deberia
 * enseñar "Invalid login credentials" tal cual, ni obligar a cada componente a
 * conocer el formato de errores de Supabase.
 */
export class SupabaseAuthService implements AuthService {
  constructor(private readonly supabase: AppSupabaseClient) {}

  async getSession(): Promise<Result<AuthSession | null>> {
    try {
      const { data, error } = await this.supabase.auth.getSession();
      if (error !== null) return err(this.translate(error.message));
      return ok(toAuthSession(data.session));
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo comprobar la sesion.'));
    }
  }

  async signInWithPassword(email: string, password: string): Promise<Result<AuthSession>> {
    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error !== null) return err(this.translate(error.message));

      const session = toAuthSession(data.session);
      if (session === null) {
        return err(DomainErrors.unauthenticated('No se pudo iniciar sesion.'));
      }

      return ok(session);
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo iniciar sesion.'));
    }
  }

  /**
   * Registra una cuenta nueva.
   *
   * Devuelve `null` cuando el proyecto exige confirmar el correo: en ese caso no hay
   * sesion todavia y la interfaz tiene que pedir que revise el buzon, no fingir que
   * ya entro.
   */
  async signUpWithPassword(email: string, password: string): Promise<Result<AuthSession | null>> {
    try {
      const { data, error } = await this.supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error !== null) return err(this.translate(error.message));
      return ok(toAuthSession(data.session));
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo crear la cuenta.'));
    }
  }

  async signInWithMagicLink(email: string): Promise<Result<void>> {
    try {
      const { error } = await this.supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: `${globalThis.location?.origin ?? ''}/#/hoy` },
      });

      if (error !== null) return err(this.translate(error.message));
      return ok(undefined);
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo enviar el enlace.'));
    }
  }

  async signOut(): Promise<Result<void>> {
    try {
      const { error } = await this.supabase.auth.signOut();
      if (error !== null) return err(this.translate(error.message));
      return ok(undefined);
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo cerrar la sesion.'));
    }
  }

  onAuthStateChange(listener: (session: AuthSession | null) => void): () => void {
    const { data } = this.supabase.auth.onAuthStateChange((_event, session) => {
      listener(toAuthSession(session));
    });

    return () => data.subscription.unsubscribe();
  }

  /** Mensajes de Supabase (en ingles y genericos) a algo accionable en español. */
  private translate(message: string): ReturnType<typeof DomainErrors.unauthenticated> {
    const normalized = message.toLowerCase();

    if (normalized.includes('invalid login credentials')) {
      return DomainErrors.unauthenticated('Correo o contraseña incorrectos.');
    }
    if (normalized.includes('email not confirmed')) {
      return DomainErrors.unauthenticated(
        'Tienes que confirmar tu correo. Revisa la bandeja de entrada.',
      );
    }
    if (normalized.includes('user already registered')) {
      return DomainErrors.conflict('Ya existe una cuenta con ese correo.', { field: 'email' });
    }
    if (normalized.includes('password should be at least')) {
      return DomainErrors.validation('La contraseña debe tener al menos 6 caracteres.', {
        field: 'password',
      });
    }
    if (normalized.includes('rate limit') || normalized.includes('too many')) {
      return DomainErrors.conflict('Demasiados intentos. Espera un momento y vuelve a probar.');
    }
    if (normalized.includes('fetch') || normalized.includes('network')) {
      return DomainErrors.infrastructure('No hay conexion con el servidor.');
    }

    return DomainErrors.unknown(message);
  }
}

const toAuthSession = (session: Session | null): AuthSession | null => {
  if (session === null) return null;

  const metadata = session.user.user_metadata as { full_name?: unknown; name?: unknown };
  const displayName =
    typeof metadata.full_name === 'string'
      ? metadata.full_name
      : typeof metadata.name === 'string'
        ? metadata.name
        : null;

  return {
    user: {
      id: brandId<UserId>(session.user.id),
      email: session.user.email ?? '',
      displayName,
    },
    accessToken: session.access_token,
    expiresAt: new Date((session.expires_at ?? 0) * 1000).toISOString(),
  };
};
