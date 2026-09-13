import type { AttendanceStatus, ClassAttendance } from '../../../domain/schedule/class-attendance';
import type { CalendarDate } from '../../../domain/shared/clock';
import type { ClassAttendanceId, ScheduleBlockId } from '../../../domain/shared/branded';
import type { Result } from '../../../domain/shared/result';
import type { UseCase, UseCaseContext } from '../use-case';
import {
  attendanceKeyFor,
  attendanceNaturalKey,
  createClassAttendance,
  softDeleteClassAttendance,
  updateClassAttendance,
} from '../../../domain/schedule/class-attendance';
import { DomainErrors } from '../../../domain/shared/domain-error';
import { err, isErr, ok } from '../../../domain/shared/result';

/**
 * Marcar si fuiste a una clase.
 *
 * La operacion tiene que ser IDEMPOTENTE por `(tramo, dia)`: marcar el martes dos veces
 * -o marcarlo, desmarcarlo y volver a marcarlo- no puede dejar dos filas para la misma
 * clase, porque entonces el recuento contaria la falta dos veces y el aviso de "te quedan
 * 3" seria mentira.
 *
 * Y como el servidor NO tiene indice unico -a proposito: dos dispositivos sin conexion
 * marcando el mismo dia produciran siempre dos filas, y un indice unico envenenaria la
 * cola-, la fusion se hace aqui, que es donde se puede decidir cual de las dos marcas
 * vale sin romper nada.
 */

const noSession = () =>
  err(DomainErrors.unauthenticated('Necesitas iniciar sesion para hacer esto.'));

export interface MarkAttendanceCommand {
  readonly blockId: ScheduleBlockId;
  readonly sessionDate: CalendarDate;
  readonly status: AttendanceStatus;
  readonly note?: string | null;
}

export class MarkAttendanceUseCase implements UseCase<MarkAttendanceCommand, ClassAttendance> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: MarkAttendanceCommand): Promise<Result<ClassAttendance>> {
    const user = this.context.currentUser();
    if (user === null) return noSession();

    const block = await this.context.scheduleBlocks.findById(command.blockId);
    if (isErr(block)) return block;
    if (block.value === null) {
      return err(
        DomainErrors.notFound('No encontramos esa clase.', { details: { id: command.blockId } }),
      );
    }

    const resolved = await this.resolveExisting(command.blockId, command.sessionDate);
    if (isErr(resolved)) return resolved;

    const now = this.context.clock.now().toISOString();

    if (resolved.value !== null) {
      const updated = updateClassAttendance(
        resolved.value,
        {
          status: command.status,
          ...(command.note === undefined ? {} : { note: command.note }),
        },
        now,
      );

      if (isErr(updated)) return updated;
      return this.context.attendance.save(updated.value);
    }

    const created = createClassAttendance({
      id: this.context.ids.next<ClassAttendanceId>(),
      userId: user.id,
      blockId: command.blockId,
      subjectId: block.value.subjectId,
      sessionDate: command.sessionDate,
      status: command.status,
      now,
      ...(command.note === undefined ? {} : { note: command.note }),
    });

    if (isErr(created)) return created;
    return this.context.attendance.save(created.value);
  }

  /**
   * La marca que vale para ese `(tramo, dia)`, fusionando lo que sobre.
   *
   * Mira tambien las BORRADAS: desmarcar y volver a marcar tiene que resucitar la misma
   * fila, no crear otra. Y si aparecen varias -dos dispositivos marcando sin conexion-,
   * se queda la mas reciente y las demas se dan de baja aqui mismo, que es la unica forma
   * de que el recuento no las cuente dos veces.
   */
  private async resolveExisting(
    blockId: ScheduleBlockId,
    sessionDate: CalendarDate,
  ): Promise<Result<ClassAttendance | null>> {
    const stored = await this.context.attendance.findAll({ blockId, includeDeleted: true });
    if (isErr(stored)) return stored;

    const key = attendanceKeyFor(blockId, sessionDate);
    const matches = stored.value
      .filter((record) => attendanceNaturalKey(record) === key)
      .sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id),
      );

    const [winner, ...duplicates] = matches;
    if (winner === undefined) return ok(null);

    if (duplicates.length > 0) {
      const now = this.context.clock.now().toISOString();
      const merged = await this.context.attendance.saveMany(
        duplicates
          .filter((record) => record.deletedAt === null)
          .map((record) => softDeleteClassAttendance(record, now)),
      );
      if (isErr(merged)) return merged;
    }

    return ok(winner);
  }
}

export interface ClearAttendanceCommand {
  readonly blockId: ScheduleBlockId;
  readonly sessionDate: CalendarDate;
}

/**
 * Devuelve una clase al estado "sin marcar".
 *
 * Borrado logico y no fisico, como todo lo demas: quitar la marca tiene que viajar al
 * otro dispositivo. Con un borrado fisico, el telefono volveria a subir la fila que la
 * computadora acaba de quitar.
 */
export class ClearAttendanceUseCase implements UseCase<ClearAttendanceCommand, void> {
  constructor(private readonly context: UseCaseContext) {}

  async execute(command: ClearAttendanceCommand): Promise<Result<void>> {
    const stored = await this.context.attendance.findAll({ blockId: command.blockId });
    if (isErr(stored)) return stored;

    const key = attendanceKeyFor(command.blockId, command.sessionDate);
    const matches = stored.value.filter((record) => attendanceNaturalKey(record) === key);

    if (matches.length === 0) return ok(undefined);

    const now = this.context.clock.now().toISOString();

    const saved = await this.context.attendance.saveMany(
      matches.map((record) => softDeleteClassAttendance(record, now)),
    );
    if (isErr(saved)) return saved;

    return ok(undefined);
  }
}
