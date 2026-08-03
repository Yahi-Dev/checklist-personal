import type { AppSupabaseClient } from './client';
import type { FileStorageService, UploadedFile } from '../../application/ports/services';
import type { Result } from '../../domain/shared/result';

import { appConfig } from '../../shared/config/app-config';
import { DomainErrors, toDomainError } from '../../domain/shared/domain-error';
import { err, ok } from '../../domain/shared/result';

/**
 * Adjuntos sobre Supabase Storage.
 *
 * El bucket es PRIVADO: las politicas RLS solo dejan leer los objetos bajo el prefijo
 * `<user_id>/`. Como consecuencia no existe una URL publica permanente, y cada lectura
 * pasa por una URL firmada con caducidad.
 */
export class SupabaseFileStorage implements FileStorageService {
  /** Una hora: de sobra para ver un adjunto, poco para que la URL filtrada sirva de algo. */
  private static readonly SIGNED_URL_TTL_SECONDS = 3600;

  constructor(private readonly supabase: AppSupabaseClient) {}

  async upload(file: File, path: string): Promise<Result<UploadedFile>> {
    try {
      const { error } = await this.supabase.storage
        .from(appConfig.supabase.attachmentsBucket)
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || 'application/octet-stream',
        });

      if (error !== null) {
        return err(DomainErrors.infrastructure(`No se pudo subir el archivo: ${error.message}`));
      }

      const signed = await this.createSignedUrl(path);
      if (!signed.ok) return signed;

      return ok({
        storagePath: path,
        publicUrl: signed.value,
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
      });
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo subir el archivo.'));
    }
  }

  async remove(storagePath: string): Promise<Result<void>> {
    try {
      const { error } = await this.supabase.storage
        .from(appConfig.supabase.attachmentsBucket)
        .remove([storagePath]);

      if (error !== null) {
        return err(DomainErrors.infrastructure(`No se pudo borrar el archivo: ${error.message}`));
      }

      return ok(undefined);
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo borrar el archivo.'));
    }
  }

  async createSignedUrl(
    storagePath: string,
    expiresInSeconds = SupabaseFileStorage.SIGNED_URL_TTL_SECONDS,
  ): Promise<Result<string>> {
    try {
      const { data, error } = await this.supabase.storage
        .from(appConfig.supabase.attachmentsBucket)
        .createSignedUrl(storagePath, expiresInSeconds);

      if (error !== null || data === null) {
        return err(
          DomainErrors.infrastructure(
            `No se pudo generar el enlace: ${error?.message ?? 'sin datos'}`,
          ),
        );
      }

      return ok(data.signedUrl);
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo generar el enlace.'));
    }
  }
}

/**
 * Implementacion nula para cuando no hay Supabase configurado.
 * Deja claro por que no funciona en vez de reventar con un error de red confuso.
 */
export class UnavailableFileStorage implements FileStorageService {
  private static readonly reason = DomainErrors.infrastructure(
    'Los adjuntos necesitan que configures Supabase.',
  );

  async upload(): Promise<Result<UploadedFile>> {
    return err(UnavailableFileStorage.reason);
  }

  async remove(): Promise<Result<void>> {
    return err(UnavailableFileStorage.reason);
  }

  async createSignedUrl(): Promise<Result<string>> {
    return err(UnavailableFileStorage.reason);
  }
}
