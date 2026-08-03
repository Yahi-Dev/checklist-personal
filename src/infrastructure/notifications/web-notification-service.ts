import type {
  LocalNotification,
  NotificationPermission as AppNotificationPermission,
  NotificationService,
  PushSubscriptionPayload,
} from '../../application/ports/services';
import type { Result } from '../../domain/shared/result';

import { appConfig } from '../../shared/config/app-config';
import { DomainErrors, toDomainError } from '../../domain/shared/domain-error';
import { err, ok } from '../../domain/shared/result';

/**
 * Avisos en el navegador y en la PWA del iPhone.
 *
 * DOS MECANISMOS, Y HACEN FALTA LOS DOS
 * -------------------------------------
 * 1. Temporizadores en memoria. Precisos, inmediatos, y MUEREN al cerrar la pestaña.
 *    Cubren el caso "estoy usando la app y en 20 minutos toca la reunion".
 *
 * 2. Web Push desde el servidor. Sobrevive a la app cerrada y al telefono bloqueado,
 *    que es lo unico que sirve de verdad para un recordatorio a las 7 de la mañana.
 *    Es tambien la unica via en iOS, donde no existen alarmas en segundo plano para
 *    aplicaciones web.
 *
 * REQUISITOS EN iOS
 * -----------------
 * Desde iOS 16.4 hay Web Push para PWA, pero SOLO si la app se añadio a la pantalla de
 * inicio. Abierta en una pestaña de Safari, `Notification.requestPermission` ni existe.
 * Por eso `getPermission` devuelve 'unsupported' en vez de 'denied': son situaciones
 * distintas y la interfaz tiene que explicar cosas distintas.
 */
export class WebNotificationService implements NotificationService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Mas alla de esto no se programa en memoria: setTimeout no es fiable a esa escala. */
  private static readonly MAX_TIMER_MS = 24 * 60 * 60 * 1000;

  async getPermission(): Promise<AppNotificationPermission> {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  }

  async requestPermission(): Promise<AppNotificationPermission> {
    if (typeof Notification === 'undefined') return 'unsupported';

    if (Notification.permission !== 'default') {
      return Notification.permission;
    }

    const result = await Notification.requestPermission();
    return result;
  }

  async schedule(notification: LocalNotification): Promise<Result<void>> {
    await this.cancel(notification.id);

    const delay = Date.parse(notification.scheduledAt) - Date.now();

    if (delay <= 0) {
      return this.showNow(notification);
    }

    if (delay > WebNotificationService.MAX_TIMER_MS) {
      // Fuera de rango para un temporizador: lo cubre Web Push desde el servidor.
      return ok(undefined);
    }

    const timer = setTimeout(() => {
      void this.showNow(notification);
      this.timers.delete(notification.id);
    }, delay);

    this.timers.set(notification.id, timer);
    return ok(undefined);
  }

  async cancel(notificationId: string): Promise<Result<void>> {
    const timer = this.timers.get(notificationId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(notificationId);
    }
    return ok(undefined);
  }

  async cancelAll(): Promise<Result<void>> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    return ok(undefined);
  }

  async showNow(notification: Omit<LocalNotification, 'scheduledAt'>): Promise<Result<void>> {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return ok(undefined);
    }

    try {
      // Se prefiere el service worker: sus notificaciones sobreviven a que la pestaña
      // se cierre y admiten botones de accion, cosa que `new Notification()` no.
      const registration = await navigator.serviceWorker?.getRegistration();

      if (registration !== undefined) {
        await registration.showNotification(notification.title, {
          body: notification.body,
          icon: './icons/icon-192.png',
          badge: './icons/badge-72.png',
          tag: notification.id,
          data: { taskId: notification.taskId, deepLink: notification.deepLink },
          requireInteraction: false,
        });
        return ok(undefined);
      }

      const shown = new Notification(notification.title, {
        body: notification.body,
        icon: './icons/icon-192.png',
        tag: notification.id,
      });

      shown.onclick = () => {
        window.focus();
        if (notification.deepLink !== undefined) window.location.hash = notification.deepLink;
        shown.close();
      };

      return ok(undefined);
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo mostrar la notificacion.'));
    }
  }

  /**
   * Registra el dispositivo para Web Push.
   *
   * La clave VAPID publica se convierte a `Uint8Array` porque `PushManager.subscribe`
   * solo acepta bytes crudos, no la cadena en base64url que devuelve el generador.
   */
  async registerForPush(): Promise<Result<PushSubscriptionPayload | null>> {
    if (!appConfig.push.isConfigured) return ok(null);
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return ok(null);
    if (typeof PushManager === 'undefined') return ok(null);

    try {
      const registration = await navigator.serviceWorker.ready;

      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(appConfig.push.vapidPublicKey),
        }));

      const json = subscription.toJSON();
      const keys = json.keys ?? {};

      if (keys.p256dh === undefined || keys.auth === undefined) {
        return err(DomainErrors.infrastructure('La suscripcion de push llego incompleta.'));
      }

      return ok({
        endpoint: subscription.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        platform: detectPushPlatform(),
      });
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo activar las notificaciones push.'));
    }
  }

  async unregisterFromPush(): Promise<Result<void>> {
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription !== undefined && subscription !== null) await subscription.unsubscribe();
      return ok(undefined);
    } catch (cause) {
      return err(toDomainError(cause, 'No se pudo desactivar las notificaciones push.'));
    }
  }
}

const detectPushPlatform = (): PushSubscriptionPayload['platform'] => {
  if (typeof navigator === 'undefined') return 'web';

  const isIos = /iphone|ipad|ipod/iu.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;

  return isIos && isStandalone ? 'ios-pwa' : 'web';
};

/**
 * base64url -> Uint8Array, que es lo unico que acepta `applicationServerKey`.
 *
 * Se construye sobre un `ArrayBuffer` explicito porque `new Uint8Array(n)` se tipa
 * como `Uint8Array<ArrayBufferLike>`, y `ArrayBufferLike` incluye `SharedArrayBuffer`,
 * que la firma de `PushManager.subscribe` no admite.
 */
const urlBase64ToUint8Array = (base64String: string): Uint8Array<ArrayBuffer> => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/gu, '+').replace(/_/gu, '/');
  const raw = globalThis.atob(base64);

  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }

  return output;
};
