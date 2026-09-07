import type { CalendarDate } from '../../../domain/shared/clock';
import type { ClassModality } from '../../../domain/schedule/value-objects/class-modality';
import type { Result } from '../../../domain/shared/result';
import type { ScheduleBlock } from '../../../domain/schedule/schedule-block';
import type { ScheduleBlockId, SubjectId } from '../../../domain/shared/branded';
import type { Subject } from '../../../domain/schedule/subject';
import type { TimeOfDay } from '../../../domain/schedule/value-objects/time-of-day';
import type { UseCase, UseCaseContext } from '../use-case';
import type { Weekday } from '../../../domain/recurrence/recurrence-rule';
import {
  createScheduleBlock,
  findOverlap,
  MAX_BLOCKS_PER_SUBJECT,
  softDeleteScheduleBlock,
  updateScheduleBlock,
} from '../../../domain/schedule/schedule-block';
import { createSubject, softDeleteSubject, updateSubject } from '../../../domain/schedule/subject';
import { DomainErrors } from '../../../domain/shared/domain-error';
import { err, isErr, ok } from '../../../domain/shared/result';

/**
 * Retoques a mano sobre el horario importado.
 *
 * El PDF es la fuente habitual, pero no la unica verdad: a mitad de cuatrimestre te
 * cambian un aula, te añaden una tutoria o quieres ponerle otro color a la asignatura
 * que peor llevas. Todo eso pasa por aqui, por los mismos casos de uso que usaria
 * cualquier otra pantalla, para que respeten las reglas del dominio, funcionen sin
 * conexion y se sincronicen por la cola de siempre.
 *
 * Ojo con una consecuencia de la reconciliacion: un tramo creado a mano que no este en
 * el PDF se borra en logico al reimportar ese cuatrimestre. Es lo correcto -el
 * documento manda- y por eso el dialogo de importar enseña cuantas bajas va a haber
 * antes de escribir.
 */

const noSession = () =>
  err(DomainErrors.unauthenticated('Necesitas iniciar sesion para hacer esto.'));

const subjectNotFound = (id: string) =>
  err(DomainErrors.notFound('No encontramos esa asignatura.', { details: { id } }));

const blockNotFound = (id: string) =>
  err(DomainErrors.notFound('No encontramos esa clase.', { details: { id } }));

// ---------------------------------------------------------------------------
// Asignaturas
// ---------------------------------------------------------------------------

export interface CreateSubjectCommand {
  readonly code: string;
  readonly name: string;
  readonly termCode: string;
  readonly section?: string;
  readonly credits?: number | null;
  readonly teacherName?: string | null;
  readonly color?: string;
  readonly startsOn?: CalendarDate | null;
  readonly endsOn?: CalendarDate | null;
}

export class CreateSubjectUseCase implements UseCase<CreateSubjectCommand, Subject> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: CreateSubjectCommand): Promise<Result<Subject>> {
    const user = this.context.currentUser();
    if (user === null) return noSession();

    const existing = await this.context.subjects.findAll({ termCode: command.termCode });
    if (isErr(existing)) return existing;

    const section = (command.section ?? '').trim().toUpperCase();
    const duplicate = existing.value.some(
      (subject) =>
        subject.code === command.code.trim().toUpperCase() && subject.section === section,
    );

    if (duplicate) {
      return err(
        DomainErrors.conflict('Ya tienes esa asignatura y seccion en este cuatrimestre.', {
          field: 'code',
        }),
      );
    }

    const created = createSubject({
      id: this.context.ids.next<SubjectId>(),
      userId: user.id,
      code: command.code,
      name: command.name,
      termCode: command.termCode,
      now: this.context.clock.now().toISOString(),
      section,
      credits: command.credits ?? null,
      teacherName: command.teacherName ?? null,
      startsOn: command.startsOn ?? null,
      endsOn: command.endsOn ?? null,
      position: existing.value.length,
      ...(command.color === undefined ? {} : { color: command.color }),
    });

    if (isErr(created)) return created;
    return this.context.subjects.save(created.value);
  }
}

export interface UpdateSubjectCommand {
  readonly subjectId: SubjectId;
  readonly code?: string;
  readonly name?: string;
  readonly section?: string;
  readonly credits?: number | null;
  readonly teacherName?: string | null;
  readonly color?: string;
  readonly startsOn?: CalendarDate | null;
  readonly endsOn?: CalendarDate | null;
}

export class UpdateSubjectUseCase implements UseCase<UpdateSubjectCommand, Subject> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: UpdateSubjectCommand): Promise<Result<Subject>> {
    const found = await this.context.subjects.findById(command.subjectId);
    if (isErr(found)) return found;
    if (found.value === null) return subjectNotFound(command.subjectId);

    const { subjectId: _subjectId, ...patch } = command;
    const now = this.context.clock.now().toISOString();

    const updated = updateSubject(found.value, patch, now);
    if (isErr(updated)) return updated;

    return this.context.subjects.save(updated.value);
  }
}

export interface DeleteSubjectCommand {
  readonly subjectId: SubjectId;
}

/**
 * Borra la asignatura Y sus tramos, siempre en logico.
 *
 * Dejar los tramos vivos no se notaria en esta pantalla -el constructor de la semana
 * descarta los que no tienen asignatura- pero seguirian ocupando sitio, viajando por la
 * sincronizacion para siempre y reapareciendo si algun dia se restaura la asignatura.
 */
export class DeleteSubjectUseCase implements UseCase<DeleteSubjectCommand, void> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: DeleteSubjectCommand): Promise<Result<void>> {
    const found = await this.context.subjects.findById(command.subjectId);
    if (isErr(found)) return found;
    if (found.value === null) return subjectNotFound(command.subjectId);

    const now = this.context.clock.now().toISOString();

    const blocks = await this.context.scheduleBlocks.findAll({ subjectId: command.subjectId });
    if (isErr(blocks)) return blocks;

    const savedBlocks = await this.context.scheduleBlocks.saveMany(
      blocks.value.map((block) => softDeleteScheduleBlock(block, now)),
    );
    if (isErr(savedBlocks)) return savedBlocks;

    const saved = await this.context.subjects.save(softDeleteSubject(found.value, now));
    if (isErr(saved)) return saved;

    return ok(undefined);
  }
}

// ---------------------------------------------------------------------------
// Tramos de clase
// ---------------------------------------------------------------------------

export interface CreateScheduleBlockCommand {
  readonly subjectId: SubjectId;
  readonly weekday: Weekday;
  readonly startsAt: TimeOfDay;
  readonly endsAt: TimeOfDay;
  readonly modality?: ClassModality;
  readonly locationLabel?: string;
}

export class CreateScheduleBlockUseCase implements UseCase<
  CreateScheduleBlockCommand,
  ScheduleBlock
> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: CreateScheduleBlockCommand): Promise<Result<ScheduleBlock>> {
    const user = this.context.currentUser();
    if (user === null) return noSession();

    const subject = await this.context.subjects.findById(command.subjectId);
    if (isErr(subject)) return subject;
    if (subject.value === null) return subjectNotFound(command.subjectId);

    const own = await this.context.scheduleBlocks.findAll({ subjectId: command.subjectId });
    if (isErr(own)) return own;

    if (own.value.length >= MAX_BLOCKS_PER_SUBJECT) {
      return err(
        DomainErrors.invariant(
          `Una asignatura no puede tener mas de ${String(MAX_BLOCKS_PER_SUBJECT)} clases a la semana.`,
        ),
      );
    }

    const created = createScheduleBlock({
      id: this.context.ids.next<ScheduleBlockId>(),
      userId: user.id,
      subjectId: command.subjectId,
      weekday: command.weekday,
      startsAt: command.startsAt,
      endsAt: command.endsAt,
      now: this.context.clock.now().toISOString(),
      ...(command.modality === undefined ? {} : { modality: command.modality }),
      ...(command.locationLabel === undefined ? {} : { locationLabel: command.locationLabel }),
    });

    if (isErr(created)) return created;

    const clash = await this.findClash(subject.value, created.value);
    if (isErr(clash)) return clash;

    return this.context.scheduleBlocks.save(created.value);
  }

  private async findClash(subject: Subject, candidate: ScheduleBlock): Promise<Result<void>> {
    return findClashInTerm(this.context, subject, candidate);
  }
}

export interface UpdateScheduleBlockCommand {
  readonly blockId: ScheduleBlockId;
  readonly weekday?: Weekday;
  readonly startsAt?: TimeOfDay;
  readonly endsAt?: TimeOfDay;
  readonly modality?: ClassModality;
  readonly locationLabel?: string;
}

export class UpdateScheduleBlockUseCase implements UseCase<
  UpdateScheduleBlockCommand,
  ScheduleBlock
> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: UpdateScheduleBlockCommand): Promise<Result<ScheduleBlock>> {
    const found = await this.context.scheduleBlocks.findById(command.blockId);
    if (isErr(found)) return found;
    if (found.value === null) return blockNotFound(command.blockId);

    const { blockId: _blockId, ...patch } = command;
    const now = this.context.clock.now().toISOString();

    const updated = updateScheduleBlock(found.value, patch, now);
    if (isErr(updated)) return updated;

    const subject = await this.context.subjects.findById(found.value.subjectId);
    if (isErr(subject)) return subject;
    if (subject.value === null) return subjectNotFound(found.value.subjectId);

    const clash = await findClashInTerm(this.context, subject.value, updated.value);
    if (isErr(clash)) return clash;

    return this.context.scheduleBlocks.save(updated.value);
  }
}

export interface DeleteScheduleBlockCommand {
  readonly blockId: ScheduleBlockId;
}

export class DeleteScheduleBlockUseCase implements UseCase<DeleteScheduleBlockCommand, void> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: DeleteScheduleBlockCommand): Promise<Result<void>> {
    const found = await this.context.scheduleBlocks.findById(command.blockId);
    if (isErr(found)) return found;
    if (found.value === null) return blockNotFound(command.blockId);

    const now = this.context.clock.now().toISOString();

    const saved = await this.context.scheduleBlocks.save(softDeleteScheduleBlock(found.value, now));
    if (isErr(saved)) return saved;

    return ok(undefined);
  }
}

export interface DeleteTermCommand {
  readonly termCode: string;
}

/** Quita un cuatrimestre entero. Lo usa el menu de la pantalla para hacer limpieza. */
export class DeleteTermUseCase implements UseCase<DeleteTermCommand, number> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: DeleteTermCommand): Promise<Result<number>> {
    const subjects = await this.context.subjects.findAll({ termCode: command.termCode });
    if (isErr(subjects)) return subjects;

    const deleter = new DeleteSubjectUseCase(this.context);

    for (const subject of subjects.value) {
      const removed = await deleter.execute({ subjectId: subject.id });
      if (isErr(removed)) return removed;
    }

    return ok(subjects.value.length);
  }
}

// ---------------------------------------------------------------------------
// Auxiliares privados
// ---------------------------------------------------------------------------

/**
 * Rechaza que dos clases del MISMO cuatrimestre se pisen.
 *
 * El choque se busca en todo el cuatrimestre y no solo dentro de la asignatura, porque
 * el conflicto que le importa al usuario es "no puedo estar en dos sitios a la vez", y
 * ese cruza asignaturas. La importacion no pasa por aqui a proposito: si la universidad
 * imprime un solape, el horario tiene que reflejarlo tal cual y no perder una clase.
 */
const findClashInTerm = async (
  context: UseCaseContext,
  subject: Subject,
  candidate: ScheduleBlock,
): Promise<Result<void>> => {
  const subjects = await context.subjects.findAll({ termCode: subject.termCode });
  if (isErr(subjects)) return subjects;

  const sameTerm = new Set(subjects.value.map((item) => item.id as string));

  const blocks = await context.scheduleBlocks.findAll({ weekday: candidate.weekday });
  if (isErr(blocks)) return blocks;

  const overlap = findOverlap(
    blocks.value.filter((block) => sameTerm.has(block.subjectId)),
    candidate,
  );

  if (overlap !== null) {
    return err(
      DomainErrors.conflict('Ya tienes otra clase a esa hora.', {
        field: 'startsAt',
        details: { from: overlap.startsAt, to: overlap.endsAt },
      }),
    );
  }

  return ok(undefined);
};
