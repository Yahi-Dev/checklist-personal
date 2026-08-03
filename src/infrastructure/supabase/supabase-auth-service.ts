import type { AppSupabaseClient } from './client';
import type { AuthService, AuthSession } from '../../application/ports/services';
import type { Result } from '../../domain/shared/result';
import type { Session } from '@supabase/supabase-js';
import type { UserId } from '../../domain/shared/branded';

import { appConfig } from '../../shared/config/app-config';
import { brandId } from '../../domain/shared/branded';
import { DomainErrors, toDomainError } from '../../domain/shared/domain-error';
import { err, ok } from '../../domain/shared/result';

/**
 * A donde vuelve el usuario despues de pulsar un enlace del correo.
 *
 * Dos decisiones, las dos aprendidas de un fallo real:
 *
 * SE USA LA URL PUBLICA COMPLETA, no `location.origin`. En GitHub Pages la app vive en
 * `/checklist-personal/`, asi que el origen a secas manda a la raiz del dominio, donde no
 * hay ninguna app que recoja el token.
 *
 * SE VUELVE A LA RAIZ, SIN `#/hoy`. El enrutado es por hash y Supabase tambien usa el
 * fragmento: cuando el enlace falla devuelve `#error=access_denied&...`. Si la URL de
 * retorno ya trae su propio hash, los dos usos chocan. Volviendo a la raiz, el fragmento
 * queda libre para Supabase y la app enruta sola a Hoy en cuanto hay sesion.
 *
 * `undefined` en Electron (`file://`): ahi no hay direccion de vuelta posible, y mandar
 * una invalida es peor que dejar que Supabase use la Site URL del proyecto.
 */
const emailRedirectTo = (): string | undefined =>
  appConfig.publicUrl === '' ? undefined : appConfig.publicUrl;

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
        // Sin esto, Supabase manda el correo de confirmacion a la "Site URL" del
        // proyecto, que por defecto es `http://localhost:3000`. Es exactamente el
        // motivo por el que el enlace de confirmacion no llevaba a ninguna parte.
        options: { emailRedirectTo: emailRedirectTo() },
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
        options: { emailRedirectTo: emailRedirectTo() },
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
    // Este no es un error del usuario sino de configuracion, y sin traducir aparecia
    // como "Email signups are disabled": describe el sintoma y no dice donde se arregla,
    // asi que uno se queda mirando el formulario buscando que escribio mal.
    if (normalized.includes('email signups are disabled')) {
      return DomainErrors.conflict(
        'El registro por correo esta desactivado en Supabase. Activalo en ' +
          'Authentication → Sign In / Providers → Email.',
      );
    }
    if (normalized.includes('email logins are disabled')) {
      return DomainErrors.conflict(
        'El acceso por correo esta desactivado en Supabase. Activalo en ' +
          'Authentication → Sign In / Providers → Email.',
      );
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
