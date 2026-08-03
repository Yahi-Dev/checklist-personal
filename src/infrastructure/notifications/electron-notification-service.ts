import type {
  LocalNotification,
  NotificationPermission as AppNotificationPermission,
  NotificationService,
  PushSubscriptionPayload,
} from '../../application/ports/services';
import type { DesktopBridge } from '../../shared/desktop-bridge';
import type { Result } from '../../domain/shared/result';

import { ok } from '../../domain/shared/result';
import { toDomainError } from '../../domain/shared/domain-error';
import { err } from '../../domain/shared/result';

/**
 * Avisos nativos de Windows, delegando en el proceso principal de Electron.
 *
 * La programacion vive en el proceso PRINCIPAL, no aqui. Es la diferencia que importa:
 * un temporizador en el renderer muere si la ventana se cierra, mientras que el proceso
 * principal sigue vivo en la bandeja del sistema. Es lo que permite que la app avise a
 * las 3 de la tarde aunque la ventana lleve cerrada desde la mañana.
 */
export class ElectronNotificationService implements NotificationService {
  constructor(private readonly bridge: DesktopBridge) {}

  /** Windows no pide permiso: si el sistema los permite, funcionan. */
  async getPermission(): Promise<AppNotificationPermission> {
    return 'granted';
  }

  async requestPermission(): Promise<AppNotificationPermission> {
    return 'granted';
  }

  async schedule(notification: LocalNotification): Promise<Result<void>> {
    try {
      await this.bridge.notifications.schedule({
        id: notification.id,
        title: notification.title,
        body: notification.body,
        scheduledAt: notification.scheduledAt,
        ...(notification.deepLink === undefined ? {} : { deepLink: notification.deepLink }),
      });
      return ok(undefined);
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo programar el recordatorio.'));
    }
  }

  async cancel(notificationId: string): Promise<Result<void>> {
    try {
      await this.bridge.notifications.cancel(notificationId);
      return ok(undefined);
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo cancelar el recordatorio.'));
    }
  }

  async cancelAll(): Promise<Result<void>> {
    try {
      await this.bridge.notifications.cancelAll();
      return ok(undefined);
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudieron cancelar los recordatorios.'));
    }
  }

  async showNow(notification: Omit<LocalNotification, 'scheduledAt'>): Promise<Result<void>> {
    try {
      await this.bridge.notifications.showNow({
        id: notification.id,
        title: notification.title,
        body: notification.body,
        ...(notification.deepLink === undefined ? {} : { deepLink: notification.deepLink }),
      });
      return ok(undefined);
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo mostrar la notificacion.'));
    }
  }

  /** En escritorio no hace falta Web Push: el proceso principal ya cubre ese hueco. */
  async registerForPush(): Promise<Result<PushSubscriptionPayload | null>> {
    return ok(null);
  }

  async unregisterFromPush(): Promise<Result<void>> {
    return ok(undefined);
  }
}
