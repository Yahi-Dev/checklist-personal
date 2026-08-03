import type { Clock } from '../../domain/shared/clock';
import type { NotificationService } from '../ports/services';
import type { Task } from '../../domain/task/task';
import type { TaskRepository } from '../ports/repositories';

import { isOk } from '../../domain/shared/result';
import { isPending } from '../../domain/task/task';

/**
 * Mantiene los avisos del sistema alineados con el estado de las tareas.
 *
 * Vive en la capa de aplicacion, no en la infraestructura, porque la REGLA de que
 * merece un aviso (pendiente, con recordatorio, en el futuro, dentro de la ventana)
 * es una decision de negocio. Como se muestra ese aviso -toast de Windows, Web Push
 * al iPhone- es lo que si queda del lado de la infraestructura.
 */
export class ReminderScheduler {
  /**
   * Solo se programan los avisos de los proximos 7 dias.
   *
   * El planificador del navegador no sobrevive a un cierre de pestaña, y Windows
   * tampoco garantiza temporizadores de semanas. Lo lejano lo cubre Web Push desde el
   * servidor, que si sobrevive a que la app este cerrada.
   */
  private static readonly SCHEDULING_WINDOW_DAYS = 7;

  constructor(
    private readonly notifications: NotificationService,
    private readonly tasks: TaskRepository,
    private readonly clock: Clock,
  ) {}

  /** Programa el aviso de una tarea, o lo cancela si ya no procede. */
  async syncTask(task: Task): Promise<void> {
    await this.notifications.cancel(this.notificationIdFor(task));

    const scheduledAt = task.reminderAt;
    if (scheduledAt === null || !this.deservesReminder(task)) return;

    await this.notifications.schedule({
      id: this.notificationIdFor(task),
      title: task.isImportant ? `Importante: ${task.title}` : task.title,
      body: this.buildBody(task),
      scheduledAt,
      taskId: task.id,
      deepLink: `#/tarea/${task.id}`,
    });
  }

  /** Reconstruye todos los avisos desde cero. Se llama al arrancar y tras sincronizar. */
  async rebuildAll(): Promise<void> {
    await this.notifications.cancelAll();

    const result = await this.tasks.findAll({ statuses: ['pending'] });
    if (!isOk(result)) return;

    const scheduled = result.value.filter((task) => this.deservesReminder(task));
    await Promise.all(scheduled.map((task) => this.syncTask(task)));
  }

  async cancelForTask(task: Pick<Task, 'id'>): Promise<void> {
    await this.notifications.cancel(this.notificationIdFor(task));
  }

  private deservesReminder(task: Task): boolean {
    if (!isPending(task)) return false;
    if (task.reminderAt === null) return false;

    const remindAt = Date.parse(task.reminderAt);
    const now = this.clock.nowMs();
    const horizon = now + ReminderScheduler.SCHEDULING_WINDOW_DAYS * 86_400_000;

    return remindAt > now && remindAt <= horizon;
  }

  private buildBody(task: Task): string {
    if (task.dueAt === null) return 'Tienes un recordatorio pendiente.';

    const due = new Date(task.dueAt);
    if (task.isAllDay) {
      return `Vence hoy, ${due.toLocaleDateString('es-DO', { day: 'numeric', month: 'long' })}.`;
    }

    return `Vence a las ${due.toLocaleTimeString('es-DO', {
      hour: '2-digit',
      minute: '2-digit',
    })}.`;
  }

  /** Id estable: reprogramar la misma tarea reemplaza su aviso en vez de duplicarlo. */
  private notificationIdFor(task: Pick<Task, 'id'>): string {
    return `task-reminder:${task.id}`;
  }
}
