import type { ParsedScheduleBlock, ParsedSubject } from '../../parsing/unibe-schedule-parser';
import type { ScheduleBlock } from '../../../domain/schedule/schedule-block';
import type { ScheduleBlockId, SubjectId } from '../../../domain/shared/branded';
import type { Result } from '../../../domain/shared/result';
import type { Subject } from '../../../domain/schedule/subject';
import type { UseCase, UseCaseContext } from '../use-case';
import {
  createScheduleBlock,
  scheduleBlockKeyFor,
  scheduleBlockNaturalKey,
  softDeleteScheduleBlock,
  updateScheduleBlock,
} from '../../../domain/schedule/schedule-block';
import {
  createSubject,
  restoreSubject,
  softDeleteSubject,
  subjectKeyFor,
  subjectNaturalKey,
  updateSubject,
} from '../../../domain/schedule/subject';
import { DomainErrors } from '../../../domain/shared/domain-error';
import { err, isErr, ok } from '../../../domain/shared/result';
import { parseUnibeSchedule } from '../../parsing/unibe-schedule-parser';

/**
 * Importar el PDF del horario de la universidad.
 *
 * El requisito es "soltar el documento y que salga el horario", y cada cuatrimestre hay
 * un documento nuevo. Eso convierte la reconciliacion en el corazon del caso de uso, no
 * en un detalle: los ids son UUID que genera este dispositivo, asi que volver a soltar
 * el MISMO PDF -algo que pasa constantemente, porque uno reimporta cuando le cambian un
 * aula- crearia el horario entero por segunda vez si se escribiera a lo bruto.
 *
 * Por eso se casa por CLAVE NATURAL y no por id:
 *
 *   - asignatura: `(cuatrimestre, codigo, seccion)`
 *   - tramo:      `(asignatura, dia, hora de inicio)`
 *
 * Lo que casa se ACTUALIZA conservando su id, y con el, el color que el usuario haya
 * elegido y las referencias de los tramos. Lo que no viene en el documento se borra en
 * LOGICO, nunca en fisico: el borrado tiene que viajar al otro dispositivo, y un
 * `hardDelete` local haria que el iPhone volviera a subir la fila que el escritorio
 * acaba de quitar.
 *
 * Y el alcance del borrado se limita SIEMPRE al cuatrimestre del documento. Importar el
 * horario nuevo no puede llevarse por delante el del cuatrimestre pasado, que es lo que
 * pasaria con un "borrar todo y volver a escribir".
 */

export interface ImportSchedulePdfCommand {
  readonly bytes: Uint8Array;
  /** Calcula el resumen sin escribir nada. Lo usa la vista previa del dialogo. */
  readonly dryRun?: boolean;
}

export interface ImportScheduleSummary {
  readonly termCode: string;
  readonly studentName: string | null;
  readonly createdSubjects: number;
  readonly updatedSubjects: number;
  readonly removedSubjects: number;
  readonly createdBlocks: number;
  readonly updatedBlocks: number;
  readonly removedBlocks: number;
  readonly warnings: readonly string[];
}

export class ImportSchedulePdfUseCase implements UseCase<
  ImportSchedulePdfCommand,
  ImportScheduleSummary
> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: ImportSchedulePdfCommand): Promise<Result<ImportScheduleSummary>> {
    const user = this.context.currentUser();
    if (user === null) {
      return err(DomainErrors.unauthenticated('Necesitas iniciar sesion para hacer esto.'));
    }

    const extracted = await this.context.pdf.extract(command.bytes);
    if (isErr(extracted)) return extracted;

    const parsed = parseUnibeSchedule(extracted.value);

    if (parsed.termCode === null || parsed.subjects.length === 0) {
      return err(
        DomainErrors.validation(
          'Este PDF no parece el horario de la universidad. Descargalo otra vez desde el portal y vuelve a intentarlo.',
          { field: 'file', details: { warnings: parsed.warnings } },
        ),
      );
    }

    const termCode = parsed.termCode;
    const now = this.context.clock.now().toISOString();

    const stored = await this.context.subjects.findAll({ termCode, includeDeleted: true });
    if (isErr(stored)) return stored;

    const byKey = new Map(stored.value.map((subject) => [subjectNaturalKey(subject), subject]));
    const seen = new Set<string>();

    const subjectsToSave: Subject[] = [];
    const blocksToSave: ScheduleBlock[] = [];
    const warnings = [...parsed.warnings];

    let createdSubjects = 0;
    let updatedSubjects = 0;
    let createdBlocks = 0;
    let updatedBlocks = 0;
    let removedBlocks = 0;

    for (const [index, incoming] of parsed.subjects.entries()) {
      const key = subjectKeyFor(termCode, incoming.code, incoming.section);
      const existing = byKey.get(key);

      /* Se marca vista ANTES de intentar nada. Si la asignatura resulta invalida y se
         salta, la que ya estaba guardada con esa clave NO puede acabar dada de baja: un
         tropiezo leyendo el documento no puede costar datos. */
      seen.add(key);

      const reconciled = this.reconcileSubject(user.id, termCode, incoming, existing, index, now);

      /* Una asignatura que el dominio rechaza no tumba la importacion entera. Es la misma
         regla que sigue el parser: lo que no se entiende se anota y se sigue, porque un
         renglon raro no puede costar el horario completo. */
      if (isErr(reconciled)) {
        warnings.push(`${incoming.code}: no se pudo guardar (${reconciled.error.message})`);
        continue;
      }

      const subject = reconciled.value;
      subjectsToSave.push(subject);
      if (existing === undefined) createdSubjects += 1;
      else updatedSubjects += 1;

      const storedBlocks =
        existing === undefined
          ? ok<ScheduleBlock[]>([])
          : await this.context.scheduleBlocks.findAll({
              subjectId: existing.id,
              includeDeleted: true,
            });
      if (isErr(storedBlocks)) return storedBlocks;

      const blocks = this.reconcileBlocks(
        user.id,
        subject,
        incoming.blocks,
        storedBlocks.value,
        now,
      );

      blocksToSave.push(...blocks.save);
      createdBlocks += blocks.created;
      updatedBlocks += blocks.updated;
      removedBlocks += blocks.removed;
      warnings.push(...blocks.warnings);
    }

    /* Una asignatura que estaba en el cuatrimestre y ya no viene en el documento es una
       baja: se borra en logico junto con sus tramos. Solo dentro de ESTE cuatrimestre. */
    let removedSubjects = 0;

    for (const subject of stored.value) {
      if (subject.deletedAt !== null) continue;
      if (seen.has(subjectNaturalKey(subject))) continue;

      subjectsToSave.push(softDeleteSubject(subject, now));
      removedSubjects += 1;

      const orphans = await this.context.scheduleBlocks.findAll({ subjectId: subject.id });
      if (isErr(orphans)) return orphans;

      for (const block of orphans.value) {
        blocksToSave.push(softDeleteScheduleBlock(block, now));
        removedBlocks += 1;
      }
    }

    const summary: ImportScheduleSummary = {
      termCode,
      studentName: parsed.studentName,
      createdSubjects,
      updatedSubjects,
      removedSubjects,
      createdBlocks,
      updatedBlocks,
      removedBlocks,
      warnings,
    };

    if (command.dryRun === true) return ok(summary);

    /* Primero las asignaturas y despues sus tramos: en el servidor hay una clave
       foranea, y la cola de salida reproduce las operaciones en el orden en que se
       encolaron. Al reves, el primer tramo llegaria antes que su asignatura. */
    const savedSubjects = await this.context.subjects.saveMany(subjectsToSave);
    if (isErr(savedSubjects)) return savedSubjects;

    const savedBlocks = await this.context.scheduleBlocks.saveMany(blocksToSave);
    if (isErr(savedBlocks)) return savedBlocks;

    return ok(summary);
  }

  private reconcileSubject(
    userId: Subject['userId'],
    termCode: string,
    incoming: ParsedSubject,
    existing: Subject | undefined,
    index: number,
    now: string,
  ): Result<Subject> {
    if (existing === undefined) {
      return createSubject({
        id: this.context.ids.next<SubjectId>(),
        userId,
        code: incoming.code,
        name: incoming.name,
        termCode,
        now,
        section: incoming.section,
        credits: incoming.credits,
        teacherCode: incoming.teacherCode,
        teacherName: incoming.teacherName,
        startsOn: incoming.startsOn,
        endsOn: incoming.endsOn,
        position: index,
      });
    }

    /* El color NO se toca: si el usuario le puso uno, reimportar no puede quitarselo.
       Es la razon entera de casar por clave natural en vez de borrar y volver a crear. */
    const updated = updateSubject(
      existing.deletedAt === null ? existing : restoreSubject(existing, now),
      {
        name: incoming.name,
        credits: incoming.credits,
        teacherCode: incoming.teacherCode,
        teacherName: incoming.teacherName,
        startsOn: incoming.startsOn,
        endsOn: incoming.endsOn,
        position: index,
      },
      now,
    );

    if (isErr(updated)) return updated;

    return ok(existing.deletedAt === null ? updated.value : { ...updated.value, deletedAt: null });
  }

  private reconcileBlocks(
    userId: Subject['userId'],
    subject: Subject,
    incoming: readonly ParsedScheduleBlock[],
    stored: readonly ScheduleBlock[],
    now: string,
  ): {
    save: ScheduleBlock[];
    created: number;
    updated: number;
    removed: number;
    warnings: string[];
  } {
    const byKey = new Map(stored.map((block) => [scheduleBlockNaturalKey(block), block]));
    const seen = new Set<string>();
    const save: ScheduleBlock[] = [];
    const warnings: string[] = [];

    let created = 0;
    let updated = 0;
    let removed = 0;

    for (const block of incoming) {
      const key = scheduleBlockKeyFor(subject.id, block.weekday, block.startsAt);
      if (seen.has(key)) {
        // Dos tramos identicos en el mismo documento: se queda el primero.
        warnings.push(
          `${subject.code}: el documento repite la clase del dia ${String(block.weekday)} a las ${block.startsAt}.`,
        );
        continue;
      }
      seen.add(key);

      const existing = byKey.get(key);

      if (existing === undefined) {
        const result = createScheduleBlock({
          id: this.context.ids.next<ScheduleBlockId>(),
          userId,
          subjectId: subject.id,
          weekday: block.weekday,
          startsAt: block.startsAt,
          endsAt: block.endsAt,
          now,
          modality: block.modality,
          locationLabel: block.locationLabel,
          isRemote: block.isRemote,
          startsOn: block.startsOn,
          endsOn: block.endsOn,
        });

        if (isErr(result)) {
          warnings.push(`${subject.code}: clase descartada (${result.error.message})`);
          continue;
        }

        save.push(result.value);
        created += 1;
        continue;
      }

      const result = updateScheduleBlock(
        existing,
        {
          endsAt: block.endsAt,
          modality: block.modality,
          locationLabel: block.locationLabel,
          isRemote: block.isRemote,
          startsOn: block.startsOn,
          endsOn: block.endsOn,
        },
        now,
      );

      if (isErr(result)) {
        warnings.push(`${subject.code}: clase sin actualizar (${result.error.message})`);
        continue;
      }

      save.push({ ...result.value, deletedAt: null });
      updated += 1;
    }

    for (const block of stored) {
      if (block.deletedAt !== null) continue;
      if (seen.has(scheduleBlockNaturalKey(block))) continue;

      save.push(softDeleteScheduleBlock(block, now));
      removed += 1;
    }

    return { save, created, updated, removed, warnings };
  }
}
