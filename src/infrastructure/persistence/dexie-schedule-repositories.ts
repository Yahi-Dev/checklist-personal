import type { AppDatabase } from './database';
import type { Outbox } from './outbox';
import type { Result } from '../../domain/shared/result';
import type { ScheduleBlock } from '../../domain/schedule/schedule-block';
import type {
  ClassAttendanceId,
  ScheduleBlockId,
  SubjectId,
  SubjectNoteId,
} from '../../domain/shared/branded';
import type { ClassAttendance } from '../../domain/schedule/class-attendance';
import type {
  ClassAttendanceQuery,
  ClassAttendanceRepository,
  ScheduleBlockQuery,
  ScheduleBlockRepository,
  SubjectNoteQuery,
  SubjectNoteRepository,
  SubjectQuery,
  SubjectRepository,
} from '../../application/ports/repositories';
import type { Subject } from '../../domain/schedule/subject';
import type { SubjectNote } from '../../domain/schedule/subject-note';

import { bySubjectNoteOrder } from '../../domain/schedule/subject-note';
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

        /* `read` elige UN indice -el de la asignatura o el del dia-, asi que si vienen
           los dos criterios el segundo hay que aplicarlo aqui. Antes se ignoraba en
           silencio, que es la peor forma de fallar: devolvia de mas y parecia correcto. */
        const filtered =
          query.subjectId !== undefined && query.weekday !== undefined
            ? records.filter((record) => record.weekday === query.weekday)
            : records;

        return filtered
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

export class DexieSubjectNoteRepository implements SubjectNoteRepository {
  constructor(
    private readonly database: AppDatabase,
    private readonly outbox: Outbox,
  ) {}

  async findById(id: SubjectNoteId): Promise<Result<SubjectNote | null>> {
    return fromPromise(
      this.database.subjectNotes
        .get(id)
        .then((record) => (record === undefined ? null : stripHints<SubjectNote>(record))),
      (cause) => toDomainError(cause, 'No se pudo leer la nota.'),
    );
  }

  async findAll(query: SubjectNoteQuery = {}): Promise<Result<SubjectNote[]>> {
    return fromPromise(
      (async () => {
        const includeDeleted = query.includeDeleted === true;

        const records =
          query.subjectId === undefined
            ? includeDeleted
              ? await this.database.subjectNotes.toArray()
              : await this.database.subjectNotes.where('_deleted').equals(0).toArray()
            : includeDeleted
              ? await this.database.subjectNotes
                  .where('subjectId')
                  .equals(query.subjectId)
                  .toArray()
              : await this.database.subjectNotes
                  .where('[_deleted+subjectId]')
                  .equals([0, query.subjectId])
                  .toArray();

        /* El orden lo decide el DOMINIO y no el indice: "destacadas primero, luego por
           tipo, luego lo mas reciente" no es un orden que IndexedDB sepa expresar, y
           repartirlo entre el indice y la pantalla seria la forma de que las dos listas
           acabaran ordenando distinto. */
        return records.map((record) => stripHints<SubjectNote>(record)).sort(bySubjectNoteOrder);
      })(),
      (cause) => toDomainError(cause, 'No se pudieron leer las notas.'),
    );
  }

  async save(note: SubjectNote): Promise<Result<SubjectNote>> {
    return fromPromise(
      this.database.transaction(
        'rw',
        [this.database.subjectNotes, this.database.outbox],
        async () => {
          await this.database.subjectNotes.put(withHints(note, true));
          await this.outbox.enqueue('subjectNote', note.id, 'upsert', note, note.updatedAt);
          return note;
        },
      ),
      (cause) => toDomainError(cause, 'No se pudo guardar la nota.'),
    );
  }

  async saveMany(notes: readonly SubjectNote[]): Promise<Result<SubjectNote[]>> {
    if (notes.length === 0) return ok([]);

    return fromPromise(
      this.database.transaction(
        'rw',
        [this.database.subjectNotes, this.database.outbox],
        async () => {
          await this.database.subjectNotes.bulkPut(notes.map((note) => withHints(note, true)));
          await this.outbox.enqueueMany(
            'subjectNote',
            notes.map((note) => ({ id: note.id, updatedAt: note.updatedAt, payload: note })),
          );
          return [...notes];
        },
      ),
      (cause) => toDomainError(cause, 'No se pudieron guardar las notas.'),
    );
  }

  async hardDelete(id: SubjectNoteId): Promise<Result<void>> {
    return fromPromise(this.database.subjectNotes.delete(id), (cause) =>
      toDomainError(cause, 'No se pudo borrar la nota.'),
    );
  }
}

export class DexieClassAttendanceRepository implements ClassAttendanceRepository {
  constructor(
    private readonly database: AppDatabase,
    private readonly outbox: Outbox,
  ) {}

  async findById(id: ClassAttendanceId): Promise<Result<ClassAttendance | null>> {
    return fromPromise(
      this.database.classAttendance
        .get(id)
        .then((record) => (record === undefined ? null : stripHints<ClassAttendance>(record))),
      (cause) => toDomainError(cause, 'No se pudo leer la asistencia.'),
    );
  }

  async findAll(query: ClassAttendanceQuery = {}): Promise<Result<ClassAttendance[]>> {
    return fromPromise(
      (async () => {
        const includeDeleted = query.includeDeleted === true;
        const table = this.database.classAttendance;

        let records;
        if (query.blockId !== undefined) {
          records = includeDeleted
            ? await table.where('blockId').equals(query.blockId).toArray()
            : await table.where('[_deleted+blockId]').equals([0, query.blockId]).toArray();
        } else if (query.subjectId !== undefined) {
          records = includeDeleted
            ? await table.where('subjectId').equals(query.subjectId).toArray()
            : await table.where('[_deleted+subjectId]').equals([0, query.subjectId]).toArray();
        } else {
          records = includeDeleted
            ? await table.toArray()
            : await table.where('_deleted').equals(0).toArray();
        }

        /* El indice elegido solo sirve a UNO de los dos criterios; el que sobra se aplica
           aqui. Ignorarlo en silencio devolveria de mas, que es la peor forma de fallar
           de una consulta porque el resultado parece correcto. */
        const filtered = records.filter(
          (record) =>
            (query.subjectId === undefined || record.subjectId === query.subjectId) &&
            (query.blockId === undefined || record.blockId === query.blockId),
        );

        return filtered
          .map((record) => stripHints<ClassAttendance>(record))
          .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate) || a.id.localeCompare(b.id));
      })(),
      (cause) => toDomainError(cause, 'No se pudo leer la asistencia.'),
    );
  }

  async save(record: ClassAttendance): Promise<Result<ClassAttendance>> {
    return fromPromise(
      this.database.transaction(
        'rw',
        [this.database.classAttendance, this.database.outbox],
        async () => {
          await this.database.classAttendance.put(withHints(record, true));
          await this.outbox.enqueue(
            'classAttendance',
            record.id,
            'upsert',
            record,
            record.updatedAt,
          );
          return record;
        },
      ),
      (cause) => toDomainError(cause, 'No se pudo guardar la asistencia.'),
    );
  }

  async saveMany(records: readonly ClassAttendance[]): Promise<Result<ClassAttendance[]>> {
    if (records.length === 0) return ok([]);

    return fromPromise(
      this.database.transaction(
        'rw',
        [this.database.classAttendance, this.database.outbox],
        async () => {
          await this.database.classAttendance.bulkPut(
            records.map((record) => withHints(record, true)),
          );
          await this.outbox.enqueueMany(
            'classAttendance',
            records.map((record) => ({
              id: record.id,
              updatedAt: record.updatedAt,
              payload: record,
            })),
          );
          return [...records];
        },
      ),
      (cause) => toDomainError(cause, 'No se pudo guardar la asistencia.'),
    );
  }

  async hardDelete(id: ClassAttendanceId): Promise<Result<void>> {
    return fromPromise(this.database.classAttendance.delete(id), (cause) =>
      toDomainError(cause, 'No se pudo borrar la asistencia.'),
    );
  }
}
