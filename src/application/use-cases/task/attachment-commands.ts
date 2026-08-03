import type { AttachmentId, TaskId } from '../../../domain/shared/branded';
import type { Result } from '../../../domain/shared/result';
import type { Task } from '../../../domain/task/task';
import type { UseCase, UseCaseContext } from '../use-case';

import { attachAttachment, detachAttachment } from '../../../domain/task/task';
import { createFileAttachment, createLinkAttachment } from '../../../domain/task/attachment';
import { DomainErrors } from '../../../domain/shared/domain-error';
import { err, isErr } from '../../../domain/shared/result';

const notFound = (id: string) =>
  err(DomainErrors.notFound('No encontramos esa tarea.', { details: { id } }));

export interface AddLinkCommand {
  readonly taskId: TaskId;
  readonly url: string;
  readonly name?: string;
}

export class AddLinkAttachmentUseCase implements UseCase<AddLinkCommand, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: AddLinkCommand): Promise<Result<Task>> {
    const user = this.context.currentUser();
    if (user === null) {
      return err(DomainErrors.unauthenticated('Necesitas iniciar sesion para hacer esto.'));
    }

    const found = await this.context.tasks.findById(command.taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(command.taskId);

    const now = this.context.clock.now().toISOString();

    const attachment = createLinkAttachment({
      id: this.context.ids.next<AttachmentId>(),
      taskId: command.taskId,
      userId: user.id,
      url: command.url,
      ...(command.name === undefined ? {} : { name: command.name }),
      now,
    });

    if (isErr(attachment)) return attachment;

    const updated = attachAttachment(found.value, attachment.value, now);
    if (isErr(updated)) return updated;

    return this.context.tasks.save(updated.value);
  }
}

export interface AddFileCommand {
  readonly taskId: TaskId;
  readonly file: File;
}

/**
 * Sube un archivo y lo enlaza a la tarea.
 *
 * A diferencia del resto, este caso de uso NO funciona sin conexion: Supabase Storage
 * no admite escritura diferida y meter binarios en la cola de sincronizacion llenaria
 * la cuota de IndexedDB con las fotos del telefono. Cuando falla, la tarea se queda
 * intacta y el usuario puede reintentar.
 */
export class AddFileAttachmentUseCase implements UseCase<AddFileCommand, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: AddFileCommand): Promise<Result<Task>> {
    const user = this.context.currentUser();
    if (user === null) {
      return err(DomainErrors.unauthenticated('Necesitas iniciar sesion para hacer esto.'));
    }

    const found = await this.context.tasks.findById(command.taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(command.taskId);

    const attachmentId = this.context.ids.next<AttachmentId>();
    const safeName = command.file.name.replace(/[^\w.-]+/gu, '_').slice(-100);
    const storagePath = `${user.id}/${command.taskId}/${attachmentId}-${safeName}`;

    const uploaded = await this.context.files.upload(command.file, storagePath);
    if (isErr(uploaded)) return uploaded;

    const now = this.context.clock.now().toISOString();

    const attachment = createFileAttachment({
      id: attachmentId,
      taskId: command.taskId,
      userId: user.id,
      name: command.file.name,
      storagePath: uploaded.value.storagePath,
      url: uploaded.value.publicUrl,
      mimeType: uploaded.value.mimeType,
      sizeBytes: uploaded.value.sizeBytes,
      now,
    });

    if (isErr(attachment)) {
      // El dominio rechazo el archivo ya subido: se limpia para no dejar basura pagada.
      await this.context.files.remove(uploaded.value.storagePath);
      return attachment;
    }

    const updated = attachAttachment(found.value, attachment.value, now);
    if (isErr(updated)) {
      await this.context.files.remove(uploaded.value.storagePath);
      return updated;
    }

    return this.context.tasks.save(updated.value);
  }
}

export interface RemoveAttachmentCommand {
  readonly taskId: TaskId;
  readonly attachmentId: AttachmentId;
}

export class RemoveAttachmentUseCase implements UseCase<RemoveAttachmentCommand, Task> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: RemoveAttachmentCommand): Promise<Result<Task>> {
    const found = await this.context.tasks.findById(command.taskId);
    if (isErr(found)) return found;
    if (found.value === null) return notFound(command.taskId);

    const attachment = found.value.attachments.find((item) => item.id === command.attachmentId);
    const now = this.context.clock.now().toISOString();

    const updated = detachAttachment(found.value, command.attachmentId, now);
    const saved = await this.context.tasks.save(updated);
    if (isErr(saved)) return saved;

    // El objeto de Storage se borra DESPUES de confirmar la escritura: si fallara,
    // preferimos un archivo huerfano a una tarea que apunta a un enlace roto.
    if (attachment?.storagePath != null) {
      await this.context.files.remove(attachment.storagePath);
    }

    return saved;
  }
}
