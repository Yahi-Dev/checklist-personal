import type { AttachmentId, TaskId, UserId } from '../shared/branded';
import type { IsoDateTime } from './value-objects/iso-date-time';
import type { Result } from '../shared/result';
import { DomainErrors } from '../shared/domain-error';
import { err, ok } from '../shared/result';

export const ATTACHMENT_KINDS = ['link', 'image', 'file'] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** 10 MB. Suficiente para una foto del telefono sin reventar la cuota gratuita. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const MAX_ATTACHMENTS_PER_TASK = 20;

export interface Attachment {
  readonly id: AttachmentId;
  readonly taskId: TaskId;
  readonly userId: UserId;
  readonly kind: AttachmentKind;
  /** Nombre visible: el titulo de la pagina en un enlace, o el nombre del archivo. */
  readonly name: string;
  /** URL externa cuando `kind === 'link'`; URL firmada de Storage en el resto. */
  readonly url: string;
  /** Ruta dentro del bucket de Supabase Storage. `null` para enlaces externos. */
  readonly storagePath: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly createdAt: IsoDateTime;
}

/**
 * Solo http y https. Sin esta comprobacion, un `javascript:` guardado como adjunto se
 * convierte en XSS almacenado en cuanto se pinte como enlace pinchable.
 */
const isSafeHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export interface CreateLinkAttachmentInput {
  readonly id: AttachmentId;
  readonly taskId: TaskId;
  readonly userId: UserId;
  readonly url: string;
  readonly name?: string;
  readonly now: IsoDateTime;
}

export const createLinkAttachment = (input: CreateLinkAttachmentInput): Result<Attachment> => {
  const url = input.url.trim();

  if (!isSafeHttpUrl(url)) {
    return err(
      DomainErrors.validation('El enlace tiene que empezar por http:// o https://.', {
        field: 'attachment.url',
      }),
    );
  }

  const name = (input.name ?? '').trim() || hostnameOf(url) || 'Enlace';

  return ok({
    id: input.id,
    taskId: input.taskId,
    userId: input.userId,
    kind: 'link',
    name: name.slice(0, 200),
    url,
    storagePath: null,
    mimeType: null,
    sizeBytes: null,
    createdAt: input.now,
  });
};

export interface CreateFileAttachmentInput {
  readonly id: AttachmentId;
  readonly taskId: TaskId;
  readonly userId: UserId;
  readonly name: string;
  readonly storagePath: string;
  readonly url: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly now: IsoDateTime;
}

export const createFileAttachment = (input: CreateFileAttachmentInput): Result<Attachment> => {
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return err(
      DomainErrors.validation(
        `El archivo pasa del limite de ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`,
        { field: 'attachment.file', details: { sizeBytes: input.sizeBytes } },
      ),
    );
  }

  if (input.sizeBytes <= 0) {
    return err(DomainErrors.validation('El archivo esta vacio.', { field: 'attachment.file' }));
  }

  return ok({
    id: input.id,
    taskId: input.taskId,
    userId: input.userId,
    kind: input.mimeType.startsWith('image/') ? 'image' : 'file',
    name: input.name.trim().slice(0, 200) || 'Archivo',
    url: input.url,
    storagePath: input.storagePath,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    createdAt: input.now,
  });
};

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return '';
  }
};

export const formatBytes = (bytes: number | null): string => {
  if (bytes === null || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};
