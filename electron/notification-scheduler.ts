import { Notification } from 'electron';

import type { DesktopNotificationRequest } from '../src/shared/desktop-bridge';

/**
 * Programador de avisos en el proceso PRINCIPAL.
 *
 * Aqui esta la ventaja real de la version de escritorio frente a la web: el proceso
 * principal sigue vivo con la ventana cerrada, minimizada o en la bandeja. Un
 * temporizador en el renderer muere en cuanto se cierra la ventana; este no.
 *
 * `setTimeout` de Node acepta como maximo 2^31-1 ms (unos 24,8 dias) y por encima de
 * eso se dispara INMEDIATAMENTE, que es justo lo contrario de lo que se quiere. Los
 * avisos lejanos se encadenan en tramos para evitarlo.
 */

/** Tramo maximo por salto: 24 horas. */
const MAX_CHUNK_MS = 24 * 60 * 60 * 1000;

interface ScheduledNotification {
  readonly request: DesktopNotificationRequest;
  timer: NodeJS.Timeout;
}

export class NotificationScheduler {
  private readonly scheduled = new Map<string, ScheduledNotification>();

  constructor(private readonly onActivate: (deepLink: string) => void) {}

  /** Programa un aviso. Con el mismo id, reemplaza al anterior. */
  schedule(request: DesktopNotificationRequest): void {
    this.cancel(request.id);

    const delay = Date.parse(request.scheduledAt) - Date.now();

    if (Number.isNaN(delay)) {
      console.warn('[notifications] fecha invalida', request.id, request.scheduledAt);
      return;
    }

    if (delay <= 0) {
      this.show(request);
      return;
    }

    this.arm(request, delay);
  }

  private arm(request: DesktopNotificationRequest, remainingMs: number): void {
    const chunk = Math.min(remainingMs, MAX_CHUNK_MS);

    const timer = setTimeout(() => {
      const left = remainingMs - chunk;

      if (left > 0) {
        // Todavia falta: se vuelve a armar. Recalcular desde la fecha real absorbe
        // la deriva de los temporizadores y los cambios de hora del sistema.
        this.arm(request, Math.max(0, Date.parse(request.scheduledAt) - Date.now()));
        return;
      }

      this.show(request);
      this.scheduled.delete(request.id);
    }, chunk);

    // `unref` NO se usa aqui a proposito: el temporizador debe mantener vivo el
    // proceso, que es precisamente el motivo de programar desde el proceso principal.
    this.scheduled.set(request.id, { request, timer });
  }

  cancel(id: string): void {
    const entry = this.scheduled.get(id);
    if (entry === undefined) return;

    clearTimeout(entry.timer);
    this.scheduled.delete(id);
  }

  cancelAll(): void {
    for (const entry of this.scheduled.values()) clearTimeout(entry.timer);
    this.scheduled.clear();
  }

  show(request: Omit<DesktopNotificationRequest, 'scheduledAt'>): void {
    if (!Notification.isSupported()) return;

    const notification = new Notification({
      title: request.title,
      body: request.body,
      // Windows agrupa por este id; se queda con el de la app para que las
      // notificaciones aparezcan bajo su nombre en el centro de actividades.
      silent: false,
      urgency: 'normal',
    });

    notification.on('click', () => {
      this.onActivate(request.deepLink ?? '#/hoy');
    });

    notification.show();
  }

  get pendingCount(): number {
    return this.scheduled.size;
  }
}
