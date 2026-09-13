import type { Clock } from '../../domain/shared/clock';
import type { NotificationService } from '../ports/services';
import type { ScheduleBlock } from '../../domain/schedule/schedule-block';
import type { ScheduleBlockRepository, SubjectRepository } from '../ports/repositories';
import { describeRoom } from '../../domain/schedule/schedule-block';
import { isOk } from '../../domain/shared/result';
import { sessionsBetween } from '../../domain/schedule/attendance-report';
import { timeToMinutes } from '../../domain/schedule/value-objects/time-of-day';
import { toCalendarDate } from '../../domain/shared/clock';

/** Antelacion por defecto, en minutos. Lo justo para levantarse y llegar. */
export const DEFAULT_CLASS_REMINDER_LEAD_MINUTES = 15;

/**
 * El aviso antes de clase, con el aula.
 *
 * Se apoya en el mismo puerto de notificaciones que los recordatorios de tareas, pero es
 * un planificador APARTE y no un caso mas de aquel. La razon es que lo que programa no
 * sale de una fila: una clase de los lunes a las 20:00 no es un instante guardado en
 * ningun sitio, es una regla que hay que convertir en fechas concretas cada vez.
 *
 * NO USA `cancelAll`. El planificador de tareas si lo hace, y si este tambien lo hiciera
 * cada uno borraria los avisos del otro segun el orden en que arrancaran. Aqui se cancela
 * por id, uno a uno, sobre la misma ventana que se va a reprogramar.
 */
export class ClassReminderScheduler {
  /**
   * Solo se programan los avisos de los proximos dias.
   *
   * Misma razon que en los recordatorios de tareas: el planificador del navegador no
   * sobrevive a que se cierre la pestaña, asi que programar a tres semanas vista es
   * gastar memoria en algo que no va a llegar.
   */
  private static readonly HORIZON_DAYS = 7;

  constructor(
    private readonly notifications: NotificationService,
    private readonly subjects: SubjectRepository,
    private readonly blocks: ScheduleBlockRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Reprograma los avisos de la proxima semana.
   *
   * `leadMinutes` a 0 apaga la funcion: se cancela todo y no se programa nada. Es la
   * misma palanca que el usuario ve en Ajustes, y apagarla tiene que dejar limpio de
   * verdad, no solo dejar de crear avisos nuevos.
   */
  async rebuildAll(leadMinutes: number): Promise<void> {
    const subjects = await this.subjects.findAll();
    if (!isOk(subjects)) return;

    const blocks = await this.blocks.findAll({ includeDeleted: true });
    if (!isOk(blocks)) return;

    const bySubject = new Map(subjects.value.map((subject) => [subject.id as string, subject]));
    const now = this.clock.now();
    const today = toCalendarDate(now);
    const horizon = toCalendarDate(
      new Date(now.getTime() + ClassReminderScheduler.HORIZON_DAYS * 86_400_000),
    );

    /* Se cancela sobre TODOS los tramos, incluidos los borrados, antes de programar. Sin
       eso, quitar una clase del horario dejaria vivo su aviso hasta que sonara: el
       usuario recibiria un recordatorio de una clase que ya no existe. */
    for (const block of blocks.value) {
      const subject = bySubject.get(block.subjectId);
      if (subject === undefined) continue;

      for (const session of sessionsBetween(block, subject, today, horizon)) {
        await this.notifications.cancel(this.notificationIdFor(block, session.date));
      }
    }

    if (leadMinutes <= 0) return;

    for (const block of blocks.value) {
      if (block.deletedAt !== null) continue;

      const subject = bySubject.get(block.subjectId);
      if (subject?.deletedAt !== null) continue;

      for (const session of sessionsBetween(block, subject, today, horizon)) {
        const at = this.reminderInstant(session.date, block, leadMinutes);

        // Lo que ya paso no se programa: el navegador lo dispararia de inmediato y el
        // usuario recibiria de golpe los avisos de toda la mañana.
        if (at.getTime() <= now.getTime()) continue;

        await this.notifications.schedule({
          id: this.notificationIdFor(block, session.date),
          title: subject.name,
          body: this.buildBody(block),
          scheduledAt: at.toISOString(),
          taskId: null,
          deepLink: '#/horario',
        });
      }
    }
  }

  /** `clase:` delante para no chocar con los ids de los recordatorios de tareas. */
  private notificationIdFor(block: ScheduleBlock, date: string): string {
    return `clase:${block.id}:${date}`;
  }

  private reminderInstant(date: string, block: ScheduleBlock, leadMinutes: number): Date {
    const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
    const start = timeToMinutes(block.startsAt);

    /* Se construye en hora LOCAL a proposito. La hora de una clase es hora de reloj de
       pared: las 8 de la noche son las 8 de la noche, y pasar por UTC la moveria cuatro
       horas. */
    return new Date(year, month - 1, day, Math.floor(start / 60), (start % 60) - leadMinutes, 0, 0);
  }

  /**
   * El aula es lo unico que el aviso tiene que decir.
   *
   * Que la clase es a las 8 ya lo sabes -por eso te suena-; a donde tienes que ir es lo
   * que se olvida, sobre todo con las materias que cambian de aula entre dias.
   */
  private buildBody(block: ScheduleBlock): string {
    if (block.isRemote) return 'Clase virtual';

    const room = describeRoom(block.locationLabel);

    if (room.building === null || room.room === null) {
      return block.locationLabel === '' ? 'Empieza ahora' : block.locationLabel;
    }

    return `Edif. ${room.building} · Aula ${room.room}`;
  }
}
