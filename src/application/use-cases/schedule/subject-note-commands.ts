import type { Result } from '../../../domain/shared/result';
import type { SubjectId, SubjectNoteId } from '../../../domain/shared/branded';
import type { SubjectNote, SubjectNoteKind } from '../../../domain/schedule/subject-note';
import type { UseCase, UseCaseContext } from '../use-case';
import {
  createSubjectNote,
  softDeleteSubjectNote,
  togglePinned,
  updateSubjectNote,
} from '../../../domain/schedule/subject-note';
import { DomainErrors } from '../../../domain/shared/domain-error';
import { err, isErr, ok } from '../../../domain/shared/result';

/**
 * Las observaciones de una materia.
 *
 * Deliberadamente cortas de funciones: crear, editar, destacar y quitar. Una nota es lo
 * que el profesor dijo, no un documento; en cuanto esto crezca hacia carpetas, formato o
 * versiones, deja de ser la app de tareas con horario y se convierte en una app de
 * apuntes a medias.
 */

const noSession = () =>
  err(DomainErrors.unauthenticated('Necesitas iniciar sesion para hacer esto.'));

const noteNotFound = (id: string) =>
  err(DomainErrors.notFound('No encontramos esa nota.', { details: { id } }));

export interface CreateSubjectNoteCommand {
  readonly subjectId: SubjectId;
  readonly body: string;
  readonly kind?: SubjectNoteKind;
  readonly isPinned?: boolean;
}

export class CreateSubjectNoteUseCase implements UseCase<CreateSubjectNoteCommand, SubjectNote> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: CreateSubjectNoteCommand): Promise<Result<SubjectNote>> {
    const user = this.context.currentUser();
    if (user === null) return noSession();

    const subject = await this.context.subjects.findById(command.subjectId);
    if (isErr(subject)) return subject;
    if (subject.value === null) {
      return err(
        DomainErrors.notFound('No encontramos esa asignatura.', {
          details: { id: command.subjectId },
        }),
      );
    }

    const existing = await this.context.subjectNotes.findAll({ subjectId: command.subjectId });
    if (isErr(existing)) return existing;

    const created = createSubjectNote({
      id: this.context.ids.next<SubjectNoteId>(),
      userId: user.id,
      subjectId: command.subjectId,
      body: command.body,
      now: this.context.clock.now().toISOString(),
      position: existing.value.length,
      ...(command.kind === undefined ? {} : { kind: command.kind }),
      ...(command.isPinned === undefined ? {} : { isPinned: command.isPinned }),
    });

    if (isErr(created)) return created;
    return this.context.subjectNotes.save(created.value);
  }
}

export interface UpdateSubjectNoteCommand {
  readonly noteId: SubjectNoteId;
  readonly body?: string;
  readonly kind?: SubjectNoteKind;
  readonly isPinned?: boolean;
}

export class UpdateSubjectNoteUseCase implements UseCase<UpdateSubjectNoteCommand, SubjectNote> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: UpdateSubjectNoteCommand): Promise<Result<SubjectNote>> {
    const found = await this.context.subjectNotes.findById(command.noteId);
    if (isErr(found)) return found;
    if (found.value === null) return noteNotFound(command.noteId);

    const { noteId: _noteId, ...patch } = command;
    const now = this.context.clock.now().toISOString();

    const updated = updateSubjectNote(found.value, patch, now);
    if (isErr(updated)) return updated;

    return this.context.subjectNotes.save(updated.value);
  }
}

export interface ToggleSubjectNotePinnedCommand {
  readonly noteId: SubjectNoteId;
}

export class ToggleSubjectNotePinnedUseCase implements UseCase<
  ToggleSubjectNotePinnedCommand,
  SubjectNote
> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: ToggleSubjectNotePinnedCommand): Promise<Result<SubjectNote>> {
    const found = await this.context.subjectNotes.findById(command.noteId);
    if (isErr(found)) return found;
    if (found.value === null) return noteNotFound(command.noteId);

    const now = this.context.clock.now().toISOString();

    return this.context.subjectNotes.save(togglePinned(found.value, now));
  }
}

export interface DeleteSubjectNoteCommand {
  readonly noteId: SubjectNoteId;
}

export class DeleteSubjectNoteUseCase implements UseCase<DeleteSubjectNoteCommand, void> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: DeleteSubjectNoteCommand): Promise<Result<void>> {
    const found = await this.context.subjectNotes.findById(command.noteId);
    if (isErr(found)) return found;
    if (found.value === null) return noteNotFound(command.noteId);

    const now = this.context.clock.now().toISOString();

    const saved = await this.context.subjectNotes.save(softDeleteSubjectNote(found.value, now));
    if (isErr(saved)) return saved;

    return ok(undefined);
  }
}
