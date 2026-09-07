import type { AppDatabase } from './database';
import type { Outbox } from './outbox';
import type { Result } from '../../domain/shared/result';
import type { ScheduleBlock } from '../../domain/schedule/schedule-block';
import type { ScheduleBlockId, SubjectId } from '../../domain/shared/branded';
import type {
  ScheduleBlockQuery,
  ScheduleBlockRepository,
  SubjectQuery,
  SubjectRepository,
} from '../../application/ports/repositories';
import type { Subject } from '../../domain/schedule/subject';

import { fromPromise, ok } from '../../domain/shared/result';
import { stripHints, withHints } from './records';
import { toDomainError } from '../../domain/shared/domain-error';

/**
 * Asignaturas y tramos de horario sobre IndexedDB.
 *
 * Mismo contrato que los demas repositorios y una sola regla que no se puede relajar:
 * la escritura y el encolado en la cola de salida van en LA MISMA transaccion de Dexie.
 * Si se separan, un cierre de la app entre las dos deja la fila guardada en el
 * dispositivo y sin nada que recuerde que hay que subirla: el horario se ve bien aqui y
 * no aparece nunca en el telefono.
 */

export class DexieSubjectRepository implements SubjectRepository {
  constructor(
    private readonly database: AppDatabase,
    private readonly outbox: Outbox,
  ) {}

  async findById(id: SubjectId): Promise<Result<Subject | null>> {
    return fromPromise(
      this.database.subjects
        .get(id)
        .then((record) => (record === undefined ? null : stripHints<Subject>(record))),
      (cause) => toDomainError(cause, 'No se pudo leer la asignatura.'),
    );
  }

  async findAll(query: SubjectQuery = {}): Promise<Result<Subject[]>> {
    return fromPromise(
      (async () => {
        const records = await this.read(query);

        return records
          .map((record) => stripHints<Subject>(record))
          .sort(
            (a, b) =>
              b.termCode.localeCompare(a.termCode, 'es') ||
              a.position - b.position ||
              a.code.localeCompare(b.code, 'es'),
          );
      })(),
      (cause) => toDomainError(cause, 'No se pudieron leer las asignaturas.'),
    );
  }

  async save(subject: Subject): Promise<Result<Subject>> {
    return fromPromise(
      this.database.transaction('rw', [this.database.subjects, this.database.outbox], async () => {
        await this.database.subjects.put(withHints(subject, true));
        await this.outbox.enqueue('subject', subject.id, 'upsert', subject, subject.updatedAt);
        return subject;
      }),
      (cause) => toDomainError(cause, 'No se pudo guardar la asignatura.'),
    );
  }

  async saveMany(subjects: readonly Subject[]): Promise<Result<Subject[]>> {
    if (subjects.length === 0) return ok([]);

    return fromPromise(
      this.database.transaction('rw', [this.database.subjects, this.database.outbox], async () => {
        await this.database.subjects.bulkPut(subjects.map((subject) => withHints(subject, true)));
        await this.outbox.enqueueMany(
          'subject',
          subjects.map((subject) => ({
            id: subject.id,
            updatedAt: subject.updatedAt,
            payload: subject,
          })),
        );
        return [...subjects];
      }),
      (cause) => toDomainError(cause, 'No se pudieron guardar las asignaturas.'),
    );
  }

  async hardDelete(id: SubjectId): Promise<Result<void>> {
    return fromPromise(this.database.subjects.delete(id), (cause) =>
      toDomainError(cause, 'No se pudo borrar la asignatura.'),
    );
  }

  private async read(query: SubjectQuery): Promise<readonly (Subject & { _deleted: 0 | 1 })[]> {
    const includeDeleted = query.includeDeleted === true;

    if (query.termCode !== undefined) {
      /* El indice compuesto evita traerse el historico entero para quedarse con un
         cuatrimestre: tras varios años de carrera son cientos de filas por una decena. */
      return includeDeleted
        ? this.database.subjects.where('termCode').equals(query.termCode).toArray()
        : this.database.subjects.where('[_deleted+termCode]').equals([0, query.termCode]).toArray();
    }

    return includeDeleted
      ? this.database.subjects.toArray()
      : this.database.subjects.where('_deleted').equals(0).toArray();
  }
}

export class DexieScheduleBlockRepository implements ScheduleBlockRepository {
  constructor(
    private readonly database: AppDatabase,
    private readonly outbox: Outbox,
  ) {}

  async findById(id: ScheduleBlockId): Promise<Result<ScheduleBlock | null>> {
    return fromPromise(
      this.database.scheduleBlocks
        .get(id)
        .then((record) => (record === undefined ? null : stripHints<ScheduleBlock>(record))),
      (cause) => toDomainError(cause, 'No se pudo leer la clase.'),
    );
  }

  async findAll(query: ScheduleBlockQuery = {}): Promise<Result<ScheduleBlock[]>> {
    return fromPromise(
      (async () => {
        const records = await this.read(query);

        return records
          .map((record) => stripHints<ScheduleBlock>(record))
          .sort(
            (a, b) =>
              a.weekday - b.weekday ||
              a.startsAt.localeCompare(b.startsAt) ||
              a.id.localeCompare(b.id),
          );
      })(),
      (cause) => toDomainError(cause, 'No se pudieron leer las clases.'),
    );
  }

  async save(block: ScheduleBlock): Promise<Result<ScheduleBlock>> {
    return fromPromise(
      this.database.transaction(
        'rw',
        [this.database.scheduleBlocks, this.database.outbox],
        async () => {
          await this.database.scheduleBlocks.put(withHints(block, true));
          await this.outbox.enqueue('scheduleBlock', block.id, 'upsert', block, block.updatedAt);
          return block;
        },
      ),
      (cause) => toDomainError(cause, 'No se pudo guardar la clase.'),
    );
  }

  async saveMany(blocks: readonly ScheduleBlock[]): Promise<Result<ScheduleBlock[]>> {
    if (blocks.length === 0) return ok([]);

    return fromPromise(
      this.database.transaction(
        'rw',
        [this.database.scheduleBlocks, this.database.outbox],
        async () => {
          await this.database.scheduleBlocks.bulkPut(blocks.map((block) => withHints(block, true)));
          await this.outbox.enqueueMany(
            'scheduleBlock',
            blocks.map((block) => ({
              id: block.id,
              updatedAt: block.updatedAt,
              payload: block,
            })),
          );
          return [...blocks];
        },
      ),
      (cause) => toDomainError(cause, 'No se pudieron guardar las clases.'),
    );
  }

  async hardDelete(id: ScheduleBlockId): Promise<Result<void>> {
    return fromPromise(this.database.scheduleBlocks.delete(id), (cause) =>
      toDomainError(cause, 'No se pudo borrar la clase.'),
    );
  }

  private async read(
    query: ScheduleBlockQuery,
  ): Promise<readonly (ScheduleBlock & { _deleted: 0 | 1 })[]> {
    const includeDeleted = query.includeDeleted === true;

    if (query.subjectId !== undefined) {
      return includeDeleted
        ? this.database.scheduleBlocks.where('subjectId').equals(query.subjectId).toArray()
        : this.database.scheduleBlocks
            .where('[_deleted+subjectId]')
            .equals([0, query.subjectId])
            .toArray();
    }

    if (query.weekday !== undefined) {
      return includeDeleted
        ? this.database.scheduleBlocks.where('weekday').equals(query.weekday).toArray()
        : this.database.scheduleBlocks
            .where('[_deleted+weekday]')
            .equals([0, query.weekday])
            .toArray();
    }

    return includeDeleted
      ? this.database.scheduleBlocks.toArray()
      : this.database.scheduleBlocks.where('_deleted').equals(0).toArray();
  }
}
